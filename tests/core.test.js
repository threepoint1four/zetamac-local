const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../Resources/core.js');

test('classic defaults match Zetamac and reject unusable settings', () => {
  assert.deepEqual(C.DEFAULT_SETTINGS.addA, [2, 100]);
  assert.deepEqual(C.DEFAULT_SETTINGS.mulA, [2, 12]);
  assert.equal(C.DEFAULT_SETTINGS.duration, 120);
  assert.throws(() => C.validatedSettings({ add: false, sub: false, mul: false, div: false }), /Select at least one/);
  assert.throws(() => C.validatedSettings({ addA: [12, 2] }), /minimum/);
});

test('generated answers and reversed operations stay integral and within configured operands', () => {
  const s = C.DEFAULT_SETTINGS;
  for (const op of ['add', 'sub', 'mul', 'div']) {
    for (let i = 0; i < 1000; i++) {
      const question = C.generateQuestion(s, Math.random, op);
      const [left, right] = question.expression.split(/ [＋+−×÷] /).map(Number);
      assert.equal(Number.isInteger(question.answer), true);
      if (op === 'add') assert.equal(left + right, question.answer);
      if (op === 'sub') assert.equal(left - right, question.answer);
      if (op === 'mul') assert.equal(left * right, question.answer);
      if (op === 'div') assert.equal(left / right, question.answer);
      assert.ok(question.answer >= 2);
    }
  }
});

test('progress only compares matching duration and operand settings', () => {
  const base = C.DEFAULT_SETTINGS;
  const custom = { ...base, addA: [2, 50] };
  const runs = [
    { id: 'a', mode: 'timed', duration: 120, settings: base, startedAt: '2026-01-01T00:00:00Z', score: 20, elapsed: 120, questions: [] },
    { id: 'b', mode: 'timed', duration: 60, settings: base, startedAt: '2026-01-02T00:00:00Z', score: 15, elapsed: 60, questions: [] },
    { id: 'c', mode: 'timed', duration: 120, settings: custom, startedAt: '2026-01-03T00:00:00Z', score: 30, elapsed: 120, questions: [] },
    { id: 'd', mode: 'zen', duration: 0, settings: base, startedAt: '2026-01-04T00:00:00Z', score: 100, elapsed: 400, questions: [] },
  ];
  const matching = C.comparableRuns(runs, { duration: 120, key: C.settingsKey(base) });
  assert.deepEqual(matching.map(run => run.id), ['a']);
  assert.equal(C.runSummary(matching).best, 20);
  assert.equal(C.settingsKey({ ...base, add: false, sub: false, addA: [4, 9] }), C.settingsKey({ ...base, add: false, sub: false }));
});

test('question metrics use solve time and consecutive windows', () => {
  const questions = [1, 2, 3, 4, 5].map((timeSec, i) => ({ op: i % 2 ? 'sub' : 'add', expression: '2 + 2', answer: 4, timeSec }));
  assert.equal(C.fastestWindow(questions, 3), 6);
  assert.equal(C.median([1, 9, 3, 2]), 2.5);
  assert.deepEqual(C.speedDistribution(questions), [1, 2, 2, 0]);
  assert.equal(C.problemLeaderboard(questions)[0].count, 5);
});
