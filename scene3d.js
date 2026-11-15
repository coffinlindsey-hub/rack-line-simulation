/*
 * 3D view of the factory, drawn with three.js (vendor/three.min.js).
 *
 * It draws exactly what the simulation and the layout say: every rack,
 * buffer slot, work position and robot is where the model has it at that
 * moment. Equipment shapes are simple stand ins built from boxes and
 * cylinders. They are there to make the floor readable, not to be accurate
 * drawings of real machines.
 */
(function (root) {
  'use strict';
  const T = root.THREE;

  const STATE_HEX = { run: 0x2a78d6, blocked: 0xeb6834, amr: 0x1baf7a, starved: 0xeda100, capped: 0x6250d6, down: 0xe34948, off: 0x8d8c86, offline: 0x55544f };
  const STAFFED = { recv: 1, kit: 1, asm: 1, leak: 1, repair: 1, pack: 1, ship: 1 };

  // ---------- small helpers ----------
  const mat = (color, o) => new T.MeshStandardMaterial(Object.assign({ color, roughness: 0.75, metalness: 0.05 }, o || {}));
  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }
  function box(w, h, d, material, x, y, z, parent, shadow) {
    const m = new T.Mesh(new T.BoxGeometry(w, h, d), material);
    m.position.set(x, y, z);
    m.userData.bake = 'box';
    if (shadow !== false) { m.castShadow = true; m.receiveShadow = true; }
    if (parent) parent.add(m);
    return m;
  }
  function cyl(r, h, material, x, y, z, parent, seg) {
    const m = new T.Mesh(new T.CylinderGeometry(r, r, h, seg || 12), material);
    m.position.set(x, y, z);
    m.userData.bake = 'cyl';
    m.castShadow = true;
    if (parent) parent.add(m);
    return m;
  }
  const noBake = (o) => { o.traverse((c) => { c.userData.bake = null; }); return o; };
  // rectangles drawn as lines on the floor, all in one object
  function floorLines(rects, color, y) {
    const pts = [];
    for (const r of rects) {
      const x0 = r.x - r.w / 2, x1 = r.x + r.w / 2, z0 = r.z - r.d / 2, z1 = r.z + r.d / 2;
      pts.push(x0, y, z0, x1, y, z0, x1, y, z0, x1, y, z1, x1, y, z1, x0, y, z1, x0, y, z1, x0, y, z0);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
    return new T.LineSegments(g, new T.LineBasicMaterial({ color }));
  }

  // ---------- textures made in code ----------
  function concrete() {
    return canvasTex(512, 512, (k, w, h) => {
      k.fillStyle = '#b9bcbd'; k.fillRect(0, 0, w, h);
      for (let i = 0; i < 9000; i++) {
        const v = 150 + Math.random() * 70 | 0;
        k.fillStyle = `rgba(${v},${v},${v + 2},0.10)`;
        k.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 3);
      }
      k.strokeStyle = 'rgba(90,92,96,0.35)'; k.lineWidth = 2;   // slab joints
      k.strokeRect(0, 0, w, h);
    });
  }
  function rackFront(kind, fill, live, phase) {
    // kind: air or liq. fill: 0 empty frame, 0.5 half built, 1 built. live: LEDs on.
    return canvasTex(96, 320, (k, w, h) => {
      k.fillStyle = '#0d0e10'; k.fillRect(0, 0, w, h);
      k.fillStyle = '#2a2d31'; k.fillRect(0, 0, 7, h); k.fillRect(w - 7, 0, 7, h);     // rails
      const rows = kind === 'liq' ? 18 : 30;
      const rh = (h - 28) / rows;
      for (let r = 0; r < rows; r++) {
        const y = h - 8 - (r + 1) * rh;
        if (r / rows >= fill) { k.fillStyle = '#15171a'; k.fillRect(9, y + 1, w - 18, rh - 2); continue; }
        const sw = kind === 'liq' && (r === 8 || r === 9);
        k.fillStyle = sw ? '#3b3f46' : (kind === 'liq' ? '#23272c' : '#30343a');
        k.fillRect(9, y + 1, w - 18, rh - 2);
        k.fillStyle = '#4a4f57'; k.fillRect(11, y + 2, w - 22, 1);
        const n = kind === 'liq' ? 6 : 3;
        for (let i = 0; i < n; i++) {
          const on = live && ((r * 7 + i * 3 + phase) % 5 !== 0);
          k.fillStyle = on ? (i === 0 && (r + phase) % 9 === 0 ? '#ffb020' : '#36f08a') : '#1e3a2b';
          k.fillRect(13 + i * 5, y + rh / 2 - 1, 3, 2);
        }
      }
      k.fillStyle = kind === 'liq' ? '#2f7fe0' : '#8f97a1'; k.fillRect(0, 0, w, 10);   // strip used for the top of the rack
      if (kind === 'liq') {            // coolant manifolds down each side
        k.fillStyle = fill > 0 ? '#2f7fe0' : '#234a7a'; k.fillRect(8, 6, 3, h - 12);
        k.fillStyle = fill > 0 ? '#e0483f' : '#7a2c28'; k.fillRect(w - 11, 6, 3, h - 12);
      }
    });
  }
  function labelTex(text, sub, color) {
    return canvasTex(512, 128, (k, w, h) => {
      k.clearRect(0, 0, w, h);
      k.fillStyle = color || 'rgba(18,20,24,0.88)';
      const r = 18;
      k.beginPath(); k.moveTo(r, 4); k.lineTo(w - r, 4); k.quadraticCurveTo(w - 4, 4, w - 4, r + 4); k.lineTo(w - 4, h - r - 4);
      k.quadraticCurveTo(w - 4, h - 4, w - r, h - 4); k.lineTo(r, h - 4); k.quadraticCurveTo(4, h - 4, 4, h - r - 4); k.lineTo(4, r + 4); k.quadraticCurveTo(4, 4, r, 4); k.fill();
      k.fillStyle = '#fff'; k.textAlign = 'center'; k.textBaseline = 'middle';
      k.font = '600 40px system-ui, -apple-system, Segoe UI, sans-serif';
      k.fillText(text, w / 2, sub ? 46 : 64, w - 30);
      if (sub) { k.font = '400 28px system-ui, -apple-system, Segoe UI, sans-serif'; k.fillStyle = '#c8ccd2'; k.fillText(sub, w / 2, 92, w - 30); }
    });
  }

  class Scene3D {
    constructor(host, opts) {
      this.host = host;
      this.opts = opts || {};
      const r = this.renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
      r.setPixelRatio(Math.min(2, root.devicePixelRatio || 1));
      r.shadowMap.enabled = true;
      r.shadowMap.type = T.PCFSoftShadowMap;
      r.toneMapping = T.ACESFilmicToneMapping;
      r.toneMappingExposure = 1.05;
      host.appendChild(r.domElement);
      this.scene = new T.Scene();
      this.bgDay = new T.Color(0xdfe5ea); this.bgNight = new T.Color(0x49525e);
      this.scene.background = this.bgDay.clone();
      this.camera = new T.PerspectiveCamera(38, 2, 0.5, 900);
      this.hemi = new T.HemisphereLight(0xffffff, 0x9aa0a8, 1.0);
      this.sun = new T.DirectionalLight(0xfff4e2, 2.1);
      this.sun.castShadow = true;
      this.scene.add(this.hemi, this.sun, this.sun.target);
      this.world = new T.Group(); this.scene.add(this.world);         // static, rebuilt on layout change
      this.dyn = new T.Group(); this.scene.add(this.dyn);             // racks and robots
      this.cam = { theta: -0.55, phi: 0.95, radius: 120, target: new T.Vector3(0, 0, 0) };
      this.goal = null;
      this.night = 0;
      this.racks = new Map();
      this.amrs = [];
      this.editing = false;
      this.showFlow = false;
      this.showLabels = true;
      this.follow = -1;
      this.ray = new T.Raycaster();
      this.clockT = 0;
      this.makeShared();
      // ring that marks whatever was clicked
      this.selRing = new T.Mesh(new T.RingGeometry(0.95, 1.2, 40), new T.MeshBasicMaterial({ color: 0xffd400, transparent: true, opacity: 0.95, depthTest: false }));
      this.selRing.rotation.x = -Math.PI / 2; this.selRing.visible = false; this.selRing.renderOrder = 9;
      this.scene.add(this.selRing);
      this.sel = null;
      this.bindControls();
      this.resize();
    }

    // geometries and materials reused by every rack, robot and fixture
    makeShared() {
      const S = this.S = {};
      S.floor = concrete();
      S.floor.wrapS = S.floor.wrapT = T.RepeatWrapping;
      S.m = {
        floor: new T.MeshStandardMaterial({ map: S.floor, roughness: 0.82, metalness: 0.02 }),
        zone: mat(0xcfd3d4, { roughness: 0.7 }),
        zoneB: mat(0xd9cdb8, { roughness: 0.9 }),
        yellow: mat(0xf2c200, { roughness: 0.6 }),
        steel: mat(0x8d949c, { metalness: 0.5, roughness: 0.45 }),
        dark: mat(0x23262b, { roughness: 0.55, metalness: 0.3 }),
        white: mat(0xf1f2f3, { roughness: 0.5 }),
        wood: mat(0xc8a878, { roughness: 0.9 }),
        carton: mat(0xb98e5e, { roughness: 0.95 }),
        ply: mat(0xd8bc8a, { roughness: 0.9 }),
        pallet: mat(0x9a7448, { roughness: 0.95 }),
        blue: mat(0x2f7fe0, { roughness: 0.5 }),
        red: mat(0xd8443c, { roughness: 0.5 }),
        orange: mat(0xf07a1a, { roughness: 0.6 }),
        rackBody: mat(0x34383f, { roughness: 0.5, metalness: 0.35 }),
        rackBodyAi: mat(0x2a2f38, { roughness: 0.45, metalness: 0.45 }),
        vest: mat(0xd7f000, { roughness: 0.8 }),
        skin: mat(0xc9a07e, { roughness: 0.9 }),
        navy: mat(0x25344d, { roughness: 0.85 }),
        hat: mat(0xffffff, { roughness: 0.5 }),
        amr: mat(0xe9ebee, { roughness: 0.4, metalness: 0.2 }),
        baked: mat(0xffffff, { roughness: 0.68, metalness: 0.12 }),
        amrLed: new T.MeshBasicMaterial({ color: 0x2bb7ff }),
        screen: new T.MeshBasicMaterial({ color: 0x7fd0ff }),
        glass: new T.MeshStandardMaterial({ color: 0xbfd6e6, transparent: true, opacity: 0.25, roughness: 0.2 }),
        wall: new T.MeshStandardMaterial({ color: 0xe9ecef, side: T.BackSide, roughness: 0.95 }),
        asphalt: mat(0x646b72, { roughness: 1 }),
        door: mat(0x3a4048, { roughness: 0.6, metalness: 0.3 }),
        trailer: mat(0xf4f5f6, { roughness: 0.6 }),
        cone: mat(0xff5a1f, { roughness: 0.7 }),
        pad: new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.42, depthWrite: false }),
        light: new T.MeshBasicMaterial({ color: 0xffffff }),
        flow: new T.MeshBasicMaterial({ color: 0x2a78d6, transparent: true, opacity: 0.5, depthWrite: false }),
        guide: new T.LineDashedMaterial({ color: 0x2f6fb5, dashSize: 0.6, gapSize: 0.5 }),
        lane: mat(0xa9b6c4, { roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
        lamp: new T.MeshBasicMaterial({ color: 0xfff6dc }),
      };
      // rack fronts: [kind][fill] dim, and two live frames for blinking
      S.front = {};
      for (const kind of ['air', 'liq']) {
        S.front[kind] = {
          empty: new T.MeshStandardMaterial({ map: rackFront(kind, 0, false, 0), roughness: 0.6 }),
          half: new T.MeshStandardMaterial({ map: rackFront(kind, 0.5, false, 0), roughness: 0.6 }),
          built: new T.MeshStandardMaterial({ map: rackFront(kind, 1, false, 0), roughness: 0.6 }),
          liveA: new T.MeshBasicMaterial({ map: rackFront(kind, 1, true, 0) }),
          liveB: new T.MeshBasicMaterial({ map: rackFront(kind, 1, true, 2) }),
        };
      }
      S.g = {
        rack: new T.BoxGeometry(0.6, 1, 1.1),
        skin: (() => {              // front, rear and top of a rack as one piece
          const g = new T.BufferGeometry();
          const a = 0.28, zf = 0.556, t = 0.31, tz = 0.56, yt = 1.004;
          const pos = [-a, 0, zf, a, 0, zf, a, 1, zf, -a, 1, zf, a, 0, -zf, -a, 0, -zf, -a, 1, -zf, a, 1, -zf, -t, yt, tz, t, yt, tz, t, yt, -tz, -t, yt, -tz];
          const uv = [0, 0, 1, 0, 1, 0.955, 0, 0.955, 0, 0, 1, 0, 1, 0.955, 0, 0.955, 0.1, 0.975, 0.9, 0.975, 0.9, 0.995, 0.1, 0.995];
          const nor = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
          g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
          g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
          g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
          g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11]);
          return g;
        })(),
        pallet: new T.BoxGeometry(1.1, 0.14, 1.1),
        carton: new T.BoxGeometry(1.0, 1.05, 1.0),
        crate: new T.BoxGeometry(0.85, 2.45, 1.4),
        body: new T.CapsuleGeometry(0.2, 0.95, 4, 10),
        vest: new T.CylinderGeometry(0.235, 0.235, 0.5, 10),
        head: new T.SphereGeometry(0.13, 12, 10),
        hat: new T.SphereGeometry(0.15, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
        cone: new T.ConeGeometry(0.18, 0.55, 10),
      };
    }

    // ---------- camera ----------
    bindControls() {
      const el = this.renderer.domElement;
      el.style.touchAction = 'pan-y';
      const ptrs = new Map();
      let mode = null, last = null, moved = 0, pinch = 0, dragZone = null, dragOff = null;
      const ground = (ev) => {
        const r = el.getBoundingClientRect();
        const v = new T.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
        this.ray.setFromCamera(v, this.camera);
        const out = new T.Vector3();
        return this.ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), 0), out) ? out : null;
      };
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      el.addEventListener('pointerdown', (e) => {
        ptrs.set(e.pointerId, e);
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        moved = 0; last = { x: e.clientX, y: e.clientY };
        this.goal = null;
        this.wheelZoom = true;
        if (ptrs.size === 2) {
          const [a, b] = [...ptrs.values()];
          pinch = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
          mode = 'pinch';
          return;
        }
        if (this.editing) {
          const hit = this.pick(e);
          if (hit && hit.type === 'station') {
            const g = ground(e);
            const z = this.geo.zones[hit.zone];
            if (g && z) { dragZone = hit.zone; dragOff = { x: g.x + this.geo.floor.w / 2 - z.x, y: g.z + this.geo.floor.d / 2 - z.y }; mode = 'zone'; return; }
          }
        }
        mode = (e.button === 2 || e.shiftKey) ? 'pan' : 'rotate';
      });
      el.addEventListener('pointermove', (e) => {
        if (!ptrs.has(e.pointerId)) return;
        ptrs.set(e.pointerId, e);
        if (mode === 'pinch' && ptrs.size === 2) {
          const [a, b] = [...ptrs.values()];
          const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
          if (pinch > 0) this.zoom(pinch / d);
          pinch = d;
          return;
        }
        const dx = e.clientX - last.x, dy = e.clientY - last.y;
        last = { x: e.clientX, y: e.clientY };
        moved += Math.abs(dx) + Math.abs(dy);
        if (mode === 'rotate') {
          this.follow = -1;
          this.cam.theta -= dx * 0.006;
          this.cam.phi = Math.max(0.1, Math.min(1.45, this.cam.phi + dy * 0.005));
        } else if (mode === 'pan') {
          this.follow = -1;
          const s = this.cam.radius * 0.0016;
          const c = Math.cos(this.cam.theta), sn = Math.sin(this.cam.theta);
          this.cam.target.x -= (dx * c + dy * sn) * s;
          this.cam.target.z -= (-dx * sn + dy * c) * s;
        } else if (mode === 'zone' && dragZone) {
          const g = ground(e);
          if (!g) return;
          const z = this.geo.zones[dragZone];
          const nx = Math.round(g.x + this.geo.floor.w / 2 - dragOff.x), ny = Math.round(g.z + this.geo.floor.d / 2 - dragOff.y);
          const grp = this.zoneGroups[dragZone];
          grp.position.set(nx - this.geo.floor.w / 2, 0, ny - this.geo.floor.d / 2);
          grp.userData.nx = nx; grp.userData.ny = ny;
          if (this.opts.onDragZone) this.opts.onDragZone(dragZone, nx, ny, z);
        }
      });
      const up = (e) => {
        ptrs.delete(e.pointerId);
        if (mode === 'zone' && dragZone) {
          const grp = this.zoneGroups[dragZone];
          if (grp.userData.nx != null && this.opts.onMoveZone) this.opts.onMoveZone(dragZone, grp.userData.nx, grp.userData.ny);
          dragZone = null;
        } else if (moved < 6 && e.type === 'pointerup' && this.opts.onPick) {
          this.opts.onPick(this.pick(e));
        }
        mode = ptrs.size ? mode : null;
      };
      document.addEventListener('pointerdown', (e) => { if (!this.host.contains(e.target)) this.wheelZoom = false; });
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('wheel', (e) => {
        if (!(this.expanded || e.ctrlKey || e.shiftKey || this.wheelZoom)) return;   // let the page scroll
        e.preventDefault();
        this.zoom(Math.exp(e.deltaY * 0.0012));
      }, { passive: false });
    }

    zoom(f) { this.goal = null; this.cam.radius = Math.max(6, Math.min(420, this.cam.radius * f)); }

    // Camera distance at which the whole floor just fits the view from a given angle.
    fitRadius(theta, phi) {
      const fw = this.geo ? this.geo.floor.w : 100, fd = this.geo ? this.geo.floor.d : 50;
      const cam = this.camera.clone();
      let R = 160;
      const p = new T.Vector3();
      for (let it = 0; it < 5; it++) {
        cam.position.set(R * Math.cos(phi) * Math.sin(theta), R * Math.sin(phi), R * Math.cos(phi) * Math.cos(theta));
        cam.lookAt(0, 0, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
        let mx = 0;
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [0, 5]) {
          p.set(sx * fw / 2, y, sz * fd / 2).project(cam);
          mx = Math.max(mx, Math.abs(p.x), Math.abs(p.y));
        }
        R *= Math.max(0.2, mx) * 1.07 / 1.0;
        if (Math.abs(mx - 1 / 1.07) < 0.01) break;
      }
      return Math.max(20, Math.min(400, R));
    }

    setView(name) {
      const tall = (this.camera.aspect || 2) < 1;      // phone held upright: run the long side up the screen
      const zero = new T.Vector3(0, 0, 0);
      this.follow = -1;
      const make = (theta, phi) => ({ theta, phi, radius: this.fitRadius(theta, phi), target: zero });
      if (name === 'plan') this.goal = make(tall ? -Math.PI / 2 : 0, 1.45);
      else if (name === 'floor') { this.goal = make(-0.9, 0.2); this.goal.radius = Math.min(this.goal.radius, 60); }
      else if (name === 'follow') { this.follow = 0; this.goal = { theta: this.cam.theta, phi: 1.0, radius: 26, target: this.cam.target.clone() }; }
      else this.goal = tall ? make(-Math.PI / 2 + 0.22, 1.02) : make(-0.28, 0.86);
    }

    focusZone(id) {
      const z = this.geo.zones[id];
      if (!z) return;
      this.follow = -1;
      this.goal = { theta: this.cam.theta, phi: 0.95, radius: Math.max(22, Math.max(z.w, z.d) * 1.9), target: new T.Vector3(z.x + z.w / 2 - this.geo.floor.w / 2, 0, z.y + z.d / 2 - this.geo.floor.d / 2) };
    }

    resize() {
      const w = this.host.clientWidth || 600, h = this.host.clientHeight || 360;
      this.renderer.setSize(w, h, false);
      this.renderer.domElement.style.width = '100%';
      this.renderer.domElement.style.height = '100%';
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }

    // ---------- static world ----------
    clear(group) {
      group.traverse((o) => { if (o.geometry && !o.userData.shared && !o.isSprite) o.geometry.dispose(); if (o.isSprite && o.material.map) { o.material.map.dispose(); o.material.dispose(); } });
      while (group.children.length) group.remove(group.children[0]);
    }

    build(geo, p) {
      this.geo = geo; this.p = p;
      const S = this.S, m = S.m, world = this.world;
      this.clear(world);
      const fw = geo.floor.w, fd = geo.floor.d;
      this.X = (x) => x - fw / 2; this.Z = (y) => y - fd / 2;

      // ground outside, slab, walls that only show from the inside
      const out = new T.Mesh(new T.PlaneGeometry(fw + 260, fd + 260), m.asphalt);
      out.rotation.x = -Math.PI / 2; out.position.y = -0.06; out.receiveShadow = true; world.add(out);
      S.floor.repeat.set(fw / 6, fd / 6);
      const slab = new T.Mesh(new T.PlaneGeometry(fw, fd), m.floor);
      slab.rotation.x = -Math.PI / 2; slab.receiveShadow = true; world.add(slab);
      const walls = new T.Mesh(new T.BoxGeometry(fw, 11, fd), m.wall);
      walls.position.y = 3.5; world.add(walls);       // floor of the box sits below the slab so the two never fight
      // building columns along the main aisle
      for (let x = 12; x < fw - 6; x += 24) {
        for (const y of [1.2, fd - 1.2]) box(0.5, 9, 0.5, m.steel, this.X(x), 4.5, this.Z(y), world);
      }

      this.sun.position.set(-fw * 0.35, 110, fd * 0.9);
      this.sun.target.position.set(0, 0, 0);
      const sc = this.sun.shadow.camera, half = Math.max(fw, fd) / 2 + 24;
      sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.near = 10; sc.far = 320;
      sc.updateProjectionMatrix();
      const small = (root.innerWidth || 1000) < 700;
      this.sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
      this.sun.shadow.bias = -0.0012; this.sun.shadow.normalBias = 0.35;

      this.zoneGroups = {};
      this.pickers = [];
      this.bays = {};          // "station:index" -> { x, z, zone, fixture, site, operator, arm }
      this.labels = {};
      const lightPos = [], padPos = [];
      for (const id of geo.ids) this.buildZone(id, lightPos, padPos);

      // one instanced mesh for all stack lights and one for all state pads
      const n = lightPos.length;
      this.lightMesh = new T.InstancedMesh(new T.CylinderGeometry(0.11, 0.11, 0.42, 10), m.light, n);
      this.padMesh = new T.InstancedMesh(new T.PlaneGeometry(1, 1), m.pad, n);
      const d = new T.Object3D();
      for (let i = 0; i < n; i++) {
        d.position.set(lightPos[i].x, 2.75, lightPos[i].z); d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1); d.updateMatrix();
        this.lightMesh.setMatrixAt(i, d.matrix);
        d.position.set(padPos[i].x, 0.035, padPos[i].z); d.rotation.set(-Math.PI / 2, 0, 0); d.scale.set(padPos[i].w, padPos[i].d, 1); d.updateMatrix();
        this.padMesh.setMatrixAt(i, d.matrix);
        this.lightMesh.setColorAt(i, new T.Color(0x888888)); this.padMesh.setColorAt(i, new T.Color(0x888888));
      }
      this.lightMesh.frustumCulled = false; this.padMesh.frustumCulled = false;
      world.add(this.padMesh, this.lightMesh);

      this.buildGuides();
      this.bake();
      this.flowGroup = new T.Group(); world.add(this.flowGroup);
      this.setFlows(this.flows);
      if (!this.viewSet) { this.setView('overview'); Object.assign(this.cam, this.goal); this.goal = null; this.viewSet = true; }
    }

    buildZone(id, lightPos, padPos) {
      const geo = this.geo, S = this.S, m = S.m, z = geo.zones[id];
      const g = new T.Group();
      g.position.set(this.X(z.x), 0, this.Z(z.y));
      this.world.add(g);
      this.zoneGroups[id] = g;
      const L = (x, y) => ({ x: x - z.x, z: y - z.y });   // absolute floor point -> zone local
      const isB = id === 'burnB';
      // painted floor and yellow safety border
      const plate = new T.Mesh(new T.PlaneGeometry(z.w, z.d), isB ? m.zoneB : m.zone);
      plate.rotation.x = -Math.PI / 2; plate.position.set(z.w / 2, 0.012, z.d / 2); plate.receiveShadow = true; g.add(plate);
      for (const [w, d, x, zz] of [[z.w, 0.14, z.w / 2, 0], [z.w, 0.14, z.w / 2, z.d], [0.14, z.d, 0, z.d / 2], [0.14, z.d, z.w, z.d / 2]]) box(w, 0.02, d, m.yellow, x, 0.02, zz, g, false);
      // invisible box used for clicking and dragging
      const pk = new T.Mesh(new T.BoxGeometry(z.w, 3, z.d), new T.MeshBasicMaterial({ visible: false }));
      pk.position.set(z.w / 2, 1.5, z.d / 2); pk.userData = { type: 'station', zone: id, station: isB ? 'burn' : id };
      g.add(pk); this.pickers.push(pk);
      // buffer slots outlined on the floor
      if (z.slots.length) g.add(floorLines(z.slots.map((s) => Object.assign(L(s.x, s.y), { w: 0.9, d: 1.5 })), 0xffffff, 0.03));
      // port marker where robots stop
      const port = L(z.port.x, z.port.y);
      const pm = new T.Mesh(new T.RingGeometry(0.5, 0.7, 24), new T.MeshBasicMaterial({ color: 0x2a78d6 }));
      pm.rotation.x = -Math.PI / 2; pm.position.set(port.x, 0.03, port.z); g.add(pm);

      // name sign above the zone
      // signs keep the same size on screen however far the camera is
      const sp = new T.Sprite(new T.SpriteMaterial({ map: labelTex(z.name, ''), transparent: true, depthTest: false, sizeAttenuation: false }));
      sp.position.set(z.w / 2, id === 'park' ? 3.2 : 5.6, z.d / 2); sp.renderOrder = 10;
      g.add(sp);
      this.labels[id] = { sprite: sp, text: '' };

      const south = z.port.y > z.y + z.d / 2;       // which way the aisle is
      const face = south ? 1 : -1;
      const station = isB ? 'burn' : id;
      const offset = isB ? Math.max(0, Math.round(this.p.burnBaysA)) : 0;
      z.bays.forEach((b, i) => {
        const c = L(b.x, b.y);
        const bay = { x: this.X(b.x), z: this.Z(b.y), zone: id, face, local: c, group: g };
        const fx = new T.Group(); fx.position.set(c.x, 0, c.z); g.add(fx);
        const site = new T.Group(); site.position.set(c.x, 0, c.z); site.visible = false; g.add(site);
        bay.fixture = fx; bay.site = site;
        this.fixture(id, bay, fx, b, i, z);
        // positions that only open in phase 2 stay as separate objects so they can be switched on later
        if (!this.onlineAtStart(id, i)) noBake(fx);
        noBake(site);
        // what an unfinished position looks like: tape and a cone
        site.add(floorLines([{ x: 0, z: 0, w: b.w - 0.5, d: b.d - 0.5 }], 0xf07a1a, 0.04));
        const cone = new T.Mesh(S.g.cone, m.cone); cone.userData.shared = true; cone.position.set(0, 0.28, 0); cone.castShadow = true; site.add(cone);
        if (id !== 'park') {
          bay.idx = lightPos.length;
          lightPos.push({ x: this.X(b.x) + (b.w / 2 - 0.25), z: this.Z(b.y) - face * (b.d / 2 - 0.25) });
          padPos.push({ x: this.X(b.x), z: this.Z(b.y), w: b.w - 0.35, d: b.d - 0.35 });
          cyl(0.035, 2.6, m.steel, c.x + (b.w / 2 - 0.25), 1.3, c.z - face * (b.d / 2 - 0.25), g, 6);
        }
        this.bays[station + ':' + (i + offset)] = bay;
      });
      this.zoneExtras(id, g, z, face);
    }

    // is this work position there from day one, or does it arrive with phase 2?
    onlineAtStart(id, i) {
      const p = this.p, r = Math.round;
      if (id === 'burnB') return false;
      if (id === 'asm') { const nAuto = r(p.asmAuto) + r(p.asmAutoP2); return i < nAuto ? i < r(p.asmAuto) : i - nAuto < r(p.asmManual); }
      if (id === 'test') return i < r(p.testPos);
      if (id === 'pack') return i < r(p.packStations);
      return true;
    }

    /*
     * Replace hundreds of separate static boxes and cylinders with two
     * instanced meshes, so the whole fit out draws in a couple of calls.
     */
    bake() {
      this.world.updateMatrixWorld(true);
      const sets = { box: [], cyl: [] };
      this.world.traverse((o) => { if (o.isMesh && o.userData.bake) sets[o.userData.bake].push(o); });
      const unit = { box: new T.BoxGeometry(1, 1, 1), cyl: new T.CylinderGeometry(0.5, 0.5, 1, 10) };
      const mm = new T.Matrix4(), sc = new T.Matrix4();
      for (const kind of ['box', 'cyl']) {
        const list = sets[kind];
        if (!list.length) continue;
        const inst = new T.InstancedMesh(unit[kind], this.S.m.baked, list.length);
        list.forEach((o, i) => {
          const g = o.geometry.parameters;
          if (kind === 'box') sc.makeScale(g.width, g.height, g.depth); else sc.makeScale(g.radiusTop * 2, g.height, g.radiusTop * 2);
          mm.multiplyMatrices(o.matrixWorld, sc);
          inst.setMatrixAt(i, mm);
          inst.setColorAt(i, o.material.color);
        });
        for (const o of list) { o.parent.remove(o); o.geometry.dispose(); }
        inst.castShadow = true; inst.receiveShadow = true; inst.frustumCulled = false;
        this.world.add(inst);
      }
    }

    person(parent, x, z) {
      const S = this.S, p = new T.Group();
      for (const [geo, material, y] of [[S.g.body, S.m.navy, 0.72], [S.g.vest, S.m.vest, 1.12], [S.g.head, S.m.skin, 1.58], [S.g.hat, S.m.hat, 1.62]]) {
        const mesh = new T.Mesh(geo, material); mesh.userData.shared = true; mesh.position.y = y; mesh.castShadow = true; p.add(mesh);
      }
      p.position.set(x, 0, z);
      parent.add(p);
      return p;
    }

    // the equipment at one work position
    fixture(id, bay, fx, b, i, z) {
      const m = this.S.m, f = bay.face;
      const back = -f * (b.d / 2 - 0.55);          // side away from the aisle
      if (id === 'recv' || id === 'ship') {
        // dock door on the west wall with a trailer outside it, and a dock plate
        const wx = -(z.x) - bay.local.x;           // wall, in fixture coordinates
        box(0.25, 3.6, 3.4, m.door, wx + 0.1, 1.8, 0, fx);
        box(2.4, 0.06, 2.6, m.steel, wx + 1.4, 0.05, 0, fx, false);
        const truck = new T.Group();
        box(13, 2.9, 2.6, m.trailer, wx - 6.8, 2.55, 0, truck);
        box(13, 0.25, 2.5, m.dark, wx - 6.8, 1.0, 0, truck);
        for (const tx of [-2.2, -3.4, -11.2]) for (const tz of [-1.05, 1.05]) { const w = cyl(0.5, 0.35, m.dark, wx + tx, 0.5, tz, truck, 14); w.rotation.x = Math.PI / 2; }
        fx.add(noBake(truck)); bay.truck = truck;
        box(1.2, 0.9, 0.8, id === 'recv' ? m.steel : m.orange, -0.2, 0.45, back, fx);   // scanner desk or stretch wrapper
        bay.operator = this.person(fx, 0.9, back + f * 0.9);
      } else if (id === 'kit') {
        for (const sx of [-1.2, 1.2]) {            // pallet racking with totes
          for (const px of [-0.95, 0.95]) cyl(0.05, 2.4, m.blue, sx + px, 1.2, back, fx, 6);
          for (const sy of [0.5, 1.3, 2.1]) { box(1.9, 0.07, 0.7, m.orange, sx, sy, back, fx); box(1.5, 0.4, 0.5, m.carton, sx, sy + 0.24, back, fx); }
        }
        box(0.9, 0.9, 0.6, m.steel, -1.3, 0.5, f * 0.9, fx);     // parts cart
        bay.operator = this.person(fx, 1.2, back + f * 1.1);
      } else if (id === 'asm') {
        const nAuto = Math.round(this.p.asmAuto) + Math.round(this.p.asmAutoP2);
        if (i < nAuto) {
          // robot cell: pedestal, two link arm, guard rails
          cyl(0.38, 0.55, m.steel, -1.35, 0.28, back + f * 0.5, fx, 16);
          const sh = new T.Group(); sh.position.set(-1.35, 0.6, back + f * 0.5); fx.add(sh);
          const upper = box(0.26, 1.35, 0.26, m.yellow, 0, 0.62, 0, sh);
          const el = new T.Group(); el.position.set(0, 1.3, 0); sh.add(el);
          box(0.2, 1.15, 0.2, m.yellow, 0, 0.5, 0, el); box(0.3, 0.16, 0.3, m.dark, 0, 1.1, 0, el);
          el.rotation.z = -1.5; sh.rotation.y = f > 0 ? 0.4 : Math.PI + 0.4; upper.userData.k = 1;
          noBake(sh);
          bay.arm = { sh, el, base: sh.rotation.y };
          for (const gx of [-b.w / 2 + 0.3, b.w / 2 - 0.3]) { cyl(0.04, 1.1, m.yellow, gx, 0.55, back, fx, 6); cyl(0.04, 1.1, m.yellow, gx, 0.55, -back, fx, 6); box(0.04, 0.04, Math.abs(back) * 2, m.yellow, gx, 1.05, 0, fx, false); }
          box(0.7, 1.5, 0.5, m.white, 1.5, 0.75, back, fx);        // controller cabinet
        } else {
          box(1.7, 0.06, 0.75, m.wood, -1.2, 0.92, back, fx); box(1.6, 0.9, 0.65, m.steel, -1.2, 0.45, back, fx);   // bench
          box(0.7, 1.0, 0.5, m.red, 1.5, 0.5, back, fx);           // tool chest
          box(0.8, 0.8, 0.55, m.steel, 1.4, 0.45, f * 1.2, fx);    // server cart
          bay.operator = this.person(fx, -0.95, f * 0.2);
        }
      } else if (id === 'leak') {
        box(0.9, 1.5, 0.7, m.white, -1.3, 0.75, back + f * 0.3, fx); box(0.92, 0.2, 0.72, m.blue, -1.3, 1.2, back + f * 0.3, fx);   // coolant cart
        const h1 = cyl(0.045, 1.5, m.blue, -0.75, 0.75, back * 0.5, fx, 8); h1.rotation.z = 1.05;
        const h2 = cyl(0.045, 1.5, m.red, -0.75, 0.5, back * 0.5 + f * 0.2, fx, 8); h2.rotation.z = 1.15;
        bay.operator = this.person(fx, 1.1, f * 0.3);
      } else if (id === 'test') {
        box(0.6, 1.0, 0.5, m.dark, -1.05, 0.5, back + f * 0.2, fx);          // test cart
        const scr = new T.Mesh(new T.PlaneGeometry(0.5, 0.32), m.screen); scr.position.set(-1.05, 1.25, back + f * 0.46); scr.rotation.y = f > 0 ? 0 : Math.PI; fx.add(scr);
        bay.screen = scr;
        cyl(0.04, 3.0, m.steel, 1.2, 1.5, back, fx, 6); box(1.5, 0.08, 0.3, m.steel, 0.5, 3.0, back, fx, false);   // cable arm
      } else if (id === 'burn' || id === 'burnB') {
        box(0.5, 0.12, 0.5, m.dark, 0, 0.06, -f * 0.9, fx, false);           // floor power box
        cyl(0.03, 3.1, m.steel, 0.42, 1.55, -f * 0.75, fx, 6);               // drop from the busway
      } else if (id === 'repair') {
        box(2.0, 0.06, 0.8, m.wood, -0.9, 0.92, back, fx); box(1.9, 0.9, 0.7, m.steel, -0.9, 0.45, back, fx);
        box(0.9, 1.8, 0.45, m.blue, 1.4, 0.9, back, fx);                     // spares cabinet
        bay.operator = this.person(fx, -0.9, back + f * 0.9);
      } else if (id === 'pack') {
        box(1.3, 0.22, 1.5, m.ply, -1.5, 0.11, back + f * 0.4, fx); box(1.3, 0.22, 1.5, m.ply, -1.5, 0.35, back + f * 0.4, fx);   // crate panels
        box(0.5, 1.3, 0.5, m.orange, 1.6, 0.65, back, fx);                   // strapping machine
        bay.operator = this.person(fx, 1.1, f * 0.4);
      } else if (id === 'park') {
        box(1.5, 0.03, 1.1, m.dark, 0, 0.02, 0, fx, false); box(0.3, 0.7, 0.5, m.white, -0.85, 0.35, 0, fx);   // charge pad and charger
      }
    }

    // things shared by a whole zone: overhead services, construction barriers
    zoneExtras(id, g, z, face) {
      const m = this.S.m, spec = root.RackLayout.SPEC[id];
      if (id === 'burn' || id === 'burnB') {
        const eq = new T.Group(); g.add(eq);
        const x0 = z.bays.length ? Math.min.apply(null, z.bays.map((b) => b.x)) - z.x - spec.bw / 2 : 1;
        const x1 = z.bays.length ? Math.max.apply(null, z.bays.map((b) => b.x)) - z.x + spec.bw / 2 : z.w - 1;
        const rows = [...new Set(z.bays.map((b) => b.y))];
        for (const y of rows) {
          const zz = y - z.y - face * 0.75;
          box(x1 - x0, 0.22, 0.3, m.yellow, (x0 + x1) / 2, 3.2, zz, eq);               // power busway
          const sp = cyl(0.07, x1 - x0, m.blue, (x0 + x1) / 2, 2.85, zz - 0.3, eq, 8); sp.rotation.z = Math.PI / 2;   // coolant supply
          const rt = cyl(0.07, x1 - x0, m.red, (x0 + x1) / 2, 2.85, zz + 0.3, eq, 8); rt.rotation.z = Math.PI / 2;    // coolant return
        }
        // coolant distribution units and a power panel at the end of the rows
        const ex = x1 + 0.2 > z.w - 0.6 ? z.w - 0.55 : x1 + 0.55;
        rows.slice(0, 3).forEach((y, i) => { if (i % 2 === 0) { box(0.8, 2.0, 1.2, m.white, ex, 1.0, y - z.y, eq); box(0.82, 0.25, 1.22, m.blue, ex, 1.6, y - z.y, eq); } });
        if (id === 'burnB') {
          // before phase 2 opens this is a building site
          const site = new T.Group(); g.add(site);
          for (let x = 1; x < z.w; x += 2.4) for (const zz of [0.3, z.d - 0.3]) box(1.9, 0.9, 0.35, ((x / 2.4) | 0) % 2 ? m.orange : m.white, x, 0.45, zz, site);
          for (let y = 1.5; y < z.d - 1; y += 2.4) for (const xx of [0.3, z.w - 0.3]) box(0.35, 0.9, 1.9, ((y / 2.4) | 0) % 2 ? m.orange : m.white, xx, 0.45, y, site);
          for (const [sx, sz] of [[z.w * 0.3, z.d * 0.35], [z.w * 0.68, z.d * 0.6]]) {          // scaffold towers
            for (const dx of [-1, 1]) for (const dz of [-0.7, 0.7]) cyl(0.04, 4, m.steel, sx + dx, 2, sz + dz, site, 6);
            for (const sy of [1.9, 3.9]) box(2.1, 0.06, 1.5, m.wood, sx, sy, sz, site);
          }
          box(1.2, 0.5, 1.0, m.pallet, z.w * 0.5, 0.25, z.d * 0.3, site); box(1.1, 0.6, 0.9, m.carton, z.w * 0.5, 0.8, z.d * 0.3, site);
          noBake(site); noBake(eq);
          this.siteB = site; this.equipB = eq; eq.visible = false;
        }
      }
    }

    // thin dashed lines on the floor along every route the robots use
    buildGuides() {
      const geo = this.geo, m = this.S.m;
      // rows of high bay lights under the roof
      this.lamps = new T.Group(); this.world.add(this.lamps);
      for (let x = 9; x < geo.floor.w - 4; x += 12) for (let y = 7; y < geo.floor.d - 3; y += 11) {
        const lamp = new T.Mesh(new T.BoxGeometry(2.4, 0.12, 0.5), m.lamp);
        lamp.position.set(this.X(x), 8.6, this.Z(y)); this.lamps.add(lamp);
      }
      const pairs = [['recv', 'kit'], ['kit', 'asm'], ['asm', 'leak'], ['asm', 'test'], ['leak', 'test'], ['test', 'burn'], ['test', 'repair'], ['burn', 'repair'], ['repair', 'test'], ['burn', 'pack'], ['pack', 'ship'], ['burnB', 'pack'], ['park', 'recv']];
      const pts = [];
      for (const [a, b] of pairs) {
        if (!geo.zones[a] || !geo.zones[b]) continue;
        const p = geo.path(a, b).pts;
        for (let i = 1; i < p.length; i++) {
          pts.push(this.X(p[i - 1][0]), 0.03, this.Z(p[i - 1][1]), this.X(p[i][0]), 0.03, this.Z(p[i][1]));
          // painted robot lane under the route
          const dx = p[i][0] - p[i - 1][0], dy = p[i][1] - p[i - 1][1], len = Math.hypot(dx, dy);
          if (len < 0.01) continue;
          const lane = new T.Mesh(new T.PlaneGeometry(len + 1.8, 1.8), m.lane);
          lane.rotation.x = -Math.PI / 2; lane.rotation.z = -Math.atan2(dy, dx);
          lane.position.set(this.X((p[i][0] + p[i - 1][0]) / 2), 0.008, this.Z((p[i][1] + p[i - 1][1]) / 2));
          lane.receiveShadow = true;
          this.world.add(lane);
        }
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
      const lines = new T.LineSegments(g, this.S.m.guide);
      lines.computeLineDistances();
      this.world.add(lines);
    }

    // ribbons whose width shows how many rack moves a day use each route
    setFlows(flows) {
      this.flows = flows;
      if (!this.flowGroup) return;
      this.clear(this.flowGroup);
      this.flowGroup.visible = this.showFlow;
      if (!flows || !this.geo) return;
      let max = 0;
      for (const k in flows) max = Math.max(max, flows[k]);
      for (const k in flows) {
        const [a, b] = k.split('>');
        if (!this.geo.zones[a] || !this.geo.zones[b] || !max) continue;
        const p = this.geo.path(a, b).pts, w = 0.25 + 1.6 * flows[k] / max;
        for (let i = 1; i < p.length; i++) {
          const dx = p[i][0] - p[i - 1][0], dy = p[i][1] - p[i - 1][1], len = Math.hypot(dx, dy);
          if (len < 0.01) continue;
          const seg = new T.Mesh(new T.PlaneGeometry(len + w, w), this.S.m.flow);
          seg.rotation.x = -Math.PI / 2; seg.rotation.z = -Math.atan2(dy, dx);
          seg.position.set(this.X((p[i][0] + p[i - 1][0]) / 2), 0.045, this.Z((p[i][1] + p[i - 1][1]) / 2));
          this.flowGroup.add(seg);
        }
      }
    }

    // ---------- moving things ----------
    attach(sim) {
      this.sim = sim;
      for (const r of this.racks.values()) this.dyn.remove(r.g);
      this.racks.clear();
      for (const a of this.amrs) this.dyn.remove(a.g);
      this.amrs = sim.amrs.map((a) => this.makeAmr(a));
      this.snap = true;
    }

    makeAmr(a) {
      const m = this.S.m, g = new T.Group();
      box(1.35, 0.26, 0.92, m.amr, 0, 0.2, 0, g); box(1.39, 0.08, 0.96, m.dark, 0, 0.09, 0, g);
      box(1.37, 0.035, 0.94, m.amrLed, 0, 0.3, 0, g, false);
      cyl(0.09, 0.08, m.dark, 0.5, 0.37, 0, g, 12);                        // lidar
      const cart = new T.Group();                                          // component cart, shown when carrying one
      box(0.9, 0.9, 0.7, m.steel, 0, 0.82, 0, cart); box(0.8, 0.3, 0.6, m.carton, 0, 1.42, 0, cart);
      cart.visible = false; g.add(cart);
      g.userData = { type: 'amr', id: a.id };
      g.traverse((o) => { o.userData.type = 'amr'; o.userData.id = a.id; });
      this.dyn.add(g);
      const park = this.geo.zones.park.bays[a.id % this.geo.zones.park.bays.length];
      return { g, cart, amr: a, x: park.x, y: park.y, heading: 0, home: park };
    }

    makeRack(rack) {
      const S = this.S, liq = rack.type === 'liq', h = liq ? 2.3 : 2.05;
      const g = new T.Group();
      const body = new T.Mesh(S.g.rack, liq ? S.m.rackBodyAi : S.m.rackBody); body.scale.y = h; body.position.y = h / 2 + 0.05; body.castShadow = true;
      const skin = new T.Mesh(S.g.skin, S.front[rack.type].empty); skin.scale.y = h; skin.position.y = 0.05;
      const pallet = new T.Mesh(S.g.pallet, S.m.pallet); pallet.position.y = 0.07; pallet.castShadow = true;
      const carton = new T.Mesh(S.g.carton, liq ? S.m.blue : S.m.carton); carton.position.y = 0.14 + 0.525; carton.castShadow = true;
      if (liq) { carton.scale.set(1, 1.15, 1); carton.position.y += 0.08; }
      const crate = new T.Mesh(S.g.crate, S.m.ply); crate.position.y = 1.23; crate.castShadow = true;
      for (const o of [body, skin, pallet, carton, crate]) { o.userData = { shared: true, type: 'rack', id: rack.id }; g.add(o); }
      this.dyn.add(g);
      return { g, body, skin, pallet, carton, crate, rack, look: '', fresh: true, seen: 0 };
    }

    setLook(v, look) {
      if (v.look === look) return;
      v.look = look;
      const show = (rackOn, palletOn, crateOn) => { v.body.visible = v.skin.visible = rackOn; v.pallet.visible = v.carton.visible = palletOn; v.crate.visible = crateOn; };
      if (look === 'material') show(false, true, false);
      else if (look === 'crate') show(false, false, true);
      else { show(true, false, false); v.skin.material = this.S.front[v.rack.type][look]; }
    }

    // dt is real seconds since the last frame; speed is simulated hours per real second
    update(dt, speed) {
      const sim = this.sim, geo = this.geo;
      if (!sim || !geo) return;
      this.clockT += dt;
      const blink = (Math.floor(this.clockT * 2.5) % 2) ? 'liveA' : 'liveB';
      // things glide to their new place; the faster the clock, the quicker the glide
      const k = this.snap ? 1 : 1 - Math.exp(-dt * (8 + 4 * (speed || 0)));
      const col = new T.Color();
      const seen = ++this.frame || (this.frame = 1);
      const place = (rack, x, y, lift, look, heading) => {
        let v = this.racks.get(rack.id);
        if (!v) { v = this.makeRack(rack); this.racks.set(rack.id, v); }
        v.seen = seen;
        const tx = this.X(x), tz = this.Z(y);
        if (v.fresh || this.snap) { v.g.position.set(tx, lift, tz); v.fresh = false; }
        else { v.g.position.x += (tx - v.g.position.x) * k; v.g.position.z += (tz - v.g.position.z) * k; v.g.position.y += (lift - v.g.position.y) * k; }
        if (heading != null) v.g.rotation.y = heading;
        this.setLook(v, look);
      };
      const lookOf = (rack) => (rack.stage >= 3 ? 'crate' : rack.stage === 2 ? 'built' : rack.stage === 1 ? 'empty' : 'material');

      const phase2 = sim.now >= sim.phase2T;
      if (this.siteB) { this.siteB.visible = !phase2; this.equipB.visible = phase2; }

      for (const st of sim.line) {
        const zone = geo.zones[st.id];
        // racks waiting in the buffer
        for (let i = 0; i < st.queue.length; i++) {
          const s = zone.slots[Math.min(i, zone.slots.length - 1)] || { x: zone.x + 1, y: zone.y + 1 };
          place(st.queue[i], s.x, s.y, 0, lookOf(st.queue[i]), 0);
        }
        // work positions
        let busy = 0;
        st.servers.forEach((sv, i) => {
          const bay = this.bays[st.id + ':' + i];
          if (!bay) return;
          const state = sim.stateOf(sv);
          if (state === 'run') busy++;
          if (bay.idx != null) {
            col.setHex(STATE_HEX[state]);
            this.lightMesh.setColorAt(bay.idx, col); this.padMesh.setColorAt(bay.idx, col);
          }
          bay.fixture.visible = sv.online; bay.site.visible = !sv.online;
          if (bay.operator) bay.operator.visible = sv.online && sim.onShift && state !== 'down';
          if (bay.truck) bay.truck.visible = st.id === 'recv' ? (sv.phase !== 'idle' || sim.backlog.length > 0) : sv.phase !== 'idle';
          if (bay.arm) {
            const on = state === 'run';
            bay.arm.sh.rotation.y = bay.arm.base + (on ? Math.sin(this.clockT * 1.7 + i) * 0.9 : 0);
            bay.arm.el.rotation.z = -1.5 + (on ? Math.sin(this.clockT * 2.3 + i * 2) * 0.45 : 0);
          }
          if (bay.screen) bay.screen.visible = state === 'run';
          if (sv.rack) {
            let look = lookOf(sv.rack);
            if (st.id === 'asm' && sv.phase === 'run' && sv.dur > 0) {
              const done = 1 - (sv.endAt != null ? Math.max(0, sv.endAt - sim.now) : sv.remaining) / sv.dur;
              look = done > 0.85 ? 'built' : done > 0.4 ? 'half' : 'empty';
            }
            if ((st.id === 'test' || st.id === 'burn') && state === 'run') look = (sv.rack.id + i) % 2 ? blink : (blink === 'liveA' ? 'liveB' : 'liveA');
            if (st.id === 'pack' && sv.phase === 'run' && sv.dur > 0 && (sv.endAt != null ? sv.endAt - sim.now : sv.remaining) / sv.dur < 0.35) look = 'crate';
            place(sv.rack, bay.x / 1 + this.geo.floor.w / 2, bay.z + this.geo.floor.d / 2, 0, look, 0);
          }
        });
        // live line on the station sign
        const lab = this.labels[st.id];
        if (lab) {
          const txt = `${busy} of ${st.servers.filter((s) => s.online).length} working · ${st.queue.length} waiting`;
          if (txt !== lab.text && (!lab.t || this.clockT - lab.t > 0.4)) {
            lab.text = txt; lab.t = this.clockT;
            lab.sprite.material.map.dispose();
            lab.sprite.material.map = labelTex(geo.zones[st.id].name, txt);
          }
          lab.sprite.visible = this.showLabels;
        }
      }
      const ls = (this.host.clientWidth || 800) < 560 ? 0.036 : 0.034;
      for (const id in this.labels) this.labels[id].sprite.scale.set(ls * 4, ls, 1);
      for (const id of ['burnB', 'park']) if (this.labels[id]) {
        this.labels[id].sprite.visible = this.showLabels;
        if (id === 'burnB') {
          const txt = phase2 ? 'online' : 'under construction';
          if (this.labels[id].text !== txt) { this.labels[id].text = txt; this.labels[id].sprite.material.map.dispose(); this.labels[id].sprite.material.map = labelTex(geo.zones[id].name, txt, phase2 ? null : 'rgba(190,84,20,0.92)'); }
        }
      }
      this.lightMesh.instanceColor.needsUpdate = true; this.padMesh.instanceColor.needsUpdate = true;

      // robots, and whatever they carry
      for (const v of this.amrs) {
        const a = v.amr, at = sim.amrAt(a);
        let x, y, heading = v.heading;
        if (at.idle && a.node === 'park') { x = v.home.x; y = v.home.y; heading = 0; }
        else if (at.a === at.b) { const pt = geo.zones[at.a].port; x = pt.x + (a.id % 3 - 1) * 0.15; y = pt.y + (at.idle ? ((a.id % 2) * 2 - 1) * 1.4 : 0); }
        else { const q = geo.along(at.a, at.b, at.f); x = q.x; y = q.y; heading = -q.heading; }
        if (this.snap) { v.x = x; v.y = y; v.heading = heading; }
        else {
          v.x += (x - v.x) * Math.min(1, k * 1.6); v.y += (y - v.y) * Math.min(1, k * 1.6);
          let dh = heading - v.heading; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
          v.heading += dh * Math.min(1, k * 1.2);
        }
        v.g.position.set(this.X(v.x), 0, this.Z(v.y));
        v.g.rotation.y = v.heading;
        v.cart.visible = at.load === 'cart';
        if (a.rack) place(a.rack, v.x, v.y, 0.3, lookOf(a.rack), v.heading + Math.PI / 2);
      }
      // racks that have left the building
      for (const [id, v] of this.racks) if (v.seen !== seen) { this.dyn.remove(v.g); this.racks.delete(id); }
      this.snap = false;

      // selection marker follows the thing that was clicked
      let ring = null;
      if (this.sel && this.sel.type === 'rack') { const r = this.racks.get(this.sel.id); if (r) ring = { x: r.g.position.x, z: r.g.position.z, s: 1 }; }
      else if (this.sel && this.sel.type === 'amr') { const a = this.amrs[this.sel.id]; if (a) ring = { x: a.g.position.x, z: a.g.position.z, s: 1.25 }; }
      else if (this.sel && this.sel.type === 'station') { const z = geo.zones[this.sel.zone || this.sel.station]; if (z) ring = { x: this.X(z.port.x), z: this.Z(z.port.y), s: 1.5 }; }
      this.selRing.visible = !!ring;
      if (ring) { this.selRing.position.set(ring.x, 0.09, ring.z); const p = 1 + 0.08 * Math.sin(this.clockT * 5); this.selRing.scale.set(ring.s * p, ring.s * p, 1); }

      // lights go down when the staffed shift ends
      const want = sim.onShift ? 0 : 1;
      this.night += (want - this.night) * Math.min(1, dt * 2.5);
      this.hemi.intensity = 1.0 - 0.42 * this.night;
      this.sun.intensity = 2.1 - 1.45 * this.night;
      this.scene.background.copy(this.bgDay).lerp(this.bgNight, this.night);

      // camera
      if (this.follow >= 0 && this.amrs.length) {
        const busy = this.amrs.find((v) => v.amr.busy) || this.amrs[0];
        this.cam.target.lerp(new T.Vector3(this.X(busy.x), 0, this.Z(busy.y)), Math.min(1, dt * 3));
      }
      if (this.goal) {
        const g = this.goal, c = this.cam, e = Math.min(1, dt * 4);
        let dth = g.theta - c.theta; while (dth > Math.PI) dth -= 2 * Math.PI; while (dth < -Math.PI) dth += 2 * Math.PI;
        c.theta += dth * e; c.phi += (g.phi - c.phi) * e; c.radius += (g.radius - c.radius) * e; c.target.lerp(g.target, e);
        if (Math.abs(g.radius - c.radius) < 0.05 && Math.abs(dth) < 0.002 && Math.abs(g.phi - c.phi) < 0.002) this.goal = null;
      }
      const c = this.cam;
      const sp = Math.sin(c.phi), cp = Math.cos(c.phi);
      this.camera.position.set(c.target.x + c.radius * cp * Math.sin(c.theta), c.target.y + c.radius * sp, c.target.z + c.radius * cp * Math.cos(c.theta));
      this.camera.lookAt(c.target);
      if (this.lamps) this.lamps.visible = this.camera.position.y < 8.4;   // only seen from inside the building
    }

    render() { this.renderer.render(this.scene, this.camera); }

    // what is under the pointer: a robot, a rack, or a station
    pick(ev) {
      const el = this.renderer.domElement, r = el.getBoundingClientRect();
      const v = new T.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      this.ray.setFromCamera(v, this.camera);
      if (!this.editing) {
        const hits = this.ray.intersectObjects(this.dyn.children, true);
        for (const h of hits) if (h.object.visible && h.object.userData.type) return { type: h.object.userData.type, id: h.object.userData.id };
      }
      const z = this.ray.intersectObjects(this.pickers, false);
      return z.length ? z[0].object.userData : null;
    }
  }

  root.RackScene = { Scene3D, STATE_HEX };
})(typeof self !== 'undefined' ? self : this);
