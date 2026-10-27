(function (root, factory) {
  const core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  root.ZCore = core;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_SETTINGS = Object.freeze({
    add: true, sub: true, mul: true, div: true,
    addA: [2, 100], addB: [2, 100],
    mulA: [2, 12], mulB: [2, 100],
    duration: 120,
  });

  const OP_NAMES = { add: 'Addition', sub: 'Subtraction', mul: 'Multiplication', div: 'Division' };
  const OP_SYMBOLS = { add: '+', sub: '−', mul: '×', div: '÷' };

  function integerInRange(min, max, rng = Math.random) {
    return min + Math.floor(rng() * (max - min + 1));
  }

  function validatedSettings(raw) {
    const next = { ...DEFAULT_SETTINGS, ...raw };
    for (const key of ['addA', 'addB', 'mulA', 'mulB']) {
      const value = next[key];
      if (!Array.isArray(value) || value.length !== 2) throw new Error('Each number range needs a minimum and maximum.');
      const lo = Number(value[0]);
      const hi = Number(value[1]);
      if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < 1 || hi > 9999 || lo > hi) {
        throw new Error('Number ranges must be whole numbers from 1 to 9999, with minimum ≤ maximum.');
      }
      next[key] = [lo, hi];
    }
    if (!['add', 'sub', 'mul', 'div'].some(op => next[op])) throw new Error('Select at least one operation.');
    next.duration = Number(next.duration);
    if (![30, 60, 120, 300, 600].includes(next.duration)) throw new Error('Choose a valid duration.');
    return next;
  }

  function settingsKey(settings) {
    const s = validatedSettings(settings);
    return JSON.stringify([
      ...['add', 'sub', 'mul', 'div'].map(op => !!s[op]),
      s.add || s.sub ? [s.addA, s.addB] : null,
      s.mul || s.div ? [s.mulA, s.mulB] : null,
    ]);
  }

  function settingsLabel(settings) {
    const s = validatedSettings(settings);
    const ops = ['add', 'sub', 'mul', 'div'].filter(op => s[op]).map(op => OP_SYMBOLS[op]).join(' ');
    const classic = settingsKey(s) === settingsKey(DEFAULT_SETTINGS);
    if (classic) return 'Classic · + − × ÷';
    const ranges = [];
    if (s.add || s.sub) ranges.push(`+ ${s.addA.join('–')} / ${s.addB.join('–')}`);
    if (s.mul || s.div) ranges.push(`× ${s.mulA.join('–')} / ${s.mulB.join('–')}`);
    return `Custom · ${ops} · ${ranges.join(' · ')}`;
  }

  function generateQuestion(rawSettings, rng = Math.random, onlyOp = null) {
    const s = validatedSettings(rawSettings);
    const enabled = ['add', 'sub', 'mul', 'div'].filter(op => s[op]);
    const op = onlyOp || enabled[Math.floor(rng() * enabled.length)];
    if (!enabled.includes(op)) throw new Error('The selected operation is disabled.');
    const a = integerInRange(...(op === 'add' || op === 'sub' ? s.addA : s.mulA), rng);
    const b = integerInRange(...(op === 'add' || op === 'sub' ? s.addB : s.mulB), rng);
    if (op === 'add') return { op, expression: `${a} + ${b}`, answer: a + b };
    if (op === 'sub') return { op, expression: `${a + b} − ${a}`, answer: b };
    if (op === 'mul') return { op, expression: `${a} × ${b}`, answer: a * b };
    return { op, expression: `${a * b} ÷ ${a}`, answer: b };
  }

  function mean(values) {
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  }

  function median(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function comparableRuns(runs, { mode = 'timed', duration = null, key = null, days = null } = {}) {
    const cutoff = days ? Date.now() - days * 86400000 : 0;
    return runs.filter(run =>
      run.mode === mode &&
      (duration === null || Number(run.duration) === Number(duration)) &&
      (key === null || settingsKey(run.settings) === key) &&
      (!days || Date.parse(run.startedAt) >= cutoff)
    ).sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  }

  function runSummary(runs) {
    const scores = runs.map(run => run.score);
    const recent = scores.slice(-10);
    const prior = scores.slice(-20, -10);
    return {
      count: runs.length,
      latest: scores.at(-1) ?? null,
      best: scores.length ? Math.max(...scores) : null,
      average: mean(scores),
      recentAverage: mean(recent),
      priorAverage: mean(prior),
      totalSolved: scores.reduce((a, b) => a + b, 0),
      totalSeconds: runs.reduce((sum, run) => sum + Number(run.elapsed || run.duration || 0), 0),
    };
  }

  function questionsOf(runs) {
    return runs.flatMap(run => (run.questions || []).map(q => ({ ...q, runId: run.id, runStartedAt: run.startedAt })));
  }

  function operationBreakdown(questions) {
    return ['add', 'sub', 'mul', 'div'].map(op => {
      const times = questions.filter(q => q.op === op).map(q => Number(q.timeSec)).filter(Number.isFinite);
      return { op, name: OP_NAMES[op], count: times.length, average: mean(times), median: median(times), best: times.length ? Math.min(...times) : null };
    });
  }

  function problemLeaderboard(questions, minimumSeen = 2) {
    const groups = new Map();
    for (const q of questions) {
      const key = q.expression;
      if (!groups.has(key)) groups.set(key, { expression: key, answer: q.answer, op: q.op, times: [] });
      groups.get(key).times.push(Number(q.timeSec));
    }
    return [...groups.values()]
      .filter(g => g.times.length >= minimumSeen)
      .map(g => ({ expression: g.expression, answer: g.answer, op: g.op, count: g.times.length, average: mean(g.times), median: median(g.times), best: Math.min(...g.times), worst: Math.max(...g.times) }))
      .sort((a, b) => b.average - a.average);
  }

  function fastestWindow(questions, count) {
    if (questions.length < count) return null;
    let sum = 0;
    let best = Infinity;
    for (let i = 0; i < questions.length; i++) {
      sum += Number(questions[i].timeSec);
      if (i >= count) sum -= Number(questions[i - count].timeSec);
      if (i >= count - 1) best = Math.min(best, sum);
    }
    return best;
  }

  function speedDistribution(questions) {
    const limits = [2, 4, 8];
    const buckets = [0, 0, 0, 0];
    for (const q of questions) {
      const t = Number(q.timeSec);
      if (Number.isFinite(t)) buckets[t < limits[0] ? 0 : t < limits[1] ? 1 : t < limits[2] ? 2 : 3]++;
    }
    return buckets;
  }

  function fatigue(questions) {
    if (questions.length < 8) return null;
    const quarter = Math.max(2, Math.floor(questions.length / 4));
    const first = mean(questions.slice(0, quarter).map(q => Number(q.timeSec)));
    const last = mean(questions.slice(-quarter).map(q => Number(q.timeSec)));
    return { first, last, percent: first ? ((last - first) / first) * 100 : null };
  }

  return { DEFAULT_SETTINGS, OP_NAMES, OP_SYMBOLS, validatedSettings, settingsKey, settingsLabel, generateQuestion, mean, median, comparableRuns, runSummary, questionsOf, operationBreakdown, problemLeaderboard, fastestWindow, speedDistribution, fatigue };
});
