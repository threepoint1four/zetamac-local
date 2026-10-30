(() => {
  'use strict';
  const C = window.ZCore;
  const $ = id => document.getElementById(id);
  const state = { runs: [], active: null, selectedRunId: null, view: 'setup', timer: null, durationFilter: null, settingsFilter: null, periodFilter: 'all', pendingDelete: null };
  const native = !!window.webkit?.messageHandlers?.native;
  const colors = { add: '#3379e6', sub: '#9466db', mul: '#e37462', div: '#27a57d' };
  const fmt = (value, digits = 1) => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(digits);
  const dateLabel = iso => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const dateShort = iso => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

  function post(type, extra = {}) {
    if (native) { window.webkit.messageHandlers.native.postMessage({ type, ...extra }); return; }
    if (type === 'ready' || type === 'loadRuns') {
      let runs = [];
      try { runs = JSON.parse(localStorage.getItem('zetamac-local-runs') || '[]'); } catch (_) {}
      window.zetamacNativeReceive({ type: 'runs', runs });
    } else if (type === 'saveRun') {
      const runs = [extra.run, ...state.runs.filter(run => run.id !== extra.run.id)];
      localStorage.setItem('zetamac-local-runs', JSON.stringify(runs));
      window.zetamacNativeReceive({ type: 'saved', id: extra.run.id });
      window.zetamacNativeReceive({ type: 'runs', runs });
    } else if (type === 'deleteRun' || type === 'deleteAllRuns') {
      const runs = type === 'deleteAllRuns' ? [] : state.runs.filter(run => run.id !== extra.id);
      localStorage.setItem('zetamac-local-runs', JSON.stringify(runs));
      window.zetamacNativeReceive({ type: type === 'deleteAllRuns' ? 'deletedAll' : 'deleted' });
      window.zetamacNativeReceive({ type: 'runs', runs });
    } else if (type === 'exportCSV') {
      const blob = new Blob([extra.payload.content], { type: 'text/csv;charset=utf-8' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob); link.download = 'zetamac-history.csv'; link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      window.zetamacNativeReceive({ type: 'exported' });
    }
  }

  window.zetamacNativeReceive = event => {
    if (event.type === 'runs') {
      state.runs = Array.isArray(event.runs) ? event.runs : [];
      if (!state.selectedRunId || !state.runs.some(run => run.id === state.selectedRunId)) state.selectedRunId = state.runs[0]?.id || null;
      renderMenu(); renderHistory(); renderProgress(); renderAnalytics();
    } else if (event.type === 'saved') toast('Run saved on this Mac.');
    else if (event.type === 'deleted') toast('Run deleted.');
    else if (event.type === 'deletedAll') toast('All run history deleted.');
    else if (event.type === 'exported') toast('History exported.');
    else if (event.type === 'error') toast(event.message || 'Something went wrong.');
  };

  function toast(message) {
    const element = $('toast'); element.textContent = message; element.hidden = false;
    clearTimeout(toast.timeout); toast.timeout = setTimeout(() => { element.hidden = true; }, 3400);
  }

  function askToDelete(kind, id = null) {
    const run = kind === 'one' ? state.runs.find(item => item.id === id) : null;
    if (kind === 'one' && !run) return;
    if (kind === 'all' && !state.runs.length) return;
    state.pendingDelete = { kind, id, previousFocus: document.activeElement };
    $('confirm-title').textContent = kind === 'all' ? 'Delete all runs?' : 'Delete this run?';
    $('confirm-message').textContent = kind === 'all'
      ? `This will permanently remove all ${state.runs.length} saved runs from this Mac. This cannot be undone.`
      : `Permanently remove the ${dateLabel(run.startedAt)} run and its question history? This cannot be undone.`;
    $('confirm-delete').textContent = kind === 'all' ? 'Delete all' : 'Delete run';
    $('confirm-overlay').hidden = false;
    $('cancel-delete').focus();
  }

  function closeDeletePrompt() {
    const focus = state.pendingDelete?.previousFocus;
    state.pendingDelete = null;
    $('confirm-overlay').hidden = true;
    if (focus?.isConnected) focus.focus();
  }

  function confirmDelete() {
    const pending = state.pendingDelete;
    if (!pending) return;
    closeDeletePrompt();
    if (pending.kind === 'all') post('deleteAllRuns');
    else post('deleteRun', { id: pending.id });
  }

  function readSettings() {
    return C.validatedSettings({
      add: $('op-add').checked, sub: $('op-sub').checked, mul: $('op-mul').checked, div: $('op-div').checked,
      addA: [$('add-a-min').value, $('add-a-max').value], addB: [$('add-b-min').value, $('add-b-max').value],
      mulA: [$('mul-a-min').value, $('mul-a-max').value], mulB: [$('mul-b-min').value, $('mul-b-max').value],
      duration: $('duration').value,
    });
  }

  function writeSettings(s) {
    for (const op of ['add', 'sub', 'mul', 'div']) $(`op-${op}`).checked = !!s[op];
    for (const [key, prefix] of [['addA','add-a'],['addB','add-b'],['mulA','mul-a'],['mulB','mul-b']]) {
      $(`${prefix}-min`).value = s[key][0]; $(`${prefix}-max`).value = s[key][1];
    }
    $('duration').value = s.duration;
    saveSettings(); renderMenu();
  }

  function saveSettings() {
    try { localStorage.setItem('zetamac-local-settings', JSON.stringify(readSettings())); } catch (_) {}
  }

  function setPreset(name) {
    document.querySelectorAll('.preset').forEach(button => button.classList.toggle('active', button.dataset.preset === name));
    if (name === 'classic') writeSettings(C.DEFAULT_SETTINGS);
    if (name === 'sprint') writeSettings({ ...C.DEFAULT_SETTINGS, addA: [2, 50], addB: [2, 50], mulA: [2, 5], mulB: [2, 50], duration: 60 });
  }

  function showView(view) {
    if (state.active && view !== 'game') return;
    state.view = view;
    document.body.dataset.view = view;
    document.querySelectorAll('.view').forEach(element => element.hidden = element.id !== `${view}-view`);
    document.querySelectorAll('.nav-btn').forEach(button => button.classList.toggle('active', button.dataset.view === view));
    document.body.classList.toggle('in-game', view === 'game');
    if (view === 'setup') renderMenu();
    if (view === 'history') renderHistory();
    if (view === 'progress') renderProgress();
    if (view === 'analytics') renderAnalytics();
  }

  function renderMenu() {
    let settings;
    try { settings = readSettings(); } catch (_) { settings = C.DEFAULT_SETTINGS; }
    const runs = C.comparableRuns(state.runs, { mode: 'timed', duration: settings.duration, key: C.settingsKey(settings) });
    const summary = C.runSummary(runs);
    $('menu-best').textContent = summary.best ?? '—';
    $('menu-latest').textContent = summary.latest ?? '—';
    $('menu-average').textContent = fmt(summary.recentAverage);
    $('menu-count').textContent = runs.length;
  }

  function startRun(mode) {
    let settings;
    try {
      settings = readSettings();
      $('settings-error').hidden = true;
    } catch (error) { $('settings-error').textContent = error.message; $('settings-error').hidden = false; return; }
    const target = Math.max(1, Math.min(60, Number($('practice-target').value) || 5));
    let practiceOp = null;
    if (mode === 'practice') {
      practiceOp = $('practice-op').value;
      settings = { ...settings, add: false, sub: false, mul: false, div: false, [practiceOp]: true };
    }
    const now = performance.now();
    state.active = {
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      startedAt: new Date().toISOString(), mode, duration: mode === 'timed' ? settings.duration : 0,
      settings: JSON.parse(JSON.stringify(settings)), questions: [], score: 0,
      startMs: now, deadlineMs: now + settings.duration * 1000,
      questionStartMs: now, current: null, practiceOp, target, underTarget: 0,
    };
    $('game-mode').textContent = mode === 'timed' ? 'TIMED RUN' : mode === 'zen' ? 'ZEN MODE' : `${C.OP_NAMES[practiceOp].toUpperCase()} PRACTICE`;
    $('game-time-label').textContent = mode === 'timed' ? 'Seconds left:' : 'Seconds elapsed:';
    $('game-score').textContent = '0';
    $('game-hint').textContent = mode === 'zen' ? 'Esc: leave without saving' : 'Esc: end without saving';
    $('end-run').textContent = mode === 'zen' ? 'Finish and save' : 'End run';
    $('practice-progress').hidden = mode !== 'practice';
    $('practice-mastered').textContent = '0 / 5';
    showView('game');
    nextQuestion(); updateClock();
    clearInterval(state.timer); state.timer = setInterval(updateClock, 80);
  }

  function nextQuestion() {
    const active = state.active;
    active.current = C.generateQuestion(active.settings, Math.random, active.practiceOp);
    active.questionStartMs = performance.now();
    $('game-expression').textContent = active.current.expression;
    $('answer').value = '';
    $('answer').focus();
  }

  function onAnswer() {
    const active = state.active;
    if (!active) return;
    const value = $('answer').value.trim();
    if (value !== String(active.current.answer)) return;
    const now = performance.now();
    if (active.mode === 'timed' && now >= active.deadlineMs) { finishRun(false); return; }
    const timeSec = Math.max(.001, (now - active.questionStartMs) / 1000);
    active.questions.push({ ...active.current, timeSec, atSec: (now - active.startMs) / 1000 });
    active.score++;
    $('game-score').textContent = active.score;
    if (active.mode === 'practice' && timeSec <= active.target) {
      active.underTarget++;
      $('practice-mastered').textContent = `${Math.min(active.underTarget, 5)} / 5`;
      if (active.underTarget >= 5) { finishRun(false); return; }
    }
    nextQuestion();
  }

  function updateClock() {
    const active = state.active;
    if (!active) return;
    const now = performance.now();
    if (active.mode === 'timed') {
      const remaining = Math.max(0, Math.ceil((active.deadlineMs - now) / 1000));
      $('game-time').textContent = remaining;
      if (now >= active.deadlineMs) finishRun(false);
    } else $('game-time').textContent = Math.floor((now - active.startMs) / 1000);
  }

  function finishRun(stoppedEarly) {
    const active = state.active;
    if (!active) return;
    clearInterval(state.timer); state.timer = null;
    const elapsed = Math.max(0, (performance.now() - active.startMs) / 1000);
    const run = {
      id: active.id, startedAt: active.startedAt,
      mode: stoppedEarly && active.mode === 'timed' ? 'aborted' : active.mode,
      duration: active.duration, elapsed: active.mode === 'timed' && !stoppedEarly ? active.duration : elapsed,
      settings: active.settings, score: active.score, questions: active.questions,
    };
    state.active = null;
    if (!stoppedEarly) {
      state.selectedRunId = run.id;
      post('saveRun', { run });
    }
    renderResult(run, { stoppedEarly, target: active.target, underTarget: active.underTarget });
    showView('result');
  }

  function statCard(label, value) { return `<div class="stat-card"><span>${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong></div>`; }

  function speedChart(questions) {
    if (!questions.length) return '<p class="muted">No solved questions to chart yet.</p>';
    const values = questions.map(q => q.timeSec);
    const max = Math.max(2, ...values) * 1.13;
    const W = 820, H = 190, L = 36, R = 14, T = 12, B = 30;
    const innerW = W - L - R, innerH = H - T - B;
    const barW = Math.min(18, innerW / values.length * .65);
    const bars = values.map((v, i) => {
      const x = L + (i + .5) * innerW / values.length - barW / 2;
      const h = v / max * innerH;
      const color = v >= 8 ? '#e37462' : v >= 4 ? '#e5ad53' : '#65a7ee';
      return `<rect x="${x}" y="${T + innerH - h}" width="${barW}" height="${h}" rx="3" fill="${color}"><title>#${i + 1}: ${escapeHTML(questions[i].expression)} · ${fmt(v, 2)}s</title></rect>`;
    }).join('');
    return `<div class="chart-wrap" style="height:190px"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Solve time for each question"><line x1="${L}" y1="${T + innerH}" x2="${W-R}" y2="${T + innerH}" class="chart-grid"/><text x="${L}" y="${H-6}" class="chart-axis">QUESTION 1</text><text x="${W-R}" y="${H-6}" text-anchor="end" class="chart-axis">QUESTION ${values.length}</text>${bars}</svg></div>`;
  }

  function questionTable(questions) {
    if (!questions.length) return '<p class="muted">No questions solved.</p>';
    return `<div class="table-wrap"><table class="data-table"><thead><tr><th>#</th><th>Problem</th><th>Answer</th><th>Operation</th><th>Time</th></tr></thead><tbody>${questions.map((q, i) => `<tr><td>${i+1}</td><td><strong>${escapeHTML(q.expression)}</strong></td><td>${escapeHTML(q.answer)}</td><td>${escapeHTML(C.OP_NAMES[q.op])}</td><td>${fmt(q.timeSec, 2)}s</td></tr>`).join('')}</tbody></table></div>`;
  }

  function runDetailHTML(run) {
    const times = run.questions.map(q => q.timeSec);
    const title = run.mode === 'timed' ? `${run.duration}s timed run` : run.mode === 'aborted' ? 'Stopped timed run' : run.mode === 'zen' ? 'Zen session' : 'Focused practice';
    return `<div class="detail-header"><div><h2>${title}</h2><p>${dateLabel(run.startedAt)} · ${escapeHTML(C.settingsLabel(run.settings))}</p></div><div class="detail-score">${run.score}</div></div><div class="stats-strip">${statCard('SCORE', run.score)}${statCard('AVG SOLVE', times.length ? `${fmt(C.mean(times), 2)}s` : '—')}${statCard('FASTEST', times.length ? `${fmt(Math.min(...times), 2)}s` : '—')}${statCard('ELAPSED', `${fmt(run.elapsed, 0)}s`)}</div><h3 class="section-title">Speed through the run</h3>${speedChart(run.questions)}<h3 class="section-title">Questions</h3>${questionTable(run.questions)}`;
  }

  function renderResult(run, context) {
    $('result-heading').textContent = context.stoppedEarly ? 'RUN STOPPED' : 'RUN COMPLETE';
    $('result-score').textContent = run.score;
    $('result-subtitle').textContent = run.score === 1 ? 'problem solved' : 'problems solved';
    $('result-message').textContent = context.stoppedEarly ? 'Stopped early · results shown here only, not saved' : run.mode === 'practice' ? `${context.underTarget} questions under ${context.target}s` : `${fmt(run.elapsed, 0)} seconds · ${C.settingsLabel(run.settings)}`;
    $('result-detail').innerHTML = `<div class="card history-detail">${runDetailHTML(run)}</div>`;
    $('play-again').onclick = () => startRun(run.mode === 'aborted' ? 'timed' : run.mode);
  }

  function renderHistory() {
    $('history-count').textContent = `${state.runs.length} saved`;
    $('delete-all-runs').disabled = state.runs.length === 0;
    if (!state.runs.length) {
      $('history-items').innerHTML = '';
      $('history-detail').innerHTML = '<div class="empty-card"><strong>No runs yet</strong>Complete a game and your history will appear here.</div>';
      return;
    }
    $('history-items').innerHTML = state.runs.map(run => `<button class="history-item ${run.id === state.selectedRunId ? 'active' : ''}" data-run-id="${escapeHTML(run.id)}"><span><strong>${dateLabel(run.startedAt)}</strong><small>${run.mode === 'timed' ? `${run.duration}s timed` : run.mode === 'aborted' ? 'Stopped early' : run.mode === 'zen' ? 'Zen mode' : 'Practice'} · ${escapeHTML(C.settingsLabel(run.settings))}</small></span><span class="item-score">${run.score}</span></button>`).join('');
    document.querySelectorAll('.history-item').forEach(button => button.addEventListener('click', () => { state.selectedRunId = button.dataset.runId; renderHistory(); }));
    const selected = state.runs.find(run => run.id === state.selectedRunId) || state.runs[0];
    $('history-detail').innerHTML = `<div class="history-detail-toolbar"><button id="delete-selected-run" class="secondary-button danger-button">Delete run</button></div>${runDetailHTML(selected)}`;
    $('delete-selected-run').addEventListener('click', () => askToDelete('one', selected.id));
  }

  function filterOptions() {
    const timed = state.runs.filter(run => run.mode === 'timed');
    if (!timed.length) return { timed, duration: null, key: null };
    const latest = timed[0];
    const durations = [...new Set(timed.map(run => run.duration))].sort((a,b) => a-b);
    if (state.durationFilter === null || !durations.includes(state.durationFilter)) state.durationFilter = latest.duration;
    const atDuration = timed.filter(run => run.duration === state.durationFilter);
    const keys = [...new Set(atDuration.map(run => C.settingsKey(run.settings)))];
    if (state.settingsFilter === null || !keys.includes(state.settingsFilter)) state.settingsFilter = C.settingsKey(atDuration[0].settings);
    const durationSelect = $('progress-duration');
    const settingsSelect = $('progress-settings');
    durationSelect.innerHTML = durations.map(d => `<option value="${d}">${d} seconds</option>`).join('');
    durationSelect.value = state.durationFilter;
    settingsSelect.innerHTML = keys.map((key, i) => {
      const run = atDuration.find(item => C.settingsKey(item.settings) === key);
      return `<option value="${i}">${escapeHTML(C.settingsLabel(run.settings))}${keys.length > 1 ? ` · set ${i+1}` : ''}</option>`;
    }).join('');
    settingsSelect.value = String(keys.indexOf(state.settingsFilter));
    settingsSelect.dataset.keys = JSON.stringify(keys);
    $('progress-period').value = state.periodFilter;
    return { timed, duration: state.durationFilter, key: state.settingsFilter };
  }

  function filteredRuns() {
    const options = filterOptions();
    if (!options.timed.length) return [];
    return C.comparableRuns(state.runs, { mode: 'timed', duration: options.duration, key: options.key, days: state.periodFilter === 'all' ? null : Number(state.periodFilter) });
  }

  function scoreChart(runs) {
    const W=900,H=300,L=47,R=17,T=22,B=42,innerW=W-L-R,innerH=H-T-B;
    const values=runs.map(r=>r.score), max=Math.max(5,...values)+3;
    const x=i=>L+(runs.length===1?innerW/2:i*innerW/(runs.length-1));
    const y=v=>T+innerH-v/max*innerH;
    const points=values.map((v,i)=>`${x(i)},${y(v)}`).join(' ');
    const area=`${x(0)},${T+innerH} ${points} ${x(values.length-1)},${T+innerH}`;
    const grid=[0,.25,.5,.75,1].map(p=>{const yy=T+innerH-p*innerH;return `<line x1="${L}" y1="${yy}" x2="${W-R}" y2="${yy}" class="chart-grid"/><text x="${L-10}" y="${yy+3}" text-anchor="end" class="chart-axis">${Math.round(p*max)}</text>`}).join('');
    const labels=runs.map((run,i)=>i===0||i===runs.length-1||i%Math.max(1,Math.ceil(runs.length/7))===0?`<text x="${x(i)}" y="${H-8}" text-anchor="middle" class="chart-axis">${dateShort(run.startedAt)}</text>`:'').join('');
    const circles=runs.map((run,i)=>`<circle cx="${x(i)}" cy="${y(run.score)}" r="4" class="chart-point"><title>${dateLabel(run.startedAt)} · Score ${run.score}</title></circle>`).join('');
    return `<div class="chart-wrap"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Scores over time">${grid}<polygon points="${area}" class="chart-area"/><polyline points="${points}" class="chart-line"/>${circles}${labels}</svg></div>`;
  }

  function renderProgress() {
    const runs = filteredRuns();
    if (!state.runs.some(run => run.mode === 'timed')) {
      $('progress-content').innerHTML = '<div class="card empty-card"><strong>No timed runs yet</strong>Complete a timed game to start your progress graph.</div>';
      return;
    }
    if (!runs.length) {
      $('progress-content').innerHTML = '<div class="card empty-card"><strong>No runs in this period</strong>Try a longer time period above.</div>';
      return;
    }
    const summary = C.runSummary(runs);
    const change = summary.priorAverage == null ? 'After 20 runs' : `${summary.recentAverage >= summary.priorAverage ? '+' : ''}${fmt(summary.recentAverage - summary.priorAverage, 1)} vs previous 10`;
    $('progress-content').innerHTML = `<div class="dashboard-grid">${statCard('LATEST SCORE',summary.latest)}${statCard('PERSONAL BEST',summary.best)}${statCard('LAST 10 AVERAGE',fmt(summary.recentAverage))}${statCard('COMPARABLE RUNS',summary.count)}</div><div class="card chart-card"><div class="chart-heading"><div><h2>Score over time</h2><p>One point per run, oldest to newest</p></div><span class="trend-note">${escapeHTML(change)}</span></div>${scoreChart(runs)}</div><div class="insight-row"><div class="card analysis-card"><h2>What the graph includes</h2><p>Runs with the same timer and number settings are compared together.</p><div class="callout">${runs.length} matching run${runs.length===1?'':'s'} · ${state.durationFilter}s · ${escapeHTML(C.settingsLabel(runs[0].settings))}</div></div><div class="card analysis-card"><h2>Practice volume</h2><p>Across the selected comparable runs</p><div class="analytic-values">${statCard('QUESTIONS SOLVED',summary.totalSolved)}${statCard('TOTAL TIME',`${fmt(summary.totalSeconds/60,1)} min`)}</div></div></div>`;
  }

  function renderAnalytics() {
    const runs = filteredRuns();
    const target = $('analytics-content');
    if (!runs.length) { target.innerHTML = '<div class="card empty-card"><strong>No comparable runs yet</strong>Complete a timed run to unlock your analytics.</div>'; return; }
    const questions = C.questionsOf(runs);
    const breakdown = C.operationBreakdown(questions);
    const maxMedian = Math.max(1, ...breakdown.map(op => op.median || 0));
    const opRows = breakdown.map(op => `<div class="op-meter-row"><span>${C.OP_SYMBOLS[op.op]} ${op.name}</span><div class="meter"><span style="width:${op.count ? Math.max(4,op.median/maxMedian*100) : 0}%;background:${colors[op.op]}"></span></div><strong>${op.count ? `${fmt(op.median,2)}s` : '—'}</strong></div>`).join('');
    const leaders = C.problemLeaderboard(questions, 2).slice(0, 8);
    const leaderTable = leaders.length ? `<div class="table-wrap tall"><table class="data-table"><thead><tr><th>Problem</th><th>Seen</th><th>Avg time</th></tr></thead><tbody>${leaders.map(q=>`<tr><td><strong>${escapeHTML(q.expression)}</strong></td><td>${q.count}</td><td>${fmt(q.average,2)}s</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Repeated problems will appear here after you have seen them twice.</p>';
    const distribution = C.speedDistribution(questions), total = distribution.reduce((a,b)=>a+b,0), distColors=['#48aa91','#6aa7e8','#e4ae56','#e47765'];
    const distBar = distribution.map((n,i)=>`<span style="width:${total?n/total*100:0}%;background:${distColors[i]}"></span>`).join('');
    const legend = ['Under 2s','2–4s','4–8s','8s+'].map((label,i)=>`<span><i style="background:${distColors[i]}"></i>${label}: ${distribution[i]}</span>`).join('');
    const record = count => { const values = runs.map(run => C.fastestWindow(run.questions,count)).filter(v=>v!=null); return values.length ? `${fmt(Math.min(...values),1)}s` : '—'; };
    const fatigueValues = runs.map(run => C.fatigue(run.questions)).filter(Boolean);
    const first = C.mean(fatigueValues.map(x=>x.first)), last = C.mean(fatigueValues.map(x=>x.last));
    const fatigueHTML = fatigueValues.length ? `<div class="fatigue-row"><div class="fatigue-bar"><div style="height:${Math.max(15,first/Math.max(first,last)*90)}px"></div>First quarter<br><strong>${fmt(first,2)}s</strong></div><div class="fatigue-bar"><div style="height:${Math.max(15,last/Math.max(first,last)*90)}px"></div>Last quarter<br><strong>${fmt(last,2)}s</strong></div></div><p class="alltime-note">Average solve time, from runs with at least eight answers.</p>` : '<p class="muted">Solve at least eight questions in a run to see pacing.</p>';
    target.innerHTML = `<div class="callout" style="margin:0 0 15px">Showing ${runs.length} comparable ${state.durationFilter}s runs. Change the duration or settings on the Progress page.</div><div class="analytics-grid"><div class="card analysis-card" style="margin:0"><h2>Operation speed</h2><p>Median solve time; shorter bars are faster</p><div class="op-list">${opRows}</div></div><div class="card analysis-card" style="margin:0"><h2>Speed distribution</h2><p>${questions.length} completed questions</p><div class="distribution">${distBar}</div><div class="legend">${legend}</div></div><div class="card analysis-card"><h2>Fastest streaks</h2><p>Best consecutive questions in a single run</p><div class="analytic-values">${statCard('FASTEST 10',record(10))}${statCard('FASTEST 25',record(25))}${statCard('FASTEST 50',record(50))}${statCard('FASTEST 100',record(100))}</div></div><div class="card analysis-card"><h2>Pacing within runs</h2><p>Does your speed change as the timer runs down?</p>${fatigueHTML}</div></div><div class="card analysis-card"><div class="chart-heading"><div><h2>Problems that slow you down</h2><p>Repeated problems ranked by average solve time</p></div></div><div style="margin-top:16px">${leaderTable}</div></div>`;
  }

  function exportCSV() {
    if (!state.runs.length) { toast('No runs to export yet.'); return; }
    const rows = [['run_id','started_at','mode','duration_seconds','score','settings','question_number','operation','problem','answer','solve_seconds']];
    for (const run of state.runs) {
      const common = [run.id,run.startedAt,run.mode,run.duration,run.score,JSON.stringify(run.settings)];
      if (!run.questions.length) rows.push([...common,'','','','','']);
      run.questions.forEach((q,i)=>rows.push([...common,i+1,q.op,q.expression,q.answer,Number(q.timeSec).toFixed(3)]));
    }
    const csv = rows.map(row => row.map(value => `"${String(value ?? '').replaceAll('"','""')}"`).join(',')).join('\r\n');
    post('exportCSV', { payload: { content: csv } });
  }

  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
  document.querySelectorAll('.preset').forEach(button => button.addEventListener('click', () => setPreset(button.dataset.preset)));
  $('reset-settings').addEventListener('click', () => setPreset('classic'));
  document.querySelectorAll('.settings-card input, .settings-card select').forEach(input => input.addEventListener('change', () => { document.querySelectorAll('.preset').forEach(button => button.classList.toggle('active', button.dataset.preset === 'custom')); saveSettings(); renderMenu(); }));
  $('start-timed').addEventListener('click', () => startRun('timed'));
  $('start-zen').addEventListener('click', () => startRun('zen'));
  $('start-practice').addEventListener('click', () => startRun('practice'));
  $('answer').addEventListener('input', onAnswer);
  $('end-run').addEventListener('click', () => finishRun(state.active?.mode !== 'zen'));
  $('progress-duration').addEventListener('change', event => { state.durationFilter = Number(event.target.value); state.settingsFilter = null; renderProgress(); renderAnalytics(); });
  $('progress-settings').addEventListener('change', event => { state.settingsFilter = JSON.parse(event.target.dataset.keys)[Number(event.target.value)]; renderProgress(); renderAnalytics(); });
  $('progress-period').addEventListener('change', event => { state.periodFilter = event.target.value; renderProgress(); renderAnalytics(); });
  document.querySelectorAll('.export-button').forEach(button => button.addEventListener('click', exportCSV));
  $('delete-all-runs').addEventListener('click', () => askToDelete('all'));
  $('cancel-delete').addEventListener('click', closeDeletePrompt);
  $('confirm-delete').addEventListener('click', confirmDelete);
  $('confirm-overlay').addEventListener('click', event => { if (event.target === $('confirm-overlay')) closeDeletePrompt(); });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (!$('confirm-overlay').hidden) { closeDeletePrompt(); return; }
    if (state.active) { event.preventDefault(); finishRun(true); }
  });
  document.body.dataset.view = 'setup';
  try { const saved = JSON.parse(localStorage.getItem('zetamac-local-settings') || 'null'); if (saved) writeSettings(C.validatedSettings(saved)); } catch (_) {}
  post('ready');
})();
