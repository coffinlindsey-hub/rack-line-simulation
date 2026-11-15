/*
 * Floor layout: where each station sits, how big it is, and how far apart
 * things are for a robot that has to drive around the equipment.
 *
 * The simulation uses the distances from here to work out AMR travel time,
 * so moving a station changes the results. The 3D view draws the same
 * geometry. Units are metres. x runs along the building, y across it.
 *
 * No dependencies. Works in a browser (window.RackLayout) and in Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RackLayout = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Size of one work position (bay) and how many rows a station stacks them in.
  // These footprints are assumptions, chosen to look like a plausible floor.
  const SPEC = {
    recv: { name: 'Receiving and dock', bw: 5, bd: 6, rows: 4, bufSide: 'right' },
    kit: { name: 'Kitting and staging', bw: 4.5, bd: 4.5, rows: 2 },
    asm: { name: 'Rack assembly', bw: 5, bd: 5, rows: 2 },
    leak: { name: 'Liquid hookup and leak test', bw: 4.5, bd: 5, rows: 2 },
    test: { name: 'Functional test', bw: 3.2, bd: 4, rows: 2 },
    burn: { name: 'Burn in zone A', bw: 1.8, bd: 3.6, rows: 4 },
    burnB: { name: 'Burn in zone B', bw: 1.8, bd: 3.6, rows: 4 },
    repair: { name: 'Repair loop', bw: 4.5, bd: 4.5, rows: 2 },
    pack: { name: 'Final inspection and pack', bw: 5, bd: 5, rows: 2 },
    ship: { name: 'Dispatch', bw: 5, bd: 6, rows: 4, bufSide: 'right' },
    park: { name: 'AMR parking', bw: 2, bd: 2.4, rows: 2 },
  };
  const SLOT = { w: 1.3, d: 1.9 };   // one buffer slot on the floor
  const PAD = 1;                     // clear margin inside a zone
  const AISLE = 5;                   // gap between neighbouring zones
  const MAIN_AISLE = 8;              // the aisle between the two rows
  const EDGE = 4;                    // clearance to the walls
  const ZONE_IDS = ['recv', 'kit', 'asm', 'leak', 'test', 'burn', 'burnB', 'repair', 'pack', 'ship', 'park'];

  const int = (v) => Math.max(0, Math.round(v || 0));

  // How many work positions and buffer slots each zone has to hold.
  function counts(p) {
    const one = (v) => Math.max(1, int(v));
    return {
      recv: { n: one(p.recvDoors), cap: int(p.recvBuffer) },
      kit: { n: one(p.kitStations), cap: int(p.kitBuffer) },
      asm: { n: one(int(p.asmAuto) + int(p.asmAutoP2) + int(p.asmManual) + int(p.asmManualP2)), cap: int(p.asmBuffer) },
      leak: { n: one(p.leakStations), cap: int(p.leakBuffer) + 4 },
      test: { n: one(int(p.testPos) + int(p.testPosP2)), cap: int(p.testBuffer) + 6 },
      burn: { n: one(p.burnBaysA), cap: int(p.burnBuffer) },
      burnB: { n: int(p.burnBaysB), cap: 0 },
      repair: { n: one(p.repStations), cap: int(p.repBuffer) },
      pack: { n: one(int(p.packStations) + int(p.packStationsP2)), cap: int(p.packBuffer) },
      ship: { n: one(p.shipDoors), cap: int(p.shipBuffer) },
      park: { n: one(p.amrFleet), cap: 0 },
    };
  }

  // Size of a zone and the position of everything inside it, relative to its corner.
  function footprint(id, c) {
    const s = SPEC[id];
    const rows = Math.max(1, Math.min(s.rows, c.n));
    const cols = Math.max(1, Math.ceil(c.n / rows));
    const bayW = cols * s.bw, bayD = rows * s.bd;
    const cap = Math.min(c.cap, 80);
    const bRows = cap ? Math.max(1, Math.min(cap, Math.floor(bayD / SLOT.d))) : 0;
    const bCols = cap ? Math.ceil(cap / bRows) : 0;
    const bufW = bCols * SLOT.w + (cap ? 1.2 : 0);
    const w = bayW + bufW + 2 * PAD, d = bayD + 2 * PAD;
    const bufLeft = s.bufSide !== 'right';
    const bx = PAD + (bufLeft ? bufW : 0);
    const sx = PAD + (bufLeft ? 0 : bayW + 1.2);
    const bays = [], slots = [];
    for (let i = 0; i < c.n; i++) {
      const col = Math.floor(i / rows), r = i % rows;
      bays.push({ x: bx + (col + 0.5) * s.bw, y: PAD + (r + 0.5) * s.bd, w: s.bw, d: s.bd, row: r, col });
    }
    for (let i = 0; i < cap; i++) {
      const col = Math.floor(i / bRows), r = i % bRows;
      slots.push({ x: sx + (col + 0.5) * SLOT.w, y: PAD + (r + 0.5) * (bayD / bRows) });
    }
    return { w, d, bays, slots, cols, rows, bufW, bufLeft };
  }

  /*
   * Default arrangement: two rows either side of a main aisle.
   *   north row: receiving, kitting, assembly, leak test, functional test
   *   south row: dispatch, AMR parking, pack, burn in B, burn in A, repair
   * Material comes in and goes out on the same wall, and the flow makes a U.
   * Any zone with an entry in p.layout is placed where the user dragged it.
   */
  function build(p) {
    const cnt = counts(p);
    const zones = {};
    for (const id of ZONES_PRESENT(cnt)) zones[id] = Object.assign({ id, name: SPEC[id].name }, footprint(id, cnt[id]));
    const north = ['recv', 'kit', 'asm', 'leak', 'test'].filter((id) => zones[id]);
    const depthN = Math.max.apply(null, north.map((id) => zones[id].d));
    let x = EDGE;
    for (const id of north) { zones[id].x = x; zones[id].y = EDGE + depthN - zones[id].d; x += zones[id].w + AISLE; }
    const rightN = x - AISLE;
    const yS = EDGE + depthN + MAIN_AISLE;
    // docks share the west wall; the south row is stacked back from the east end
    x = EDGE;
    for (const id of ['ship', 'park'].filter((i) => zones[i])) { zones[id].x = x; zones[id].y = yS; x += zones[id].w + AISLE; }
    const westEnd = x;
    const east = ['repair', 'burn', 'burnB', 'pack'].filter((id) => zones[id]);
    let need = 0;
    for (const id of east) need += zones[id].w + AISLE;
    x = Math.max(rightN, westEnd + need - AISLE);
    for (const id of east) { x -= zones[id].w; zones[id].x = x; zones[id].y = yS; x -= AISLE; }

    const custom = p.layout || {};
    for (const id in custom) {
      if (!zones[id]) continue;
      zones[id].x = Math.max(EDGE / 2, custom[id].x);
      zones[id].y = Math.max(EDGE / 2, custom[id].y);
      zones[id].moved = true;
    }

    let fw = 0, fd = 0, cy = 0, k = 0;
    for (const id in zones) {
      const z = zones[id];
      fw = Math.max(fw, z.x + z.w); fd = Math.max(fd, z.y + z.d);
      cy += z.y + z.d / 2; k++;
    }
    const floor = { w: Math.ceil(fw + EDGE), d: Math.ceil(fd + EDGE) };
    cy /= k;

    // absolute coordinates, and a port on the side that faces the middle of the floor
    for (const id in zones) {
      const z = zones[id];
      for (const b of z.bays) { b.x += z.x; b.y += z.y; }
      for (const s of z.slots) { s.x += z.x; s.y += z.y; }
      const south = z.y + z.d / 2 < cy;
      const px = z.x + (z.bufW ? (z.bufLeft ? PAD + z.bufW / 2 : z.w - PAD - z.bufW / 2) : z.w / 2);
      z.port = { x: Math.min(floor.w - 1.5, Math.max(1.5, px)), y: south ? z.y + z.d + 1.5 : z.y - 1.5 };
      z.port.y = Math.min(floor.d - 1.5, Math.max(1.5, z.port.y));
    }

    // zones that sit on top of each other
    const overlaps = [];
    const ids = Object.keys(zones);
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const a = zones[ids[i]], b = zones[ids[j]];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.d && b.y < a.y + a.d) overlaps.push([ids[i], ids[j]]);
    }

    const geo = { floor, zones, overlaps, ids };
    route(geo);
    return geo;
  }

  function ZONES_PRESENT(cnt) { return ZONE_IDS.filter((id) => cnt[id].n > 0); }

  /*
   * Robot routing on a 1 m grid. Zones are obstacles. For every port a flood
   * fill gives the driving distance to every free cell, which gives both the
   * distance table and, by walking downhill, the path between any two ports.
   */
  function route(geo) {
    const W = geo.floor.w, D = geo.floor.d;
    const blocked = new Uint8Array(W * D);
    for (const id in geo.zones) {
      const z = geo.zones[id];
      for (let y = Math.max(0, Math.floor(z.y)); y < Math.min(D, Math.ceil(z.y + z.d)); y++)
        for (let x = Math.max(0, Math.floor(z.x)); x < Math.min(W, Math.ceil(z.x + z.w)); x++) blocked[y * W + x] = 1;
    }
    const cellOf = (pt) => Math.min(D - 1, Math.max(0, Math.floor(pt.y))) * W + Math.min(W - 1, Math.max(0, Math.floor(pt.x)));
    const fields = {};
    for (const id of geo.ids) {
      const start = cellOf(geo.zones[id].port);
      blocked[start] = 0;
    }
    for (const id of geo.ids) {
      const f = new Int32Array(W * D).fill(-1);
      const q = new Int32Array(W * D);
      let head = 0, tail = 0;
      const start = cellOf(geo.zones[id].port);
      f[start] = 0; q[tail++] = start;
      while (head < tail) {
        const c = q[head++], cx = c % W, cy = (c - cx) / W, d = f[c] + 1;
        if (cx > 0 && !blocked[c - 1] && f[c - 1] < 0) { f[c - 1] = d; q[tail++] = c - 1; }
        if (cx < W - 1 && !blocked[c + 1] && f[c + 1] < 0) { f[c + 1] = d; q[tail++] = c + 1; }
        if (cy > 0 && !blocked[c - W] && f[c - W] < 0) { f[c - W] = d; q[tail++] = c - W; }
        if (cy < D - 1 && !blocked[c + W] && f[c + W] < 0) { f[c + W] = d; q[tail++] = c + W; }
      }
      fields[id] = f;
    }
    const dist = {};
    geo.unreachable = [];
    for (const a of geo.ids) {
      dist[a] = {};
      for (const b of geo.ids) {
        const pa = geo.zones[a].port, pb = geo.zones[b].port;
        let d = fields[b][cellOf(pa)];
        if (d < 0) { d = Math.abs(pa.x - pb.x) + Math.abs(pa.y - pb.y); if (a < b) geo.unreachable.push([a, b]); }
        dist[a][b] = a === b ? 0 : Math.max(1, d);
      }
    }
    geo.dist = dist;

    const cache = {};
    // Path from port a to port b as a list of corner points.
    geo.path = function (a, b) {
      const key = a + '>' + b;
      if (cache[key]) return cache[key];
      const f = fields[b];
      const pa = geo.zones[a].port, pb = geo.zones[b].port;
      let c = cellOf(pa);
      const pts = [[pa.x, pa.y]];
      if (a !== b && f[c] > 0) {
        let dir = 0;
        const steps = [1, -1, W, -W];
        while (f[c] > 0) {
          let next = -1, nd = dir;
          const order = dir ? [dir].concat(steps.filter((s) => s !== dir)) : steps;
          for (const s of order) {
            const n = c + s;
            if (n < 0 || n >= W * D) continue;
            if ((s === 1 || s === -1) && Math.floor(n / W) !== Math.floor(c / W)) continue;
            if (f[n] === f[c] - 1) { next = n; nd = s; break; }
          }
          if (next < 0) break;
          if (nd !== dir && dir !== 0) pts.push([(c % W) + 0.5, Math.floor(c / W) + 0.5]);
          dir = nd; c = next;
        }
      }
      pts.push([pb.x, pb.y]);
      // cumulative length for interpolation
      const len = [0];
      for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      cache[key] = { pts, len, total: len[len.length - 1] };
      return cache[key];
    };
    // Position and heading a fraction f of the way along the path.
    geo.along = function (a, b, f) {
      const p = geo.path(a, b);
      const target = Math.max(0, Math.min(1, f)) * p.total;
      for (let i = 1; i < p.pts.length; i++) {
        if (target <= p.len[i] || i === p.pts.length - 1) {
          const seg = p.len[i] - p.len[i - 1];
          const t = seg > 0 ? (target - p.len[i - 1]) / seg : 0;
          const x0 = p.pts[i - 1][0], y0 = p.pts[i - 1][1], x1 = p.pts[i][0], y1 = p.pts[i][1];
          return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, heading: Math.atan2(y1 - y0, x1 - x0) };
        }
      }
      return { x: p.pts[0][0], y: p.pts[0][1], heading: 0 };
    };
  }

  return { SPEC, SLOT, ZONE_IDS, counts, footprint, build };
});
