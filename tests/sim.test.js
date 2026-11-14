// Run with:  node --test tests/sim.test.js
// Uses only what ships with Node. Nothing to install.
const test = require('node:test');
const assert = require('node:assert/strict');
const Sim = require('../sim.js');
const Params = require('../params.js');

const short = (set) => Object.assign(Params.defaults(), { warmupDays: 5, runDays: 21 }, set || {});

test('random distributions have the right averages', () => {
  const rng = Sim.dist.mulberry32(42);
  const n = 200000;
  let a = 0, b = 0, c = 0;
  for (let i = 0; i < n; i++) {
    a += Sim.dist.tri(rng, 10, 20, 60);
    b += Sim.dist.expo(rng, 5);
    c += Sim.dist.lognorm(rng, 4, 0.6);
  }
  assert.ok(Math.abs(a / n - 30) < 0.15, 'triangular mean');
  assert.ok(Math.abs(b / n - 5) < 0.05, 'exponential mean');
  assert.ok(Math.abs(c / n - 4) < 0.05, 'lognormal mean');
});

test('same seed gives the same answer, a different seed does not', () => {
  const p = short();
  const a = new Sim.Simulation(p, 7).run();
  const b = new Sim.Simulation(p, 7).run();
  const c = new Sim.Simulation(p, 8).run();
  assert.equal(a.completed, b.completed);
  assert.equal(a.lead.total, b.lead.total);
  assert.notEqual(a.lead.total, c.lead.total);
});

test('no rack is lost or invented', () => {
  for (const sc of Params.SCENARIOS) {
    const r = new Sim.Simulation(Object.assign(short(), sc.set), 3).run();
    assert.equal(r.arrived, r.doneAll + r.wipNow, sc.name);
  }
});

test('throughput never beats the theoretical bottleneck', () => {
  for (const sc of Params.SCENARIOS) {
    const p = Params.scenario(sc.id);
    const cap = Sim.theory(p, true).lineCapacity;
    const r = Sim.runReplications(p, 3);
    // 3% allowance: a finite run can drain a little of the WIP it started with
    assert.ok(r.perDay.mean <= Math.min(cap, p.demandPerDay) * 1.03,
      `${sc.name}: simulated ${r.perDay.mean.toFixed(2)} vs ceiling ${Math.min(cap, p.demandPerDay).toFixed(2)}`);
  }
});

test('a line with spare capacity delivers the demand', () => {
  const p = short({ demandPerDay: 10 });
  const r = Sim.runReplications(p, 3);
  assert.ok(Math.abs(r.perDay.mean - 10) / 10 < 0.05, `got ${r.perDay.mean}`);
});

test('a saturated line lands close to the hand calculation', () => {
  const p = Params.scenario('double');
  const cap = Sim.theory(p, false).lineCapacity;
  const r = Sim.runReplications(p, 3);
  assert.ok(r.perDay.mean > cap * 0.93, `simulated ${r.perDay.mean} vs hand calc ${cap}`);
  assert.equal(r.bottleneck.id, Sim.theory(p, false).bottleneck.id);
});

test('burn in never exceeds its power or cooling limit', () => {
  for (const id of ['base', 'liquid', 'double', 'phase2']) {
    const r = new Sim.Simulation(Params.scenario(id), 5).run();
    for (const z of r.zones) {
      assert.ok(z.maxKw <= z.kwCap + 1e-6, `${id} ${z.label} power`);
      assert.ok(z.maxCool <= z.coolCap + 1e-6, `${id} ${z.label} cooling`);
    }
  }
});

test('buffers never hold more than their size', () => {
  const r = new Sim.Simulation(Params.scenario('double'), 2).run();
  for (const s of r.stations) {
    if (s.id === 'test' || s.id === 'leak') continue; // racks returning from repair are always accepted
    assert.ok(s.maxQ <= s.cap, `${s.id}: ${s.maxQ} > ${s.cap}`);
  }
});

test('with no liquid cooled racks the leak test station is never used', () => {
  const r = new Sim.Simulation(short({ liquidShare: 0 }), 1).run();
  assert.equal(r.stations.find((s) => s.id === 'leak').visits, 0);
  assert.equal(r.completedLiq, 0);
});

test('station time shares add up to 100%', () => {
  const r = new Sim.Simulation(Params.scenario('phase2'), 1).run();
  for (const s of r.stations) {
    const sum = Object.values(s.shares).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-6, `${s.id} sums to ${sum}`);
  }
});

test('perfect yield means no repairs', () => {
  const p = short({ leakFpy: 1, testFpyAir: 1, testFpyLiq: 1, burnFpyAir: 1, burnFpyLiq: 1 });
  const r = new Sim.Simulation(p, 1).run();
  assert.equal(r.stations.find((s) => s.id === 'repair').visits, 0);
});

test('speeding up a station that is not the bottleneck changes nothing', () => {
  const base = Params.scenario('double');
  const faster = Object.assign({}, base, { kitStations: base.kitStations * 2 });
  const a = Sim.runReplications(base, 3).perDay.mean;
  const b = Sim.runReplications(faster, 3).perDay.mean;
  assert.ok(Math.abs(a - b) / a < 0.03, `${a} vs ${b}`);
});

test('lead time is at least the work content', () => {
  const p = Params.scenario('base');
  const r = Sim.runReplications(p, 3);
  const l = r.lead;
  assert.ok(l.total.mean >= l.touch.mean + l.machine.mean + l.move.mean - 1e-6);
});
