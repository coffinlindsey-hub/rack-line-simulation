/*
 * Discrete event simulation engine for a server rack integration line.
 *
 * No dependencies. Works in a browser (window.RackSim) and in Node (require).
 * Time unit inside the engine is hours. Parameters arrive in the units shown
 * on the page (minutes for manual work, hours for test and burn in) and are
 * converted here.
 *
 * How it works, in one paragraph: the engine keeps a list of future events
 * sorted by time (a truck arrives, a station finishes a rack, a shift ends,
 * a machine breaks). It jumps from one event to the next, updates the state
 * of the line, and schedules whatever follows. Nothing happens between
 * events, which is why this style is called "discrete event".
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./layout.js'));
  else root.RackSim = factory(root.RackLayout);
})(typeof self !== 'undefined' ? self : this, function (Layout) {
  'use strict';

  // ---------- random numbers and distributions ----------

  // Small seeded generator so a run can be repeated exactly.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Triangular: a minimum, a most likely value and a maximum.
  function tri(rng, a, c, b) {
    if (b <= a) return a;
    const u = rng();
    const f = (c - a) / (b - a);
    return u < f
      ? a + Math.sqrt(u * (b - a) * (c - a))
      : b - Math.sqrt((1 - u) * (b - a) * (b - c));
  }
  const triMean = (a, c, b) => (a + c + b) / 3;

  // Exponential: time between random, memoryless events such as breakdowns.
  function expo(rng, mean) {
    return -mean * Math.log(1 - rng());
  }

  // Lognormal: mostly near the mean with an occasional long one.
  function lognorm(rng, mean, cv) {
    if (cv <= 0) return mean;
    const s2 = Math.log(1 + cv * cv);
    const mu = Math.log(mean) - s2 / 2;
    const u1 = 1 - rng();
    const u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.exp(mu + Math.sqrt(s2) * z);
  }

  // ---------- event list (binary heap ordered by time) ----------

  class EventList {
    constructor() { this.h = []; this.seq = 0; }
    push(t, type, data) {
      const e = { t, s: this.seq++, type, data };
      const h = this.h;
      let i = h.length;
      h.push(e);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (h[p].t < e.t || (h[p].t === e.t && h[p].s < e.s)) break;
        h[i] = h[p];
        i = p;
      }
      h[i] = e;
    }
    peek() { return this.h[0]; }
    pop() {
      const h = this.h;
      const top = h[0];
      const last = h.pop();
      if (h.length) {
        let i = 0;
        const n = h.length;
        for (;;) {
          let c = 2 * i + 1;
          if (c >= n) break;
          if (c + 1 < n && (h[c + 1].t < h[c].t || (h[c + 1].t === h[c].t && h[c + 1].s < h[c].s))) c++;
          if (last.t < h[c].t || (last.t === h[c].t && last.s < h[c].s)) break;
          h[i] = h[c];
          i = c;
        }
        h[i] = last;
      }
      return top;
    }
    get length() { return this.h.length; }
  }

  // ---------- line definition built from parameters ----------

  const STATION_IDS = ['recv', 'kit', 'asm', 'leak', 'test', 'burn', 'repair', 'pack', 'ship'];
  const STATES = ['run', 'blocked', 'amr', 'starved', 'capped', 'down', 'off', 'offline'];
  const M = 1 / 60; // minutes to hours

  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }

  /*
   * Returns the nine stations. Each has one or more "pools" of identical
   * servers (a server is one work position: a dock door, an assembly
   * station, a test position, a burn in bay).
   *   time(type, rng, pool) -> hours for one visit
   *   mean(type, pool)      -> the average of that, for the hand calculation
   */
  function buildLine(p) {
    const liq = (t) => t === 'liq';
    const pool = (label, n, n2, extra) => Object.assign(
      { label, n: Math.max(0, Math.round(num(n, 0))), n2: Math.max(0, Math.round(num(n2, 0))), mtbf: 0, mttr: 0 }, extra || {});

    const triStation = (min, mode, max, mult) => ({
      time: (type, rng) => tri(rng, min, mode, max) * M * (liq(type) ? mult : 1),
      mean: (type) => triMean(min, mode, max) * M * (liq(type) ? mult : 1),
    });

    const recv = Object.assign({
      id: 'recv', name: 'Receiving and dock', short: 'Receive', staffed: true, cap: p.recvBuffer,
      pools: [pool('dock doors', p.recvDoors)],
    }, triStation(p.recvMin, p.recvMode, p.recvMax, 1));

    const kit = Object.assign({
      id: 'kit', name: 'Kitting and staging', short: 'Kit', staffed: true, cap: p.kitBuffer,
      pools: [pool('kitting stations', p.kitStations)],
    }, triStation(p.kitMin, p.kitMode, p.kitMax, p.kitLiqMult));

    // Automated cells are listed first so they are loaded first.
    const asm = {
      id: 'asm', name: 'Rack assembly', short: 'Assemble', staffed: true, cap: p.asmBuffer,
      pools: [
        pool('automated cells', p.asmAuto, p.asmAutoP2, { auto: true, mtbf: p.asmAutoMtbf, mttr: p.asmAutoMttr }),
        pool('manual stations', p.asmManual, p.asmManualP2, { mtbf: p.asmManualMtbf, mttr: p.asmManualMttr }),
      ],
      time: (type, rng, pl) => {
        const m = liq(type) ? p.asmLiqMult : 1;
        if (pl.auto) return tri(rng, p.asmMode * 0.9, p.asmMode, p.asmMode * 1.15) * p.asmAutoFactor * M * m;
        return tri(rng, p.asmMin, p.asmMode, p.asmMax) * M * m;
      },
      mean: (type, pl) => {
        const m = liq(type) ? p.asmLiqMult : 1;
        if (pl.auto) return triMean(p.asmMode * 0.9, p.asmMode, p.asmMode * 1.15) * p.asmAutoFactor * M * m;
        return triMean(p.asmMin, p.asmMode, p.asmMax) * M * m;
      },
    };

    const leak = {
      id: 'leak', name: 'Liquid cooling hookup and leak test', short: 'Leak test', staffed: true, cap: p.leakBuffer,
      liquidOnly: true,
      pools: [pool('leak test stations', p.leakStations)],
      time: (type, rng) => (tri(rng, p.leakHookMin, p.leakHookMode, p.leakHookMax) +
        p.leakHoldMin + rng() * (p.leakHoldMax - p.leakHoldMin)) * M,
      mean: () => (triMean(p.leakHookMin, p.leakHookMode, p.leakHookMax) + (p.leakHoldMin + p.leakHoldMax) / 2) * M,
    };

    const test = {
      id: 'test', name: 'Functional test', short: 'Test', staffed: false, cap: p.testBuffer,
      pools: [pool('test positions', p.testPos, p.testPosP2, { mtbf: p.testMtbf, mttr: p.testMttr })],
      time: (type, rng) => lognorm(rng, liq(type) ? p.testLiqH : p.testAirH, p.testCv),
      mean: (type) => (liq(type) ? p.testLiqH : p.testAirH),
    };

    // Burn in: each pool is a zone with its own bays, power and liquid cooling.
    const burn = {
      id: 'burn', name: 'Burn in', short: 'Burn in', staffed: false, cap: p.burnBuffer, zoned: true,
      pools: [
        pool('zone A bays', p.burnBaysA, 0, { kwCap: p.burnPowerA, coolCap: p.burnCoolA }),
        pool('zone B bays (phase 2)', 0, p.burnBaysB, { kwCap: p.burnPowerB, coolCap: p.burnCoolB }),
      ],
      duration: (type) => (liq(type) ? p.burnLiqH : p.burnAirH),
      setup: p.burnSetupMin * M,
      kw: (type) => (liq(type) ? p.kwLiq : p.kwAir),
      // A failing rack is caught part way through; the point is uniform over the run.
      mean: (type) => {
        const y = liq(type) ? p.burnFpyLiq : p.burnFpyAir;
        return p.burnSetupMin * M + (liq(type) ? p.burnLiqH : p.burnAirH) * (y + (1 - y) / 2);
      },
    };

    const repair = {
      id: 'repair', name: 'Repair loop', short: 'Repair', staffed: true, cap: p.repBuffer,
      pools: [pool('repair benches', p.repStations)],
      time: (type, rng) => lognorm(rng, p.repMeanH, p.repCv),
      mean: () => p.repMeanH,
    };

    const pack = Object.assign({
      id: 'pack', name: 'Final inspection and pack', short: 'Inspect, pack', staffed: true, cap: p.packBuffer,
      pools: [pool('pack stations', p.packStations, p.packStationsP2)],
    }, triStation(p.packMin, p.packMode, p.packMax, p.packLiqMult));

    const ship = Object.assign({
      id: 'ship', name: 'Dispatch', short: 'Dispatch', staffed: true, cap: p.shipBuffer,
      pools: [pool('outbound doors', p.shipDoors)],
    }, triStation(p.shipMin, p.shipMode, p.shipMax, 1));

    return [recv, kit, asm, leak, test, burn, repair, pack, ship];
  }

  // First pass yields by rack type.
  function yields(p, type) {
    const l = type === 'liq';
    return {
      leak: l ? p.leakFpy : 1,
      test: l ? p.testFpyLiq : p.testFpyAir,
      burn: l ? p.burnFpyLiq : p.burnFpyAir,
    };
  }

  /*
   * Expected visits to each station per finished rack. A rack that fails
   * goes to repair and then repeats the step, so yields below 100% mean
   * more than one visit on average.
   */
  function visits(p, type) {
    const y = yields(p, type);
    const vBurn = 1 / y.burn;
    const vTest = 1 / (y.test * y.burn);
    const vLeak = type === 'liq' ? 1 / y.leak : 0;
    const vRepair = (type === 'liq' ? vLeak - 1 : 0) + vTest * (1 - y.test) + vBurn * (1 - y.burn);
    return { recv: 1, kit: 1, asm: 1, leak: vLeak, test: vTest, burn: vBurn, repair: vRepair, pack: 1, ship: 1 };
  }

  /*
   * Expected rack moves between stations per finished rack, mix weighted.
   * This is the from-to chart of the line: multiply by racks per day to get
   * trips per day on each leg.
   */
  function flowPerRack(p) {
    const s = Math.min(1, Math.max(0, p.liquidShare));
    const acc = {};
    const add = (from, to, n) => { if (n > 0) acc[from + '>' + to] = (acc[from + '>' + to] || 0) + n; };
    for (const [type, share] of [['air', 1 - s], ['liq', s]]) {
      if (share <= 0) continue;
      const y = yields(p, type), v = visits(p, type);
      add('recv', 'kit', share); add('kit', 'asm', share);
      if (type === 'liq') {
        add('asm', 'leak', share); add('leak', 'repair', share * (v.leak - 1)); add('repair', 'leak', share * (v.leak - 1)); add('leak', 'test', share);
      } else add('asm', 'test', share);
      add('test', 'burn', share * v.burn);
      add('test', 'repair', share * v.test * (1 - y.test));
      add('burn', 'repair', share * v.burn * (1 - y.burn));
      add('repair', 'test', share * (v.test * (1 - y.test) + v.burn * (1 - y.burn)));
      add('burn', 'pack', share); add('pack', 'ship', share);
    }
    return Object.keys(acc).map((k) => ({ from: k.split('>')[0], to: k.split('>')[1], n: acc[k] }));
  }

  // Share of each calendar day a staffed station is scheduled to work.
  function staffedHoursPerDay(p) {
    return Math.min(24, p.shiftHoursPerDay) * Math.min(7, p.daysPerWeek) / 7;
  }

  /*
   * Hand calculation. For each station:
   *   capacity (racks/day) = servers x scheduled hours/day x availability
   *                          / work content per finished rack
   * where work content = mix weighted (visits x mean time per visit).
   * No randomness, no queues, no blocking: this is the ceiling.
   */
  function theory(p, withPhase2, geo) {
    const line = buildLine(p);
    const s = Math.min(1, Math.max(0, p.liquidShare));
    const mix = [['air', 1 - s], ['liq', s]];
    const rows = [];
    for (const st of line) {
      const hours = st.staffed ? staffedHoursPerDay(p) : 24;
      let cap = 0;
      let servers = 0;
      let work = 0; // hours of this station per finished rack, at the first pool
      const detail = {};
      if (st.zoned) {
        // Three limits per zone: bays, electrical power, liquid cooling.
        let bayHours = 0, kwHours = 0, coolHours = 0; // per finished rack
        for (const [type, share] of mix) {
          const v = visits(p, type).burn;
          const y = yields(p, type).burn;
          const powered = st.duration(type) * (y + (1 - y) / 2); // setup time draws no power
          bayHours += share * v * st.mean(type);
          kwHours += share * v * powered * st.kw(type);
          if (type === 'liq') coolHours += share * v * powered * st.kw(type);
        }
        work = bayHours;
        let byBay = 0, byKw = 0, byCool = 0;
        for (const pl of st.pools) {
          const n = pl.n + (withPhase2 ? pl.n2 : 0);
          if (!n) continue;
          servers += n;
          const b = n * 24 / bayHours;
          const k = kwHours > 0 ? pl.kwCap * 24 / kwHours : Infinity;
          const c = coolHours > 0 ? pl.coolCap * 24 / coolHours : Infinity;
          byBay += b; byKw += k; byCool += c;
          cap += Math.min(b, k, c);
        }
        detail.byBay = byBay; detail.byPower = byKw; detail.byCooling = byCool;
        detail.limit = cap >= byBay - 1e-9 ? 'bays' : (byCool < byKw ? 'liquid cooling capacity' : 'power capacity');
      } else {
        for (const pl of st.pools) {
          const n = pl.n + (withPhase2 ? pl.n2 : 0);
          if (!n) continue;
          servers += n;
          let w = 0;
          for (const [type, share] of mix) w += share * visits(p, type)[st.id] * st.mean(type, pl);
          if (!work) work = w;
          const avail = pl.mtbf > 0 ? pl.mtbf / (pl.mtbf + pl.mttr) : 1;
          cap += w > 0 ? n * hours * avail / w : Infinity;
        }
      }
      rows.push({ id: st.id, name: st.name, servers, hoursPerDay: hours, workPerRack: work, capacity: servers ? cap : 0, detail });
    }
    // AMR fleet: robot minutes per finished rack, from the floor distances.
    const g = geo || Layout.build(p);
    const fl = flowPerRack(p);
    const handle = triMean(p.amrHandleMin, p.amrHandleMode, p.amrHandleMax) * M;
    let amrH = 0, trips = 0, metres = 0;
    for (const f of fl) {
      const d = g.dist[f.from][f.to];
      // loaded leg, a pick up and a set down, and an empty approach assumed to be as long as the loaded leg
      amrH += f.n * (d / (p.amrSpeedLoaded * 3600) + d / (p.amrSpeedEmpty * 3600) + 2 * handle);
      trips += f.n; metres += f.n * d;
    }
    const dk = g.dist.kit.asm, carts = Math.round(p.kitCartTrips);
    amrH += carts * (dk / (p.amrSpeedLoaded * 3600) + dk / (p.amrSpeedEmpty * 3600) + handle);
    trips += carts; metres += carts * dk;
    rows.push({ id: 'amr', name: 'AMR fleet', servers: p.amrFleet, hoursPerDay: 24, workPerRack: amrH, capacity: p.amrFleet * 24 / amrH, detail: { trips, metres } });
    let bn = rows[0];
    for (const r of rows) if (r.capacity < bn.capacity) bn = r;
    const takt = p.demandPerDay > 0 ? staffedHoursPerDay(p) * 60 / p.demandPerDay : Infinity;
    // Lead time with zero waiting: every step once, at its mean.
    let floor = 0;
    for (const [type, share] of mix) {
      const v = visits(p, type);
      for (const st of line) floor += share * v[st.id] * st.mean(type, st.pools[st.pools.length - 1]);
    }
    return { rows, bottleneck: bn, lineCapacity: bn.capacity, taktMin: takt, leadFloorH: floor + amrH };
  }

  // ---------- the simulation ----------

  class Simulation {
    constructor(params, seed, geo) {
      const p = this.p = params;
      this.geo = geo || Layout.build(p);
      this.rng = mulberry32(seed == null ? 1 : seed);
      this.ev = new EventList();
      this.now = 0;
      this.warm = p.warmupDays * 24;
      this.end = (p.warmupDays + p.runDays) * 24;
      this.phase2T = (p.warmupDays + p.phase2Day) * 24;
      this.line = buildLine(p);
      this.byId = {};
      this.servers = [];
      this.nextRackId = 1;

      for (const st of this.line) {
        this.byId[st.id] = st;
        st.queue = [];
        st.reserved = 0;      // buffer slots promised to racks on their way
        st.qArea = 0; st.qSince = 0; st.maxQ = 0; st.visits = 0;
        st.servers = [];
        st.capped = false;
        st.poolsRt = st.pools.map((pl) => ({ def: pl, kw: 0, cool: 0, kwArea: 0, coolArea: 0, since: 0, maxKw: 0, maxCool: 0 }));
        st.pools.forEach((pl, pi) => {
          for (let i = 0; i < pl.n + pl.n2; i++) {
            const sv = {
              st, pool: pl, rt: st.poolsRt[pi], rack: null, phase: 'idle', down: false,
              online: i < pl.n, remaining: 0, endAt: null, token: 0, moveReq: false,
              state: 'offline', since: 0, acc: {}, next: null, fail: false,
            };
            for (const s of STATES) sv.acc[s] = 0;
            st.servers.push(sv);
            this.servers.push(sv);
          }
        });
      }

      this.onShift = this.shiftAt(0);
      this.backlog = [];           // racks' worth of material waiting at the gate
      this.waiting = [];           // finished servers waiting for space downstream
      this.amrQueue = [];          // moves waiting for a free AMR
      this.amrFree = Math.max(0, Math.round(p.amrFleet));
      this.amrBusyArea = 0; this.amrSince = 0;
      // each robot knows where it is parked and what it is doing
      this.amrs = [];
      for (let i = 0; i < this.amrFree; i++) this.amrs.push({ id: i, node: 'park', busy: false, legs: [], rack: null, cart: false });
      this.flows = {};             // rack moves by leg, after warm up
      this.metres = { loaded: 0, empty: 0 };
      this.wip = { air: 0, liq: 0 };
      this.wipArea = { air: 0, liq: 0 }; this.wipSince = 0;
      this.arrived = 0;
      this.done = { air: 0, liq: 0 };
      this.doneAll = 0;
      this.daily = new Array(Math.ceil(this.end / 24) + 1).fill(0);
      this.leads = [];             // per finished rack after warm up
      this.denyArea = { bay: 0, power: 0, cooling: 0 }; this.deny = null; this.denySince = 0;
      this.series = { t: [], wip: [], wipValue: [], backlog: [], q: {} };
      for (const st of this.line) this.series.q[st.id] = [];
      this.sampleH = 2;

      for (const sv of this.servers) {
        this.refresh(sv);
        if (sv.online) this.scheduleFail(sv);
      }
      // shift boundaries
      if (p.shiftHoursPerDay < 24 || p.daysPerWeek < 7) {
        for (let d = 0; d * 24 <= this.end; d++) {
          this.ev.push(d * 24, 'shift');
          if (p.shiftHoursPerDay < 24) this.ev.push(d * 24 + p.shiftHoursPerDay, 'shift');
        }
      }
      if (this.servers.some((s) => !s.online)) this.ev.push(this.phase2T, 'phase2');
      this.ev.push(0, 'truck');
      this.ev.push(0, 'sample');
    }

    // ----- helpers -----

    shiftAt(t) {
      const p = this.p;
      const day = Math.floor(t / 24 + 1e-9);
      return (day % 7) < p.daysPerWeek && (t - day * 24) < p.shiftHoursPerDay - 1e-9;
    }

    canWork(sv) { return sv.online && !sv.down && (!sv.st.staffed || this.onShift); }

    stateOf(sv) {
      if (!sv.online) return 'offline';
      if (sv.st.staffed && !this.onShift) return 'off';
      if (sv.down) return 'down';
      if (sv.phase === 'run') return 'run';
      if (sv.phase === 'done') return sv.moveReq ? 'amr' : 'blocked';
      return sv.st.capped ? 'capped' : 'starved';
    }

    // Close out the time spent in the old state, then switch.
    refresh(sv) {
      const s = this.stateOf(sv);
      if (s === sv.state) return;
      const from = Math.max(sv.since, this.warm);
      if (this.now > from) sv.acc[sv.state] += this.now - from;
      sv.state = s;
      sv.since = this.now;
    }

    qTouch(st) {
      const from = Math.max(st.qSince, this.warm);
      if (this.now > from) st.qArea += (this.now - from) * st.queue.length;
      st.qSince = this.now;
    }

    wipTouch() {
      const from = Math.max(this.wipSince, this.warm);
      if (this.now > from) {
        this.wipArea.air += (this.now - from) * this.wip.air;
        this.wipArea.liq += (this.now - from) * this.wip.liq;
      }
      this.wipSince = this.now;
    }

    amrTouch() {
      const from = Math.max(this.amrSince, this.warm);
      if (this.now > from) this.amrBusyArea += (this.now - from) * (this.p.amrFleet - this.amrFree);
      this.amrSince = this.now;
    }

    zoneTouch(rt) {
      const from = Math.max(rt.since, this.warm);
      if (this.now > from) { rt.kwArea += (this.now - from) * rt.kw; rt.coolArea += (this.now - from) * rt.cool; }
      rt.since = this.now;
    }

    denyTouch(reason) {
      const from = Math.max(this.denySince, this.warm);
      if (this.deny && this.now > from) this.denyArea[this.deny] += this.now - from;
      this.deny = reason;
      this.denySince = this.now;
    }

    scheduleFail(sv) {
      if (sv.pool.mtbf > 0) this.ev.push(this.now + expo(this.rng, sv.pool.mtbf), 'fail', sv);
    }

    pause(sv) {
      if (sv.phase === 'run' && sv.endAt != null) {
        sv.remaining = Math.max(0, sv.endAt - this.now);
        sv.endAt = null;
        sv.token++;
      }
    }

    resume(sv) {
      if (sv.phase === 'run' && sv.endAt == null && this.canWork(sv)) {
        sv.endAt = this.now + sv.remaining;
        this.ev.push(sv.endAt, 'done', { sv, token: sv.token });
      }
    }

    // ----- arrivals -----

    truck() {
      const p = this.p;
      if (p.demandPerDay <= 0) return;
      const n = Math.max(1, Math.round(p.truckBatch));
      for (let i = 0; i < n; i++) {
        this.backlog.push({ id: this.nextRackId++, type: this.rng() < p.liquidShare ? 'liq' : 'air', touch: 0, machine: 0, move: 0, repairs: 0, stage: 0 });
      }
      const interval = 24 * n / p.demandPerDay;
      const j = Math.min(0.95, Math.max(0, p.deliveryJitterPct / 100));
      this.ev.push(this.now + interval * tri(this.rng, 1 - j, 1, 1 + j), 'truck');
      this.feedYard();
    }

    // Material enters the dock yard only while the yard has room.
    feedYard() {
      const recv = this.byId.recv;
      let moved = false;
      while (this.backlog.length && recv.queue.length + recv.reserved < recv.cap) {
        const r = this.backlog.shift();
        r.tIn = this.now;
        this.wipTouch();
        this.wip[r.type]++;
        this.arrived++;
        this.qTouch(recv);
        recv.queue.push(r);
        if (recv.queue.length > recv.maxQ) recv.maxQ = recv.queue.length;
        moved = true;
      }
      if (moved) this.tryStart(recv);
    }

    // ----- starting work -----

    freeServer(st, rack) {
      for (const sv of st.servers) {
        if (sv.phase !== 'idle' || !this.canWork(sv)) continue;
        if (st.zoned) {
          const kw = st.kw(rack.type);
          if (sv.rt.kw + kw > sv.pool.kwCap + 1e-9) continue;
          if (rack.type === 'liq' && sv.rt.cool + kw > sv.pool.coolCap + 1e-9) continue;
        }
        return sv;
      }
      return null;
    }

    tryStart(st) {
      let started = false;
      if (st.zoned) {
        // First fit: a rack that fits may start ahead of one that does not.
        for (let i = 0; i < st.queue.length;) {
          const sv = this.freeServer(st, st.queue[i]);
          if (sv) {
            this.qTouch(st);
            const r = st.queue.splice(i, 1)[0];
            this.begin(sv, r);
            started = true;
          } else i++;
        }
        this.burnStatus(st);
      } else {
        while (st.queue.length) {
          const sv = this.freeServer(st, st.queue[0]);
          if (!sv) break;
          this.qTouch(st);
          this.begin(sv, st.queue.shift());
          started = true;
        }
      }
      if (started) {
        if (st.id === 'recv') this.feedYard();
        this.tryMoves();
      }
    }

    // Why is the rack at the head of the burn in queue not starting?
    burnStatus(st) {
      let reason = null;
      if (st.queue.length) {
        const r = st.queue[0];
        const kw = st.kw(r.type);
        let bay = false, power = false;
        for (const sv of st.servers) {
          if (sv.phase !== 'idle' || !this.canWork(sv)) continue;
          bay = true;
          if (sv.rt.kw + kw <= sv.pool.kwCap + 1e-9) power = true;
        }
        reason = !bay ? 'bay' : (!power ? 'power' : 'cooling');
      }
      const capped = reason === 'power' || reason === 'cooling';
      if (reason !== this.deny) this.denyTouch(reason);
      if (capped !== st.capped) {
        st.capped = capped;
        for (const sv of st.servers) this.refresh(sv);
      }
    }

    begin(sv, rack) {
      const st = sv.st;
      const y = yields(this.p, rack.type);
      let dur;
      sv.fail = false;
      if (st.zoned) {
        sv.fail = this.rng() > y.burn;
        const d = st.duration(rack.type);
        const powered = sv.fail ? d * this.rng() : d;
        dur = st.setup + powered;
        const kw = st.kw(rack.type);
        this.zoneTouch(sv.rt);
        sv.rt.kw += kw;
        if (rack.type === 'liq') sv.rt.cool += kw;
        if (sv.rt.kw > sv.rt.maxKw) sv.rt.maxKw = sv.rt.kw;
        if (sv.rt.cool > sv.rt.maxCool) sv.rt.maxCool = sv.rt.cool;
        sv.heldKw = kw;
      } else {
        dur = st.time(rack.type, this.rng, sv.pool);
        if (st.id === 'test') sv.fail = this.rng() > y.test;
        if (st.id === 'leak') sv.fail = this.rng() > y.leak;
      }
      if (st.staffed) rack.touch += dur; else rack.machine += dur;
      rack.at = st.id;
      st.visits++;
      sv.rack = rack;
      sv.phase = 'run';
      sv.dur = dur;
      sv.remaining = dur;
      sv.endAt = null;
      this.resume(sv);
      this.refresh(sv);
    }

    // ----- finishing work and routing -----

    finish(sv) {
      const st = sv.st;
      const rack = sv.rack;
      sv.endAt = null;
      if (st.zoned) {
        this.zoneTouch(sv.rt);
        sv.rt.kw -= sv.heldKw;
        if (rack.type === 'liq') sv.rt.cool -= sv.heldKw;
      }
      if (st.id === 'ship') {
        this.complete(rack);
        sv.rack = null; sv.phase = 'idle';
        this.refresh(sv);
        this.tryStart(st);
        return;
      }
      if (st.id === 'kit' && rack.stage < 1) rack.stage = 1;      // frame and parts staged
      if (st.id === 'asm') rack.stage = 2;                        // built
      if (st.id === 'pack') rack.stage = 3;                       // crated
      let next;
      switch (st.id) {
        case 'recv': next = 'kit'; break;
        case 'kit': next = 'asm'; break;
        case 'asm': next = rack.type === 'liq' ? 'leak' : 'test'; break;
        case 'leak': next = sv.fail ? 'repair' : 'test'; if (sv.fail) rack.returnTo = 'leak'; break;
        case 'test': next = sv.fail ? 'repair' : 'burn'; if (sv.fail) rack.returnTo = 'test'; break;
        case 'burn': next = sv.fail ? 'repair' : 'pack'; if (sv.fail) rack.returnTo = 'test'; break;
        case 'repair': next = rack.returnTo; rack.repairs++; break;
        default: next = 'ship';
      }
      sv.next = next;
      sv.phase = 'done';
      this.waiting.push(sv);
      this.refresh(sv);
      if (st.zoned) this.tryStart(st); // power was released
      this.tryMoves();
    }

    /*
     * A finished rack leaves its station only when the next buffer has a
     * free slot. Until then the station is blocked. Racks returning from
     * repair are always accepted, which keeps the repair loop from locking up.
     */
    tryMoves() {
      const w = this.waiting;
      let any = false;
      for (let i = 0; i < w.length;) {
        const sv = w[i];
        const to = this.byId[sv.next];
        const space = sv.st.id === 'repair' || to.queue.length + to.reserved < to.cap;
        if (space) {
          to.reserved++;
          sv.moveReq = true;
          this.refresh(sv);
          this.amrQueue.push({ sv, rack: sv.rack, from: sv.st, to });
          w.splice(i, 1);
          any = true;
        } else i++;
      }
      if (any) this.dispatchAmr();
    }

    nodeOf(sv) {
      return sv.st.zoned && sv.rt === sv.st.poolsRt[1] ? 'burnB' : sv.st.id;
    }

    // Give each waiting move to the nearest idle robot.
    dispatchAmr() {
      while (this.amrFree > 0 && this.amrQueue.length) {
        const mv = this.amrQueue.shift();
        const from = this.nodeOf(mv.sv);
        let best = null, bd = Infinity;
        for (const a of this.amrs) {
          if (a.busy) continue;
          const d = this.geo.dist[a.node][from];
          if (d < bd) { bd = d; best = a; }
        }
        this.assign(best, mv, from, mv.to.id);
      }
    }

    /*
     * Plan the robot's whole job as a list of legs with start and end times:
     * drive empty to the pickup, (for kitting: shuttle the component carts),
     * lift the rack, drive loaded along the routed path, set it down.
     */
    assign(amr, mv, from, to) {
      const p = this.p, dist = this.geo.dist;
      this.amrTouch();
      this.amrFree--;
      amr.busy = true;
      const legs = [];
      let t = this.now;
      const count = this.now >= this.warm;
      const drive = (a, b, load) => {
        if (a === b) return;
        const d = dist[a][b];
        const dur = d / ((load ? p.amrSpeedLoaded : p.amrSpeedEmpty) * 3600);
        legs.push({ a, b, t0: t, t1: t + dur, load });
        t += dur;
        if (count) this.metres[load ? 'loaded' : 'empty'] += d;
      };
      const hold = (node, f, load) => {
        const dur = tri(this.rng, p.amrHandleMin, p.amrHandleMode, p.amrHandleMax) * M * f;
        legs.push({ a: node, b: node, t0: t, t1: t + dur, load, hold: true });
        t += dur;
      };
      drive(amr.node, from, null);
      if (from === 'kit') {
        for (let i = 0; i < Math.round(p.kitCartTrips); i++) {
          hold(from, 0.5, 'cart'); drive(from, to, 'cart'); hold(to, 0.5, null); drive(to, from, null);
        }
      }
      hold(from, 1, null);
      const tPick = t;
      drive(from, to, 'rack');
      hold(to, 1, 'rack');
      amr.legs = legs;
      amr.mv = mv;
      mv.amr = amr; mv.t0 = this.now; mv.tPick = tPick; mv.tDrop = t; mv.toNode = to;
      mv.rack.move += t - this.now;
      if (count) { const k = from + '>' + to; this.flows[k] = (this.flows[k] || 0) + 1; }
      this.ev.push(tPick, 'pickup', mv);
      this.ev.push(t, 'drop', mv);
    }

    // The rack leaves its station; the position is free for the next one.
    pickup(mv) {
      const sv = mv.sv;
      mv.amr.rack = mv.rack;
      sv.rack = null; sv.phase = 'idle'; sv.moveReq = false; sv.next = null;
      this.refresh(sv);
      this.tryStart(sv.st);
    }

    drop(mv) {
      const to = mv.to, amr = mv.amr;
      amr.rack = null; amr.busy = false; amr.node = mv.toNode; amr.mv = null;
      this.amrTouch();
      this.amrFree++;
      to.reserved--;
      this.qTouch(to);
      to.queue.push(mv.rack);
      if (to.queue.length > to.maxQ) to.maxQ = to.queue.length;
      this.tryStart(to);
      this.dispatchAmr();
    }

    // Where a robot is right now: which leg, how far along, what it carries.
    amrAt(amr) {
      const L = amr.legs;
      for (let i = 0; i < L.length; i++) {
        if (this.now <= L[i].t1 || i === L.length - 1) {
          const l = L[i];
          if (this.now > l.t1) break;
          return { a: l.a, b: l.b, f: l.t1 > l.t0 ? Math.max(0, (this.now - l.t0) / (l.t1 - l.t0)) : 1, load: l.load, hold: !!l.hold };
        }
      }
      return { a: amr.node, b: amr.node, f: 1, load: null, hold: true, idle: true };
    }

    complete(rack) {
      this.wipTouch();
      this.wip[rack.type]--;
      this.doneAll++;
      this.daily[Math.floor(this.now / 24)]++;
      if (this.now >= this.warm) {
        this.done[rack.type]++;
        const lead = this.now - rack.tIn;
        this.leads.push({ type: rack.type, lead, touch: rack.touch, machine: rack.machine, move: rack.move, repairs: rack.repairs });
      }
    }

    // ----- shifts, breakdowns, phase 2 -----

    shiftChange() {
      const on = this.shiftAt(this.now);
      if (on === this.onShift) return;
      this.onShift = on;
      for (const sv of this.servers) {
        if (!sv.st.staffed) continue;
        if (on) this.resume(sv); else this.pause(sv);
        this.refresh(sv);
      }
      if (on) {
        for (const st of this.line) if (st.staffed) this.tryStart(st);
        this.tryMoves();
      }
    }

    fail(sv) {
      // Breakdowns only strike while the station is scheduled and up.
      if (!sv.online || sv.down || (sv.st.staffed && !this.onShift)) { this.scheduleFail(sv); return; }
      sv.down = true;
      this.pause(sv);
      this.refresh(sv);
      this.ev.push(this.now + lognorm(this.rng, sv.pool.mttr, 0.5), 'fixed', sv);
    }

    fixed(sv) {
      sv.down = false;
      this.resume(sv);
      this.refresh(sv);
      this.scheduleFail(sv);
      this.tryStart(sv.st);
    }

    phase2() {
      for (const sv of this.servers) {
        if (sv.online) continue;
        sv.online = true;
        this.refresh(sv);
        this.scheduleFail(sv);
      }
      for (const st of this.line) this.tryStart(st);
      this.tryMoves();
    }

    sample() {
      const s = this.series;
      const p = this.p;
      s.t.push(this.now);
      s.wip.push(this.wip.air + this.wip.liq);
      s.wipValue.push(this.wip.air * p.valueAir + this.wip.liq * p.valueLiq);
      s.backlog.push(this.backlog.length);
      for (const st of this.line) s.q[st.id].push(st.queue.length);
      if (this.now + this.sampleH <= this.end) this.ev.push(this.now + this.sampleH, 'sample');
    }

    // ----- main loop -----

    step() {
      const e = this.ev.pop();
      this.now = e.t;
      switch (e.type) {
        case 'truck': this.truck(); break;
        case 'done': if (e.data.token === e.data.sv.token && e.data.sv.phase === 'run') this.finish(e.data.sv); break;
        case 'pickup': this.pickup(e.data); break;
        case 'drop': this.drop(e.data); break;
        case 'shift': this.shiftChange(); break;
        case 'fail': this.fail(e.data); break;
        case 'fixed': this.fixed(e.data); break;
        case 'phase2': this.phase2(); break;
        case 'sample': this.sample(); break;
      }
    }

    runUntil(t) {
      const stop = Math.min(t, this.end);
      while (this.ev.length && this.ev.peek().t <= stop) this.step();
      this.now = stop;
      return this.now >= this.end;
    }

    run() { this.runUntil(this.end); return this.results(); }

    // ----- results for one replication -----

    results() {
      const p = this.p;
      const span = Math.max(1e-9, this.now - this.warm);
      const days = span / 24;
      // close open intervals
      for (const sv of this.servers) {
        const from = Math.max(sv.since, this.warm);
        if (this.now > from) sv.acc[sv.state] += this.now - from;
        sv.since = this.now;
      }
      for (const st of this.line) { this.qTouch(st); for (const rt of st.poolsRt) this.zoneTouch(rt); }
      this.wipTouch(); this.amrTouch(); this.denyTouch(this.deny);

      const stations = this.line.map((st) => {
        const sh = {};
        for (const s of STATES) sh[s] = 0;
        let total = 0;
        for (const sv of st.servers) for (const s of STATES) { sh[s] += sv.acc[s]; total += sv.acc[s]; }
        const online = total - sh.offline;
        const shares = {};
        for (const s of STATES) shares[s] = online > 0 && s !== 'offline' ? sh[s] / online : 0;
        const avail = sh.run + sh.blocked + sh.amr + sh.starved + sh.capped;
        return {
          id: st.id, name: st.name, shares,
          util: avail > 0 ? sh.run / avail : 0,
          load: avail > 0 ? (sh.run + sh.capped) / avail : 0,
          avgQ: st.qArea / span, maxQ: st.maxQ, cap: st.cap, visits: st.visits,
          servers: st.servers.length,
        };
      });
      const burn = this.byId.burn;
      const zones = burn.poolsRt.filter((rt) => rt.def.n + rt.def.n2 > 0).map((rt) => ({
        label: rt.def.label, avgKw: rt.kwArea / span, maxKw: rt.maxKw, kwCap: rt.def.kwCap,
        avgCool: rt.coolArea / span, maxCool: rt.maxCool, coolCap: rt.def.coolCap,
      }));
      const n = this.leads.length;
      const avg = (f) => (n ? this.leads.reduce((a, r) => a + f(r), 0) / n : 0);
      const lead = avg((r) => r.lead);
      const touch = avg((r) => r.touch), machine = avg((r) => r.machine), move = avg((r) => r.move);
      const completed = this.done.air + this.done.liq;
      const amrUtil = p.amrFleet > 0 ? this.amrBusyArea / (span * p.amrFleet) : 0;

      // Bottleneck: the resource working the largest share of its available time.
      let bn = { id: null, load: 0 };
      for (const s of stations) if (s.servers && s.load > bn.load) bn = { id: s.id, name: s.name, load: s.load };
      if (amrUtil > bn.load) bn = { id: 'amr', name: 'AMR fleet', load: amrUtil };

      return {
        days, completed, completedAir: this.done.air, completedLiq: this.done.liq,
        perDay: completed / days, perWeek: completed / days * 7,
        arrived: this.arrived, doneAll: this.doneAll, wipNow: this.wip.air + this.wip.liq,
        backlogEnd: this.backlog.length,
        stations, zones, amrUtil,
        deny: { bay: this.denyArea.bay / span, power: this.denyArea.power / span, cooling: this.denyArea.cooling / span },
        lead: { total: lead, touch, machine, move, wait: Math.max(0, lead - touch - machine - move), n },
        wipAvg: (this.wipArea.air + this.wipArea.liq) / span,
        wipValueAvg: (this.wipArea.air * p.valueAir + this.wipArea.liq * p.valueLiq) / span,
        daily: this.daily.slice(0, Math.ceil(this.end / 24)),
        series: this.series,
        bottleneck: bn,
        flows: Object.assign({}, this.flows),
        kmLoaded: this.metres.loaded / 1000 / days, kmEmpty: this.metres.empty / 1000 / days,
      };
    }
  }

  // ---------- replications ----------

  function stat(xs) {
    const n = xs.length;
    const mean = xs.reduce((a, b) => a + b, 0) / n;
    let min = Infinity, max = -Infinity, ss = 0;
    for (const x of xs) { if (x < min) min = x; if (x > max) max = x; ss += (x - mean) * (x - mean); }
    const sd = n > 1 ? Math.sqrt(ss / (n - 1)) : 0;
    // 95% t values for small samples
    const tv = [0, 12.71, 4.30, 3.18, 2.78, 2.57, 2.45, 2.36, 2.31, 2.26, 2.23, 2.20, 2.18, 2.16, 2.14, 2.13, 2.12, 2.11, 2.10, 2.09];
    const t = n > 1 ? (tv[n - 1] || 1.96) : 0;
    return { mean, min, max, sd, ci: t * sd / Math.sqrt(n), n };
  }

  /*
   * Run the same scenario several times with different random seeds and
   * summarize. One run is one possible month; several runs show how much
   * of the answer is luck.
   */
  function runReplications(params, reps, geo) {
    const n = Math.max(1, Math.round(reps == null ? params.replications : reps));
    const runs = [];
    for (let i = 0; i < n; i++) runs.push(new Simulation(params, (params.seed || 1) + i * 7919, geo || (geo = Layout.build(params))).run());
    const pick = (f) => stat(runs.map(f));
    const r0 = runs[0];
    const stations = r0.stations.map((s, i) => {
      const shares = {};
      for (const k of STATES) shares[k] = pick((r) => r.stations[i].shares[k]).mean;
      return {
        id: s.id, name: s.name, servers: s.servers, cap: s.cap, shares,
        util: pick((r) => r.stations[i].util), load: pick((r) => r.stations[i].load),
        avgQ: pick((r) => r.stations[i].avgQ), maxQ: Math.max.apply(null, runs.map((r) => r.stations[i].maxQ)),
        visits: pick((r) => r.stations[i].visits),
      };
    });
    // average the time series point by point, and keep the envelope
    const len = Math.min.apply(null, runs.map((r) => r.series.t.length));
    const band = (f) => {
      const mean = [], lo = [], hi = [];
      for (let k = 0; k < len; k++) {
        let s = 0, a = Infinity, b = -Infinity;
        for (const r of runs) { const v = f(r)[k]; s += v; if (v < a) a = v; if (v > b) b = v; }
        mean.push(s / n); lo.push(a); hi.push(b);
      }
      return { mean, lo, hi };
    };
    const q = {};
    for (const id of STATION_IDS) q[id] = band((r) => r.series.q[id]).mean;
    const dlen = r0.daily.length;
    const daily = { mean: [], lo: [], hi: [] };
    for (let d = 0; d < dlen; d++) {
      const s = stat(runs.map((r) => r.daily[d]));
      daily.mean.push(s.mean); daily.lo.push(s.min); daily.hi.push(s.max);
    }
    const amrUtil = pick((r) => r.amrUtil);
    let bn = { id: null, load: 0, name: '' };
    for (const s of stations) if (s.servers && s.load.mean > bn.load) bn = { id: s.id, name: s.name, load: s.load.mean };
    if (amrUtil.mean > bn.load) bn = { id: 'amr', name: 'AMR fleet', load: amrUtil.mean };
    return {
      reps: n, runs,
      perDay: pick((r) => r.perDay), perWeek: pick((r) => r.perWeek),
      completed: pick((r) => r.completed),
      lead: {
        total: pick((r) => r.lead.total), touch: pick((r) => r.lead.touch), machine: pick((r) => r.lead.machine),
        move: pick((r) => r.lead.move), wait: pick((r) => r.lead.wait),
      },
      wipAvg: pick((r) => r.wipAvg), wipValueAvg: pick((r) => r.wipValueAvg),
      backlogEnd: pick((r) => r.backlogEnd),
      amrUtil, stations,
      zones: r0.zones.map((z, i) => Object.assign({}, z, {
        avgKw: pick((r) => r.zones[i].avgKw).mean, avgCool: pick((r) => r.zones[i].avgCool).mean,
        maxKw: Math.max.apply(null, runs.map((r) => r.zones[i].maxKw)), maxCool: Math.max.apply(null, runs.map((r) => r.zones[i].maxCool)),
      })),
      deny: { bay: pick((r) => r.deny.bay).mean, power: pick((r) => r.deny.power).mean, cooling: pick((r) => r.deny.cooling).mean },
      series: { t: r0.series.t.slice(0, len), wip: band((r) => r.series.wip), wipValue: band((r) => r.series.wipValue), backlog: band((r) => r.series.backlog), q },
      daily, bottleneck: bn,
      kmLoaded: pick((r) => r.kmLoaded), kmEmpty: pick((r) => r.kmEmpty),
      flows: (() => {
        const keys = {};
        for (const r of runs) for (const k in r.flows) keys[k] = 1;
        const out = {};
        for (const k in keys) out[k] = pick((r) => (r.flows[k] || 0) / r.days).mean;
        return out;
      })(),
    };
  }

  return {
    Simulation, runReplications, theory, buildLine, visits, yields, staffedHoursPerDay, flowPerRack,
    STATION_IDS, STATES,
    dist: { mulberry32, tri, triMean, expo, lognorm },
  };
});
