/* Page logic: parameter form, live view, charts, comparison. The model itself is in sim.js. */
(function () {
  'use strict';
  const { SCHEMA, SOURCES, SCENARIOS, scenario } = RackParams;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

  const STATE_INFO = [
    ['run', 'Running'], ['blocked', 'Blocked (no room downstream)'], ['amr', 'Waiting for an AMR'],
    ['starved', 'Starved (nothing to work on)'], ['capped', 'Bay free, no power or cooling'], ['down', 'Down (breakdown)'], ['off', 'Off shift'],
  ];
  const LEAD_INFO = [['touch', 'Hands on work', 'run'], ['machine', 'Test and burn in', 'blocked'], ['move', 'Moving', 'amr'], ['wait', 'Waiting', 'starved']];
  const NAMES = { recv: 'Receiving and dock', kit: 'Kitting and staging', asm: 'Rack assembly', leak: 'Liquid hookup and leak test', test: 'Functional test', burn: 'Burn in', repair: 'Repair loop', pack: 'Final inspection and pack', ship: 'Dispatch', amr: 'AMR fleet' };

  const S = { scenarioId: 'base', params: scenario('base'), layout: null, res: null, th: null, th2: null, saved: null, live: null, liveT: 0, playing: true, visible: true, sel: null };

  // ---------- formatting ----------
  const f0 = (x) => Math.round(x).toLocaleString('en-US');
  const f1 = (x) => (Math.round(x * 10) / 10).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const pct = (x) => Math.round(x * 100) + '%';
  const money = (x) => (x >= 1e9 ? '$' + f1(x / 1e9) + 'B' : x >= 1e6 ? '$' + f1(x / 1e6) + 'M' : '$' + f0(x / 1e3) + 'K');
  const cap = (x) => (isFinite(x) ? f1(x) : 'no limit');
  const hrs = (h) => (h >= 48 ? f1(h / 24) + ' days' : f1(h) + ' h');
  const range = (s, f) => f(s.min) + ' to ' + f(s.max);
  const hasPhase2 = (p) => p.burnBaysB + p.asmManualP2 + p.asmAutoP2 + p.testPosP2 + p.packStationsP2 > 0;

  // ---------- tooltip ----------
  const tip = $('tip');
  function showTip(html, x, y) {
    tip.innerHTML = html; tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.max(6, Math.min(window.innerWidth - w - 6, x + 12)) + 'px';
    tip.style.top = Math.max(6, y - h - 12) + 'px';
  }
  const hideTip = () => { tip.hidden = true; };

  // ---------- charts (plain SVG, no library) ----------
  function niceMax(v) {
    if (v <= 0) return 1;
    const e = Math.pow(10, Math.floor(Math.log10(v)));
    const m = v / e;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * e;
  }
  const svgEl = (w, h) => `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img">`;

  function lineChart(host, o) {
    const W = Math.max(280, host.clientWidth || 600), H = W < 480 ? 190 : 230;
    const m = { l: 44, r: 12, t: 16, b: 28 };
    const x0 = o.x[0], x1 = o.x[o.x.length - 1];
    let ymax = 0;
    for (const v of (o.hi || o.mean)) if (v > ymax) ymax = v;
    for (const r of (o.refs || [])) if (r.y > ymax) ymax = r.y;
    if (o.other) for (const v of o.other.y) if (v > ymax) ymax = v;
    const tick = niceMax(ymax * 1.02 / 4);
    ymax = tick * Math.max(1, Math.ceil(ymax * 1.02 / tick));
    const nT = Math.round(ymax / tick);
    const X = (v) => m.l + (v - x0) / (x1 - x0 || 1) * (W - m.l - m.r);
    const Y = (v) => H - m.b - v / ymax * (H - m.t - m.b);
    const path = (xs, ys) => xs.map((x, i) => (i ? 'L' : 'M') + X(x).toFixed(1) + ' ' + Y(ys[i]).toFixed(1)).join('');
    let s = svgEl(W, H);
    for (const sh of (o.shades || [])) {
      s += `<rect class="shade" x="${X(sh.x0)}" y="${m.t}" width="${Math.max(0, X(sh.x1) - X(sh.x0))}" height="${H - m.t - m.b}"/>`;
      s += `<text x="${X(sh.x0) + 4}" y="${m.t + 12}">${sh.label}</text>`;
    }
    for (let i = 0; i <= nT; i++) {
      const v = tick * i;
      s += `<line class="ax" x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/>`;
      s += `<text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${o.yFmt(v)}</text>`;
    }
    const stepX = (x1 - x0) > 60 ? 14 : 7;
    for (let d = Math.ceil(x0 / stepX) * stepX; d <= x1; d += stepX) {
      s += `<text x="${X(d)}" y="${H - 8}" text-anchor="middle">${d === 0 ? 'day 0' : d}</text>`;
    }
    if (o.hi) {
      let band = path(o.x, o.hi);
      for (let i = o.x.length - 1; i >= 0; i--) band += 'L' + X(o.x[i]).toFixed(1) + ' ' + Y(o.lo[i]).toFixed(1);
      s += `<path class="bd" d="${band}Z"/>`;
    }
    for (const r of (o.refs || [])) {
      s += `<line class="ref" x1="${m.l}" x2="${W - m.r}" y1="${Y(r.y)}" y2="${Y(r.y)}"/>`;
      s += `<text class="lbl" x="${W - m.r - 2}" y="${Y(r.y) - 5}" text-anchor="end">${r.label}</text>`;
    }
    for (const v of (o.vlines || [])) {
      s += `<line class="ref" x1="${X(v.x)}" x2="${X(v.x)}" y1="${m.t}" y2="${H - m.b}"/>`;
      s += `<text class="lbl" x="${X(v.x) + 4}" y="${m.t + 12}">${v.label}</text>`;
    }
    if (o.other) s += `<path class="ln2" d="${path(o.other.x, o.other.y)}"/>`;
    s += `<path class="ln" d="${path(o.x, o.mean)}"/>`;
    s += `<line class="cross" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/>`;
    s += `<rect class="hit" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent"/></svg>`;
    host.innerHTML = s + (o.other ? `<div class="legend"><span><i style="background:var(--run)"></i>Current</span><span><i style="background:var(--ink3)"></i>Scenario A (dotted)</span></div>` : '');
    const hit = host.querySelector('.hit'), cross = host.querySelector('.cross');
    const move = (ev) => {
      const r = hit.getBoundingClientRect();
      const fx = (ev.clientX - r.left) / r.width;
      const i = Math.max(0, Math.min(o.x.length - 1, Math.round(fx * (o.x.length - 1))));
      cross.setAttribute('x1', X(o.x[i])); cross.setAttribute('x2', X(o.x[i])); cross.setAttribute('visibility', 'visible');
      showTip(o.tip(i), ev.clientX, ev.clientY);
    };
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); hideTip(); });
  }

  function miniChart(ys, capLine) {
    const W = 150, H = 56, m = 3;
    let ymax = Math.max(capLine, 1);
    for (const v of ys) if (v > ymax) ymax = v;
    const X = (i) => m + i / (ys.length - 1 || 1) * (W - 2 * m);
    const Y = (v) => H - m - v / ymax * (H - 2 * m);
    let d = '';
    ys.forEach((v, i) => { d += (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); });
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"><line class="ax" x1="${m}" x2="${W - m}" y1="${H - m}" y2="${H - m}"/>` +
      `<line class="ref" x1="${m}" x2="${W - m}" y1="${Y(capLine)}" y2="${Y(capLine)}"/><path class="ln" style="stroke-width:1.5" d="${d}"/></svg>`;
  }

  // ---------- parameter form ----------
  function buildParams() {
    const host = $('paramGroups');
    host.innerHTML = '';
    const groups = [];
    for (const s of SCHEMA) { if (!groups.includes(s.group)) groups.push(s.group); }
    let nS = 0, nA = 0;
    for (const g of groups) {
      const d = el('details', 'grp');
      const items = SCHEMA.filter((s) => s.group === g);
      d.appendChild(el('summary', '', `<span>${g}</span><small>${items.length} values</small>`));
      for (const s of items) {
        if (s.tag === 'sourced') nS++; else if (s.tag === 'assumption') nA++;
        const row = el('div', 'prm');
        row.dataset.key = s.key;
        const links = s.src.map((id) => `<a href="${SOURCES[id].url}" target="_blank" rel="noopener">${SOURCES[id].label}</a>`).join('; ');
        row.innerHTML = `<label for="p_${s.key}">${s.label}</label>` +
          `<div><input id="p_${s.key}" type="number" inputmode="decimal" min="${s.min}" max="${s.max}" step="${s.step}"><div class="unit">${s.unit}</div></div>` +
          `<div class="meta"><span class="tag ${s.tag}">${s.tag}</span>default ${s.def.toLocaleString('en-US')} ${s.unit}${s.note ? '. ' + s.note : ''}${links ? ' Source: ' + links + '.' : ''}</div>`;
        d.appendChild(row);
      }
      host.appendChild(d);
    }
    host.firstChild.open = true;
    $('paramCount').textContent = `${nS} values come from public sources. ${nA} are assumptions with no public figure behind them. All can be changed; results update as you type.`;
    host.addEventListener('input', (ev) => {
      const row = ev.target.closest('.prm');
      if (!row) return;
      const s = SCHEMA.find((x) => x.key === row.dataset.key);
      let v = parseFloat(ev.target.value);
      if (!isFinite(v)) return;
      v = Math.max(s.min, Math.min(s.max, v));
      S.params[s.key] = v;
      markParams();
      schedule();
    });
  }

  function fillParams() {
    for (const s of SCHEMA) $('p_' + s.key).value = S.params[s.key];
    markParams();
  }

  function markParams() {
    const base = scenario(S.scenarioId);
    let custom = false;
    for (const s of SCHEMA) {
      const row = $('p_' + s.key).closest('.prm');
      row.classList.toggle('changed', S.params[s.key] !== s.def);
      if (S.params[s.key] !== base[s.key]) custom = true;
    }
    S.custom = custom;
    document.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.id === S.scenarioId && !custom)));
    const sc = SCENARIOS.find((x) => x.id === S.scenarioId);
    $('scenarioBlurb').textContent = custom ? 'Custom: ' + sc.name.replace(/^\d+\. /, '') + ' with your changes (edited values are outlined in the parameter list).' : sc.blurb;
  }

  let timer = null;
  function schedule() {
    $('runStatus').textContent = 'Updating';
    clearTimeout(timer);
    timer = setTimeout(run, 350);
  }

  // ---------- run ----------
  function label() {
    const sc = SCENARIOS.find((x) => x.id === S.scenarioId);
    return (S.custom ? 'Custom (from ' : '') + sc.name.replace(/^\d+\. /, '') + (S.custom ? ')' : '');
  }

  function run() {
    const p = Object.assign({}, S.params);
    if (S.layout) p.layout = S.layout; else delete p.layout;
    const t0 = performance.now();
    S.geo = RackLayout.build(p);
    S.res = RackSim.runReplications(p, null, S.geo);
    S.th = RackSim.theory(p, false, S.geo);
    S.th2 = hasPhase2(p) ? RackSim.theory(p, true, S.geo) : null;
    S.ran = p;
    $('runStatus').textContent = `${S.res.reps} runs of ${p.runDays} days in ${Math.round(performance.now() - t0)} ms`;
    renderAll();
    resetLive();
  }

  function renderAll() {
    renderTiles(); renderBottleneck(); renderDaily(); renderStations(); renderTheory(); renderFlow(); renderWip(); renderLead(); renderCompare();
  }

  // ---------- headline ----------
  function renderTiles() {
    const r = S.res, p = S.ran, th = S.th;
    $('resultNote').textContent = `Average of ${r.reps} runs with different random numbers. Each run is ${p.warmupDays} days of warm up (not counted) and ${p.runDays} measured days. Ranges show the lowest and highest run.`;
    const perStaffed = r.perDay.mean > 0 ? RackSim.staffedHoursPerDay(p) * 60 / r.perDay.mean : Infinity;
    const tiles = [
      ['Throughput', `${f1(r.perDay.mean)} <small>racks/day</small>`, `range ${range(r.perDay, f1)} · target ${f0(p.demandPerDay)}`],
      ['Per week', `${f0(r.perWeek.mean)} <small>racks</small>`, `target ${f0(p.demandPerDay * 7)}`],
      ['Takt time', `${f0(th.taktMin)} <small>min</small>`, `staffed minutes per day / demand. Actual pace: one rack every ${isFinite(perStaffed) ? f0(perStaffed) : 'n/a'} min`],
      ['Lead time', `${hrs(r.lead.total.mean)}`, `range ${range(r.lead.total, hrs)}`],
      ['Work in progress', `${f0(r.wipAvg.mean)} <small>racks</small>`, `range ${range(r.wipAvg, f0)}`],
      ['WIP value', `${money(r.wipValueAvg.mean)}`, `range ${range(r.wipValueAvg, money)}`],
    ];
    $('tiles').innerHTML = tiles.map((t) => `<div class="tile"><div class="k">${t[0]}</div><div class="v">${t[1]}</div><div class="s">${t[2]}</div></div>`).join('');
  }

  function burnLimit(r) {
    const d = r.deny;
    if (d.bay + d.power + d.cooling < 0.02) return null;
    return d.bay >= d.power && d.bay >= d.cooling ? 'bays' : (d.cooling >= d.power ? 'liquid cooling capacity' : 'power capacity');
  }

  function renderBottleneck() {
    const r = S.res, p = S.ran;
    const th = S.th2 || S.th;
    const bn = r.bottleneck;
    const keeping = r.perDay.mean >= 0.97 * p.demandPerDay && r.backlogEnd.mean <= 2 * p.truckBatch;
    const sorted = th.rows.filter((x) => x.servers > 0 && isFinite(x.capacity)).sort((a, b) => a.capacity - b.capacity);
    const next = sorted.find((x) => x.id !== bn.id);
    const li = [];
    let title;
    if (keeping) {
      title = `The line keeps up with demand. Tightest resource: ${NAMES[bn.id]}`;
      li.push(`${NAMES[bn.id]} is busy ${pct(bn.load)} of its available time. It is the first place the line will pinch if demand grows.`);
      li.push(`By hand calculation it tops out at about ${cap(sorted[0].capacity)} racks/day (${NAMES[sorted[0].id]}).`);
    } else {
      title = `Bottleneck: ${NAMES[bn.id]}`;
      li.push(`${NAMES[bn.id]} is busy ${pct(bn.load)} of its available time. The line delivers ${f1(r.perDay.mean)} racks/day against a demand of ${f0(p.demandPerDay)}.`);
      if (r.backlogEnd.mean > 0) li.push(`Material for about ${f0(r.backlogEnd.mean)} racks is still waiting at the gate at the end of the run, and growing.`);
    }
    if (bn.id === 'burn') {
      const lim = burnLimit(r);
      if (lim) li.push(`Inside burn in, racks wait most often for <b>${lim}</b>. A rack was waiting for a bay ${pct(r.deny.bay)} of the time, for power ${pct(r.deny.power)}, for liquid cooling ${pct(r.deny.cooling)}.`);
    }
    if (bn.id === 'amr') {
      const w = r.stations.reduce((a, s) => a + s.shares.amr * s.servers, 0) / r.stations.reduce((a, s) => a + s.servers, 0);
      li.push(`Across the line, positions spend ${pct(w)} of their time holding a finished rack that is waiting for a robot.`);
    }
    if (next) li.push(`Next constraint by hand calculation: ${NAMES[next.id]} at about ${cap(next.capacity)} racks/day.`);
    const box = $('bottleneck');
    box.className = 'callout' + (keeping ? ' ok' : '');
    box.innerHTML = `<h3>${title}</h3><ul>${li.map((x) => `<li>${x}</li>`).join('')}</ul>`;
  }

  // ---------- charts ----------
  function renderDaily() {
    const r = S.res, p = S.ran;
    const x = r.daily.mean.map((_, d) => d - p.warmupDays + 1);
    const o = {
      x, mean: r.daily.mean, lo: r.daily.lo, hi: r.daily.hi, yFmt: f0,
      refs: [{ y: p.demandPerDay, label: 'target ' + f0(p.demandPerDay) }],
      shades: p.warmupDays > 0 ? [{ x0: x[0], x1: 0, label: 'warm up' }] : [],
      vlines: S.th2 ? [{ x: p.phase2Day, label: 'phase 2' }] : [],
      tip: (i) => `<b>Day ${x[i]}</b><br>${f1(r.daily.mean[i])} racks (runs ${f0(r.daily.lo[i])} to ${f0(r.daily.hi[i])})`,
    };
    if (S.saved) {
      const a = S.saved;
      o.other = { x: a.res.daily.mean.map((_, d) => d - a.params.warmupDays + 1), y: a.res.daily.mean };
    }
    lineChart($('chartDaily'), o);
  }

  function renderWip() {
    const r = S.res, p = S.ran, s = r.series;
    const x = s.t.map((t) => t / 24 - p.warmupDays);
    const shades = p.warmupDays > 0 ? [{ x0: x[0], x1: 0, label: 'warm up' }] : [];
    const vlines = S.th2 ? [{ x: p.phase2Day, label: 'phase 2' }] : [];
    lineChart($('chartWip'), { x, mean: s.wip.mean, lo: s.wip.lo, hi: s.wip.hi, yFmt: f0, shades, vlines,
      tip: (i) => `<b>Day ${f1(x[i])}</b><br>${f1(s.wip.mean[i])} racks on site<br>runs ${f0(s.wip.lo[i])} to ${f0(s.wip.hi[i])}<br>at the gate: ${f0(s.backlog.mean[i])}` });
    lineChart($('chartWipValue'), { x, mean: s.wipValue.mean, lo: s.wipValue.lo, hi: s.wipValue.hi, yFmt: money, shades, vlines,
      tip: (i) => `<b>Day ${f1(x[i])}</b><br>${money(s.wipValue.mean[i])}<br>runs ${money(s.wipValue.lo[i])} to ${money(s.wipValue.hi[i])}` });
    const host = $('queues');
    host.innerHTML = '';
    for (const st of r.stations) {
      const m = el('div', 'm', `<h4>${NAMES[st.id]}</h4><p>avg ${f1(st.avgQ.mean)} · peak ${st.maxQ} · buffer ${st.cap}</p>${miniChart(s.q[st.id], st.cap)}`);
      host.appendChild(m);
    }
  }

  function renderStations() {
    const r = S.res;
    $('stateLegend').innerHTML = STATE_INFO.map(([k, n]) => `<span><i style="background:var(--${k})"></i>${n}</span>`).join('');
    const host = $('stationBars');
    host.innerHTML = '';
    for (const st of r.stations) {
      if (!st.servers) continue;
      const row = el('div', 'sbar');
      let segs = '';
      for (const [k, n] of STATE_INFO) {
        const v = st.shares[k];
        if (v < 0.003) continue;
        segs += `<i style="flex:${v} 0 0;background:var(--${k})" data-tip="<b>${NAMES[st.id]}</b><br>${n}: ${f1(v * 100)}%"></i>`;
      }
      row.innerHTML = `<div class="nm">${NAMES[st.id]}</div><div class="bar">${segs}</div><div class="u" title="utilization">${pct(st.util.mean)}</div>`;
      host.appendChild(row);
    }
    let t = '<tr><th>Station</th><th>Positions</th><th>Utilization</th>' + STATE_INFO.map((s) => `<th>${s[1]}</th>`).join('') + '<th>Avg queue</th><th>Peak queue</th><th>Buffer</th></tr>';
    for (const st of r.stations) {
      t += `<tr><td>${NAMES[st.id]}</td><td>${st.servers}</td><td>${pct(st.util.mean)}</td>` + STATE_INFO.map(([k]) => `<td>${f1(st.shares[k] * 100)}%</td>`).join('') + `<td>${f1(st.avgQ.mean)}</td><td>${st.maxQ}</td><td>${st.cap}</td></tr>`;
    }
    t += `<tr><td>AMR fleet</td><td>${S.ran.amrFleet}</td><td>${pct(r.amrUtil.mean)}</td>${'<td></td>'.repeat(STATE_INFO.length + 3)}</tr>`;
    $('stationTable').innerHTML = t;
  }

  function renderTheory() {
    const r = S.res, p = S.ran, th = S.th, th2 = S.th2;
    const thr = r.perDay.mean;
    let t = `<tr><th>Station</th><th>Positions</th><th>Work per finished rack (h)</th><th>Hand calc capacity (racks/day)</th>${th2 ? '<th>After phase 2</th>' : ''}<th>Expected utilization at simulated output</th><th>Simulated utilization</th></tr>`;
    th.rows.forEach((row, i) => {
      const sim = row.id === 'amr' ? r.amrUtil.mean : r.stations[i].load.mean;
      const c2 = th2 ? th2.rows[i].capacity : row.capacity;
      // expected utilization uses the time weighted capacity when phase 2 arrives mid run
      const f = th2 ? Math.min(1, p.phase2Day / p.runDays) : 1;
      const effCap = th2 ? row.capacity * f + c2 * (1 - f) : row.capacity;
      const exp = row.servers || c2 ? (isFinite(effCap) && effCap > 0 ? pct(thr / effCap) : '0%') : 'n/a';
      t += `<tr class="${row.id === th.bottleneck.id ? 'hl' : ''}"><td>${NAMES[row.id]}</td><td>${row.servers}${th2 && th2.rows[i].servers !== row.servers ? ' then ' + th2.rows[i].servers : ''}</td><td>${f1(row.workPerRack)}</td><td>${cap(row.capacity)}</td>${th2 ? `<td>${cap(c2)}</td>` : ''}<td>${exp}</td><td>${pct(sim)}</td></tr>`;
    });
    $('theoryTable').innerHTML = t;

    const ceil1 = Math.min(th.lineCapacity, p.demandPerDay);
    let expected = ceil1;
    const li = [];
    li.push(`<b>Expected bottleneck by hand:</b> ${NAMES[th.bottleneck.id]} at ${cap(th.lineCapacity)} racks/day (highlighted row). Demand is ${f0(p.demandPerDay)}, so the most the line can deliver is ${f1(ceil1)}.`);
    if (th2) {
      const ceil2 = Math.min(th2.lineCapacity, p.demandPerDay);
      const f = Math.min(1, p.phase2Day / p.runDays);
      expected = ceil1 * f + ceil2 * (1 - f);
      li.push(`<b>Phase 2</b> moves the ceiling to ${f1(ceil2)} racks/day (${NAMES[th2.bottleneck.id]}) from day ${p.phase2Day}. Weighted by days, the run should average about ${f1(expected)}.`);
    }
    const gap = (r.perDay.mean - expected) / expected;
    li.push(`<b>Simulation:</b> ${f1(r.perDay.mean)} racks/day (runs ${range(r.perDay, f1)}). That is ${Math.abs(gap) < 0.005 ? 'in line with' : f1(Math.abs(gap) * 100) + '% ' + (gap < 0 ? 'below' : 'above')} the hand calculation.`);
    const b = th.rows[5].detail;
    li.push(`<b>Burn in has three limits.</b> By bays: ${cap(b.byBay)} racks/day. By power: ${cap(b.byPower)}. By liquid cooling: ${cap(b.byCooling)}. The lowest one governs: ${b.limit}.`);
    const fit = Math.floor(p.burnCoolA / p.kwLiq), fitP = Math.floor(p.burnPowerA / p.kwLiq);
    const ar = th.rows[th.rows.length - 1];
    li.push(`<b>Robots.</b> One finished rack needs about ${f1(ar.detail.trips)} robot trips covering ${f0(ar.detail.metres)} m loaded, which is ${f0(ar.workPerRack * 60)} robot minutes including pick up, set down and the empty drive back.`);
    const why = [];
    why.push('Times vary, so stations are sometimes blocked or starved even when average capacity is enough. The hand calculation ignores that, so the simulation should land a little under it and never over.');
    if (p.liquidShare > 0) why.push(`Power and cooling come in whole racks. Zone A cooling of ${f0(p.burnCoolA)} kW fits ${Math.min(fit, fitP)} AI racks at ${f0(p.kwLiq)} kW; the remainder is stranded. The hand calculation treats capacity as divisible.`);
    if (p.shiftHoursPerDay < 24) why.push('Manual stations stop at the end of the staffed day, and a finished rack can sit until morning. Robots are idle at night with little to move, so the fleet has less usable capacity than 24 hours of arithmetic suggests.');
    why.push('The robot row assumes each empty drive to a pickup is as long as the loaded drive that follows. The simulation sends the nearest idle robot, so the real empty distance depends on where robots happen to be.');
    if (th2) why.push('After phase 2 opens, the backlog built up in phase 1 takes time to work through, and new capacity is not full on its first day.');
    why.push('Breakdowns arrive in clusters, not evenly. A bad day at the bottleneck is lost for good; a good day cannot be saved up.');
    $('gap').innerHTML = `<ul>${li.map((x) => `<li>${x}</li>`).join('')}</ul><p><b>Why the two differ:</b></p><ul>${why.map((x) => `<li>${x}</li>`).join('')}</ul>`;
  }

  function renderFlow() {
    const r = S.res, geo = S.geo;
    const keys = Object.keys(r.flows).sort((a, b) => r.flows[b] - r.flows[a]);
    let trips = 0, rackM = 0;
    let t = '<tr><th>From</th><th>To</th><th>Moves per day</th><th>Distance (m)</th><th>Rack metres per day</th></tr>';
    for (const k of keys) {
      const [a, b] = k.split('>');
      if (!geo.zones[a] || !geo.zones[b]) continue;
      const d = geo.dist[a][b], n = r.flows[k];
      trips += n; rackM += n * d;
      t += `<tr><td>${geo.zones[a].name}</td><td style="text-align:left">${geo.zones[b].name}</td><td>${f1(n)}</td><td>${f0(d)}</td><td>${f0(n * d)}</td></tr>`;
    }
    t += `<tr class="hl"><td>Total</td><td></td><td>${f1(trips)}</td><td></td><td>${f0(rackM)}</td></tr>`;
    $('flowTable').innerHTML = t;
    const km = r.kmLoaded.mean + r.kmEmpty.mean;
    const tiles = [
      ['Rack moves', `${f0(trips)} <small>per day</small>`, 'between stations, including repair loops'],
      ['Robot travel', `${f1(km)} <small>km/day</small>`, `${f1(r.kmLoaded.mean)} loaded, ${f1(r.kmEmpty.mean)} empty`],
      ['Empty share', `${pct(km ? r.kmEmpty.mean / km : 0)}`, 'of robot distance carries nothing'],
      ['Floor', `${f0(geo.floor.w)} x ${f0(geo.floor.d)} <small>m</small>`, `${f0(geo.floor.w * geo.floor.d)} square metres` + (geo.overlaps.length ? '. Some stations overlap.' : '')],
    ];
    $('flowTiles').innerHTML = tiles.map((x) => `<div class="tile"><div class="k">${x[0]}</div><div class="v">${x[1]}</div><div class="s">${x[2]}</div></div>`).join('');
    if (S.view) S.view.setFlows(r.flows);
  }

  function leadRow(name, r, scale) {
    const L = r.lead;
    const segs = LEAD_INFO.map(([k, n, c]) => `<i style="flex:${L[k].mean / scale} 0 0;background:var(--${c})" data-tip="<b>${n}</b><br>${hrs(L[k].mean)} (${pct(L[k].mean / L.total.mean)})"></i>`).join('');
    const pad = `<i style="flex:${Math.max(0, 1 - L.total.mean / scale)} 0 0"></i>`;
    const txt = LEAD_INFO.map(([k, n]) => `${n} ${hrs(L[k].mean)}`).join(' · ');
    return `<div class="lead"><div class="t"><b>${name}: ${hrs(L.total.mean)}</b> (${f1(L.total.mean)} h, runs ${range(L.total, f1)})</div><div class="bar big">${segs}${pad}</div><div class="t">${txt}</div></div>`;
  }

  function renderLead() {
    const r = S.res;
    $('leadLegend').innerHTML = LEAD_INFO.map(([, n, c]) => `<span><i style="background:var(--${c})"></i>${n}</span>`).join('');
    const scale = Math.max(r.lead.total.mean, S.saved ? S.saved.res.lead.total.mean : 0) || 1;
    let h = leadRow(S.saved ? 'Current' : 'Average rack', r, scale);
    if (S.saved) h += leadRow('Scenario A, ' + S.saved.label, S.saved.res, scale);
    const L = r.lead;
    h += `<p class="note">Hands on work is ${pct(L.touch.mean / L.total.mean)} of the lead time. With zero waiting, the same rack would take about ${hrs(S.th.leadFloorH)}.</p>`;
    $('leadBars').innerHTML = h;
  }

  function renderCompare() {
    const host = $('compareBody');
    if (!S.saved) {
      host.innerHTML = '<p class="note">Press "Save as scenario A" at the top, then pick another scenario or change a parameter. The two will appear here side by side.</p>';
      $('clearA').hidden = true;
      return;
    }
    $('clearA').hidden = false;
    const a = S.saved, b = { res: S.res, params: S.ran, th: S.th2 || S.th, label: label() };
    const rows = [
      ['Throughput (racks/day)', (x) => `${f1(x.res.perDay.mean)}<br><small>${range(x.res.perDay, f1)}</small>`],
      ['Target (racks/day)', (x) => f0(x.params.demandPerDay)],
      ['Racks per week', (x) => f0(x.res.perWeek.mean)],
      ['Lead time', (x) => `${hrs(x.res.lead.total.mean)}`],
      ['of which waiting', (x) => `${hrs(x.res.lead.wait.mean)}`],
      ['WIP (racks)', (x) => f0(x.res.wipAvg.mean)],
      ['WIP value', (x) => money(x.res.wipValueAvg.mean)],
      ['Waiting at gate at end', (x) => f0(x.res.backlogEnd.mean)],
      ['Bottleneck', (x) => `${NAMES[x.res.bottleneck.id]}<br><small>${pct(x.res.bottleneck.load)} busy</small>`],
      ['Hand calc ceiling (racks/day)', (x) => cap(x.th.lineCapacity)],
      ['AMR fleet busy', (x) => pct(x.res.amrUtil.mean)],
      ['Robot travel (km/day)', (x) => f1(x.res.kmLoaded.mean + x.res.kmEmpty.mean)],
      ['Layout', (x) => (x.params.layout ? 'stations moved' : 'default')],
    ];
    let t = `<div class="scroll"><table class="tbl"><tr><th></th><th>A: ${a.label}</th><th>B: ${b.label}</th></tr>`;
    for (const [n, f] of rows) t += `<tr><td>${n}</td><td>${f(a)}</td><td>${f(b)}</td></tr>`;
    t += '</table></div>';
    const diffs = SCHEMA.filter((s) => a.params[s.key] !== b.params[s.key]).map((s) => `<li>${s.group}, ${s.label.toLowerCase()}: ${a.params[s.key].toLocaleString('en-US')} in A, ${b.params[s.key].toLocaleString('en-US')} in B (${s.unit})</li>`);
    t += `<div class="explain"><b>What is different between A and B</b><ul>${diffs.length ? diffs.join('') : '<li>Nothing yet. Pick another scenario or change a parameter.</li>'}</ul></div>`;
    host.innerHTML = t;
  }

  // ---------- live view ----------
  const STATION_KEYS = {
    recv: ['recvDoors', 'recvBuffer'], kit: ['kitStations', 'kitBuffer'], asm: ['asmManual', 'asmBuffer', 'asmAuto'], leak: ['leakStations', 'leakBuffer'],
    test: ['testPos', 'testBuffer'], burn: ['burnBaysA', 'burnBuffer'], repair: ['repStations', 'repBuffer'], pack: ['packStations', 'packBuffer'], ship: ['shipDoors', 'shipBuffer'],
  };
  const STAGE_TEXT = ['material on pallets', 'kitted, waiting for assembly', 'assembled', 'crated for shipping'];

  function initStage() {
    try {
      S.view = new RackScene.Scene3D($('stage'), {
        onPick: (hit) => { S.sel = hit && hit.type ? hit : null; renderInfo(true); },
        onMoveZone: (id, x, y) => {
          S.layout = Object.assign({}, S.layout || {}, { [id]: { x, y } });
          const before = S.res.kmLoaded.mean + S.res.kmEmpty.mean;
          run();
          const after = S.res.kmLoaded.mean + S.res.kmEmpty.mean;
          toast(`Robot travel ${f1(before)} to ${f1(after)} km/day. Output ${f1(S.res.perDay.mean)} racks/day.`);
        },
      });
    } catch (err) {
      S.view = null;
      $('noGl').hidden = false;
      $('cardsWrap').open = true;
    }
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
  }

  function resetLive() {
    const p = S.ran;
    S.live = new RackSim.Simulation(p, p.seed, S.geo);
    S.liveT = 0;
    if (S.view) { S.view.build(S.geo, p); S.view.setFlows(S.res.flows); S.view.attach(S.live); }
    const host = $('lineGrid');
    host.innerHTML = '';
    S.cards = {};
    S.live.line.forEach((st, i) => {
      const c = el('div', 'st');
      c.innerHTML = `<div class="st-h"><span class="n">${i + 1}</span><span>${NAMES[st.id]}</span></div><div class="lab">buffer</div><div class="dots"></div><div class="lab">positions</div><div class="sq"></div><div class="st-f"></div>`;
      host.appendChild(c);
      S.cards[st.id] = { card: c, dots: c.querySelector('.dots'), sq: c.querySelector('.sq'), foot: c.querySelector('.st-f'), a: '', b: '', c: '' };
      c.classList.toggle('bn', S.res.bottleneck.id === st.id);
    });
    $('liveLegend').innerHTML = '<span><b>Light on each position:</b></span>' + STATE_INFO.map(([k, n]) => `<span><i style="background:var(--${k})"></i>${n}</span>`).join('') +
      '<span>Racks with blue and red side pipes are liquid cooled AI racks</span>';
    $('scrub').max = p.warmupDays + p.runDays;
    $('resetLayout').hidden = !S.layout;
    $('layoutNote').textContent = S.geo.overlaps.length ? 'Some stations overlap. Robots route around the outside.' : (S.layout ? 'Custom layout in use.' : '');
    S.sel = S.sel && S.sel.type === 'station' ? S.sel : null;
    renderLive(0);
    renderInfo(true);
  }

  // Jump to a point in time: rebuild the run and play it forward to there.
  function seek(days) {
    const p = S.ran;
    S.live = new RackSim.Simulation(p, p.seed, S.geo);
    S.liveT = days * 24;
    S.live.runUntil(S.liveT);
    if (S.view) S.view.attach(S.live);
    if (S.sel && S.sel.type !== 'station') S.sel = null;
    renderLive(0);
    renderInfo(true);
  }

  function renderCards() {
    const sim = S.live, p = S.ran;
    for (const st of sim.line) {
      const c = S.cards[st.id];
      const n = Math.min(60, Math.max(st.cap, st.queue.length));
      let a = '';
      for (let i = 0; i < n; i++) a += i < st.queue.length ? (st.queue[i].type === 'liq' ? 'l' : 'a') : '.';
      if (a !== c.a) { c.a = a; c.dots.innerHTML = a.split('').map((ch) => (ch === 'l' ? '<i class="liq"></i>' : ch === 'a' ? '<i class="air"></i>' : '<i></i>')).join(''); }
      let b = '';
      for (const sv of st.servers) b += `<i class="${sim.stateOf(sv)}${sv.rack && sv.rack.type === 'liq' ? ' l' : ''}"></i>`;
      if (b !== c.b) { c.b = b; c.sq.innerHTML = b; }
      let f = '';
      if (st.id === 'recv') f = `at the gate: ${sim.backlog.length}`;
      else if (st.id === 'ship') f = `dispatched: ${sim.doneAll}`;
      else if (st.id === 'burn') f = burnGauges(st, true);
      else f = `waiting: ${st.queue.length} of ${st.cap}`;
      if (f !== c.c) { c.c = f; c.foot.innerHTML = f; }
    }
    const busy = p.amrFleet - sim.amrFree;
    let bots = '';
    for (let i = 0; i < p.amrFleet; i++) bots += `<i class="${i < busy ? 'busy' : ''}"></i>`;
    $('amrStrip').innerHTML = `<span>AMRs</span><span class="bots">${bots}</span><span>${busy} of ${p.amrFleet} busy, ${sim.amrQueue.length} moves waiting</span>`;
  }

  function burnGauges(st, bars) {
    let f = '';
    for (const rt of st.poolsRt) {
      if (!st.servers.some((sv) => sv.rt === rt && sv.online)) continue;
      const z = rt.def.label.slice(0, 6);
      const g = (v, c) => (bars ? `<div class="gauge"><b class="${v > 0.9 * c ? 'hot' : ''}" style="width:${c ? Math.min(100, v / c * 100) : 0}%"></b></div>` : '<br>');
      f += `${z} power ${f0(rt.kw)} / ${f0(rt.def.kwCap)} kW${g(rt.kw, rt.def.kwCap)}${z} cooling ${f0(rt.cool)} / ${f0(rt.def.coolCap)} kW${g(rt.cool, rt.def.coolCap)}`;
    }
    return f;
  }

  function renderLive(dt) {
    const sim = S.live, p = S.ran;
    if (S.view) { S.view.update(dt, S.playing ? parseFloat($('speed').value) : 0); S.view.render(); }
    if ($('cardsWrap').open) renderCards();
    if (!S.scrubbing) $('scrub').value = sim.now / 24;
    const dd = sim.now / 24 - p.warmupDays;
    $('scrubLabel').textContent = dd < 0 ? `warm up day ${f1(sim.now / 24)}` : `day ${f1(dd)} of ${p.runDays}`;
    const t = sim.now, day = Math.floor(t / 24), hh = Math.floor(t - day * 24), mm = Math.floor((t - day * 24 - hh) * 60);
    const slow = parseFloat($('speed').value) < 0.1;      // at slow speeds show minutes and seconds
    const ss = Math.floor(((t - day * 24 - hh) * 60 - mm) * 60);
    const dtxt = day < p.warmupDays ? `Warm up day ${day + 1} of ${p.warmupDays}` : `Day ${day - p.warmupDays + 1} of ${p.runDays}`;
    const html = `<span><b>${dtxt}</b>, ${String(hh).padStart(2, '0')}:${String(slow ? mm : mm - mm % 10).padStart(2, '0')}${slow ? ':' + String(ss).padStart(2, '0') : ''}</span><span class="pill ${sim.onShift ? 'on' : ''}">${sim.onShift ? 'staffed shift' : 'off shift'}</span>` +
      (S.th2 ? `<span class="pill ${t >= sim.phase2T ? 'on' : ''}">${t >= sim.phase2T ? 'phase 2 online' : 'phase 1 only'}</span>` : '') +
      `<span>dispatched ${sim.doneAll}</span><span>at gate ${sim.backlog.length}</span>`;
    if (html !== S.clockHtml) { S.clockHtml = html; $('clock').innerHTML = html; }
  }

  // ---------- info panel for whatever was clicked ----------
  function renderInfo(force) {
    const box = $('info'), sim = S.live, sel = S.sel;
    if (S.view) S.view.sel = sel;
    if (!sel || !sim) { box.hidden = true; return; }
    let h = '';
    if (sel.type === 'station') {
      const st = sim.byId[sel.station];
      const r = S.res.stations.find((x) => x.id === st.id);
      const th = S.th.rows.find((x) => x.id === st.id);
      const count = {};
      for (const sv of st.servers) { const s = sim.stateOf(sv); count[s] = (count[s] || 0) + 1; }
      const now = STATE_INFO.filter(([k]) => count[k]).map(([k, n]) => `${count[k]} ${n.split(' (')[0].toLowerCase()}`).join(', ') + (count.offline ? `, ${count.offline} not built yet` : '');
      h = `<h4>${NAMES[st.id]}</h4><dl><dt>Right now</dt><dd>${now}</dd><dt>Waiting</dt><dd>${st.queue.length} of ${st.cap}</dd>` +
        (st.id === 'burn' ? `<dt>Services</dt><dd>${burnGauges(st, false)}</dd>` : '') +
        `<dt>Utilization (whole run)</dt><dd>${pct(r.util.mean)}</dd><dt>Hand calc capacity</dt><dd>${cap(th.capacity)} racks/day</dd><dt>Simulated output</dt><dd>${f1(S.res.perDay.mean)} racks/day</dd></dl>`;
      for (const key of STATION_KEYS[st.id]) {
        const s = SCHEMA.find((x) => x.key === key);
        h += `<div class="step"><span>${s.label}</span><div><button data-step="-1" data-key="${key}" aria-label="fewer">&minus;</button><b>${S.params[key]}</b><button data-step="1" data-key="${key}" aria-label="more">+</button></div></div>`;
      }
      h += `<div class="step"><span>Camera</span><div><button data-zoom="${sel.zone || st.id}" style="width:auto;padding:0 10px;font-size:13px">Zoom here</button></div></div>`;
    } else if (sel.type === 'rack') {
      let rack = null, where = '';
      for (const st of sim.line) {
        const q = st.queue.find((x) => x.id === sel.id);
        if (q) { rack = q; where = `waiting at ${NAMES[st.id]}`; }
        for (const sv of st.servers) if (sv.rack && sv.rack.id === sel.id) { rack = sv.rack; where = `${sv.phase === 'run' ? 'in work at' : 'finished at'} ${NAMES[st.id]}`; }
      }
      for (const a of sim.amrs) if (a.rack && a.rack.id === sel.id) { rack = a.rack; where = `on robot ${a.id + 1}, going to ${NAMES[a.mv.to.id]}`; }
      if (!rack) { S.sel = null; box.hidden = true; return; }
      h = `<h4>Rack ${rack.id}</h4><dl><dt>Type</dt><dd>${rack.type === 'liq' ? 'Liquid cooled AI rack' : 'Standard air cooled rack'}</dd><dt>Stage</dt><dd>${STAGE_TEXT[rack.stage]}</dd><dt>Where</dt><dd>${where}</dd>` +
        `<dt>On site for</dt><dd>${hrs(sim.now - rack.tIn)}</dd><dt>Hands on work so far</dt><dd>${hrs(rack.touch)}</dd><dt>Test and burn in so far</dt><dd>${hrs(rack.machine)}</dd><dt>Trips to repair</dt><dd>${rack.repairs}</dd></dl>`;
    } else if (sel.type === 'amr') {
      const a = sim.amrs[sel.id];
      if (!a) { S.sel = null; box.hidden = true; return; }
      const at = sim.amrAt(a);
      const nm = (id) => (S.geo.zones[id] ? S.geo.zones[id].name : id);
      const doing = at.idle ? `idle at ${nm(a.node)}` : at.hold ? `${at.load ? 'setting down' : 'picking up'} at ${nm(at.a)}` : `${at.load === 'rack' ? 'carrying a rack' : at.load === 'cart' ? 'carrying a parts cart' : 'driving empty'} from ${nm(at.a)} to ${nm(at.b)}`;
      h = `<h4>Robot ${a.id + 1}</h4><dl><dt>Doing</dt><dd>${doing}</dd><dt>Moves waiting for a robot</dt><dd>${sim.amrQueue.length}</dd><dt>Fleet busy (whole run)</dt><dd>${pct(S.res.amrUtil.mean)}</dd></dl>` +
        `<div class="step"><span>AMR fleet size</span><div><button data-step="-1" data-key="amrFleet">&minus;</button><b>${S.params.amrFleet}</b><button data-step="1" data-key="amrFleet">+</button></div></div>`;
    }
    h = '<button class="x" data-close="1" aria-label="Close">&times;</button>' + h;
    if (force || h !== S.infoHtml) { S.infoHtml = h; box.innerHTML = h; }
    box.hidden = false;
  }

  let last = null, infoT = 0;
  function frame(ts) {
    requestAnimationFrame(frame);
    if (!S.live) return;
    if (last == null) { last = ts; return; }
    const dt = Math.min(0.1, (ts - last) / 1000);
    last = ts;
    if (!S.visible) return;
    if (S.playing && !S.scrubbing) {
      S.liveT += dt * parseFloat($('speed').value);
      const done = S.live.runUntil(S.liveT);
      if (done) { S.live = new RackSim.Simulation(S.ran, S.ran.seed, S.geo); S.liveT = 0; if (S.view) S.view.attach(S.live); }
    }
    renderLive(dt);
    infoT += dt;
    if (infoT > 0.4) { infoT = 0; renderInfo(false); }
  }

  // ---------- wiring ----------
  function setParam(key, v) {
    const s = SCHEMA.find((x) => x.key === key);
    S.params[key] = Math.max(s.min, Math.min(s.max, v));
    $('p_' + key).value = S.params[key];
    markParams();
    run();
  }

  function init() {
    const chips = $('scenarioChips');
    for (const sc of SCENARIOS) {
      const b = el('button', 'chip', sc.name);
      b.dataset.id = sc.id;
      b.addEventListener('click', () => { S.scenarioId = sc.id; S.params = scenario(sc.id); fillParams(); run(); });
      chips.appendChild(b);
    }
    buildParams();
    fillParams();
    initStage();
    $('sourceList').innerHTML = Object.values(SOURCES).map((s) => `<li><a href="${s.url}" target="_blank" rel="noopener">${s.label}</a>. ${s.says}</li>`).join('');
    $('saveA').addEventListener('click', () => {
      S.saved = { label: label() + (S.layout ? ', stations moved' : ''), params: Object.assign({}, S.ran), res: S.res, th: S.th2 || S.th };
      $('runStatus').textContent = 'Saved as A. Now pick another scenario, change a parameter or move a station.';
      renderDaily(); renderLead(); renderCompare();
    });
    $('clearA').addEventListener('click', () => { S.saved = null; renderDaily(); renderLead(); renderCompare(); });
    $('resetParams').addEventListener('click', () => { S.params = scenario(S.scenarioId); fillParams(); run(); });
    document.addEventListener('keydown', (ev) => {
      if (ev.code === 'Space' && !/INPUT|SELECT|BUTTON|TEXTAREA|SUMMARY/.test(ev.target.tagName)) { ev.preventDefault(); $('play').click(); }
      if (ev.key === 'Escape' && $('live').classList.contains('expanded')) $('expand').click();
    });
    $('play').addEventListener('click', () => {
      S.playing = !S.playing;
      $('play').textContent = S.playing ? 'Pause' : 'Play';
      $('play').setAttribute('aria-pressed', String(S.playing));
    });
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { S.playing = false; $('play').textContent = 'Play'; }
    if ('IntersectionObserver' in window) new IntersectionObserver((es) => { S.visible = es[0].isIntersecting; }).observe($('live'));
    $('scrub').addEventListener('input', (ev) => { S.scrubbing = true; seek(parseFloat(ev.target.value)); });
    $('scrub').addEventListener('change', () => { S.scrubbing = false; });
    $('scrub').addEventListener('pointerup', () => { S.scrubbing = false; });

    // camera and view toggles
    $('viewBtns').addEventListener('click', (ev) => {
      const b = ev.target.closest('button');
      if (!b || !S.view) return;
      if (b.dataset.view) S.view.setView(b.dataset.view);
      else if (b.id === 'zoomIn') S.view.zoom(0.8);
      else if (b.id === 'zoomOut') S.view.zoom(1.25);
      else if (b.id === 'expand') {
        const on = !$('live').classList.contains('expanded');
        $('live').classList.toggle('expanded', on);
        document.body.classList.toggle('locked', on);
        b.textContent = on ? 'Close' : 'Full screen';
        S.view.expanded = on;
        S.view.renderer.domElement.style.touchAction = on ? 'none' : 'pan-y';
        setTimeout(() => S.view.resize(), 30);
      }
    });
    $('tLabels').addEventListener('change', (ev) => { if (S.view) S.view.showLabels = ev.target.checked; });
    $('tFlow').addEventListener('change', (ev) => { if (S.view) { S.view.showFlow = ev.target.checked; S.view.setFlows(S.res.flows); } });
    $('tEdit').addEventListener('change', (ev) => {
      if (!S.view) return;
      S.view.editing = ev.target.checked;
      if (ev.target.checked) { S.view.setView('plan'); toast('Drag a station to move it. Robots take new routes and the results rerun when you let go.'); }
    });
    $('resetLayout').addEventListener('click', () => { S.layout = null; run(); toast('Layout reset to the default.'); });
    $('info').addEventListener('click', (ev) => {
      const b = ev.target.closest('button');
      if (!b) return;
      if (b.dataset.close) { S.sel = null; renderInfo(true); }
      else if (b.dataset.key) setParam(b.dataset.key, S.params[b.dataset.key] + parseFloat(b.dataset.step));
      else if (b.dataset.zoom && S.view) S.view.focusZone(b.dataset.zoom);
    });

    document.addEventListener('pointermove', (ev) => {
      const t = ev.target.closest && ev.target.closest('[data-tip]');
      if (t) showTip(t.dataset.tip, ev.clientX, ev.clientY);
      else if (!ev.target.closest || !ev.target.closest('.hit')) hideTip();
    });
    document.addEventListener('pointerdown', (ev) => {
      const t = ev.target.closest && ev.target.closest('[data-tip]');
      if (t) showTip(t.dataset.tip, ev.clientX, ev.clientY);
    });
    let rz = null;
    window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (S.view) S.view.resize(); if (S.res) { renderDaily(); renderWip(); } }, 200); });
    run();
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
