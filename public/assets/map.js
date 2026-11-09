/* Park Pulse map — a tiny slippy map (XYZ raster tiles, markers, GPS dot).
   No third-party code: only the tile images come from the tile server. */
'use strict';

(() => {
  const T = 256;
  const MIN_Z = 13;
  const MAX_Z = 19;

  function project(lat, lng, z) {
    const s = T * 2 ** z;
    const r = (Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180;
    return {
      x: ((lng + 180) / 360) * s,
      y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * s,
    };
  }

  function unproject(x, y, z) {
    const s = T * 2 ** z;
    const n = Math.PI - (2 * Math.PI * y) / s;
    return { lat: (180 / Math.PI) * Math.atan(Math.sinh(n)), lng: (x / s) * 360 - 180 };
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  class PPMap {
    /**
     * @param {HTMLElement} root
     * @param {{tiles:string, attribution:string, center:{lat:number,lng:number}, zoom?:number,
     *          onMarker?:(id:string)=>void, onLocate?:()=>void, onMove?:()=>void}} opts
     */
    constructor(root, opts) {
      this.root = root;
      this.o = opts;
      this.z = opts.zoom || 16;
      this.c = { ...opts.center };
      this.tiles = new Map();
      this.markerEls = new Map();
      this.markers = [];
      this.user = null;
      this.selected = null;

      root.classList.add('ppmap');
      this.tileLayer = el('div', 'ppmap-tiles');
      this.markerLayer = el('div', 'ppmap-markers');
      this.acc = el('div', 'ppmap-acc');
      this.dot = el('div', 'ppmap-dot');
      this.acc.hidden = this.dot.hidden = true;
      // Route line (navigation) sits under the markers.
      this.routeSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      this.routeSvg.setAttribute('class', 'ppmap-route');
      this.routePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      this.routeDone = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      this.routeDone.setAttribute('class', 'done');
      this.routeSvg.append(this.routePath, this.routeDone);
      this.route = null;
      this.markerLayer.append(this.routeSvg, this.acc, this.dot);

      const ctl = el('div', 'ppmap-ctl');
      const btn = (label, title, fn) => {
        const b = el('button', null, label);
        b.type = 'button';
        b.title = title;
        b.setAttribute('aria-label', title);
        b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
        return b;
      };
      ctl.append(
        btn('+', 'Zoom in', () => this.zoomBy(1)),
        btn('−', 'Zoom out', () => this.zoomBy(-1)),
        btn('◎', opts.locateTitle || 'Show my location', () => (this.o.onLocate ? this.o.onLocate() : null)),
      );
      const attr = el('div', 'ppmap-attr', opts.attribution || '');

      root.append(this.tileLayer, this.markerLayer, ctl, attr);
      this.bindPointer();
      this.ro = new ResizeObserver(() => this.render());
      this.ro.observe(root);
      this.render();
    }

    size() {
      return { w: this.root.clientWidth, h: this.root.clientHeight };
    }

    origin() {
      const p = project(this.c.lat, this.c.lng, this.z);
      const { w, h } = this.size();
      return { x: p.x - w / 2, y: p.y - h / 2 };
    }

    setView(lat, lng, zoom) {
      this.c = { lat, lng };
      if (zoom) this.z = Math.max(MIN_Z, Math.min(MAX_Z, zoom));
      this.render();
    }

    /** @param {{id:string, lat:number, lng:number, label:string, cls:string, title:string}[]} list */
    setMarkers(list) {
      this.markers = list;
      const keep = new Set();
      for (const m of list) {
        keep.add(m.id);
        let b = this.markerEls.get(m.id);
        if (!b) {
          b = el('button', 'ppmap-marker');
          b.type = 'button';
          b.addEventListener('click', (e) => { e.stopPropagation(); this.o.onMarker?.(m.id); });
          this.markerEls.set(m.id, b);
          this.markerLayer.append(b);
        }
        b.className = 'ppmap-marker ' + m.cls + (m.id === this.selected ? ' sel' : '');
        b.textContent = m.label;
        b.title = m.title;
        b.setAttribute('aria-label', m.title);
        b._m = m;
      }
      for (const [id, b] of this.markerEls) {
        if (!keep.has(id)) { b.remove(); this.markerEls.delete(id); }
      }
      this.render();
    }

    select(id) {
      this.selected = id;
      for (const [mid, b] of this.markerEls) b.classList.toggle('sel', mid === id);
    }

    /** Draw a route: [{lat,lng}…]; `doneUpTo` = index of the walked part (drawn faded). */
    setRoute(points, doneUpTo) {
      this.route = points && points.length > 1 ? { points, doneUpTo: doneUpTo || 0 } : null;
      this.render();
    }

    setUser(pos) {
      this.user = pos;
      this.render();
    }

    zoomBy(dz, at) {
      const nz = Math.max(MIN_Z, Math.min(MAX_Z, this.z + dz));
      if (nz === this.z) return;
      const { w, h } = this.size();
      const pt = at || { x: w / 2, y: h / 2 };
      const o = this.origin();
      const ll = unproject(o.x + pt.x, o.y + pt.y, this.z);
      const p2 = project(ll.lat, ll.lng, nz);
      this.z = nz;
      this.c = unproject(p2.x - pt.x + w / 2, p2.y - pt.y + h / 2, nz);
      this.render();
      this.o.onMove?.();
    }

    panBy(dx, dy) {
      const p = project(this.c.lat, this.c.lng, this.z);
      this.c = unproject(p.x - dx, p.y - dy, this.z);
      this.render();
    }

    bindPointer() {
      const pts = new Map();
      let pinch = 0;
      let lastWheel = 0;
      const rel = (e) => {
        const r = this.root.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
      };
      const dist = () => {
        const [a, b] = [...pts.values()];
        return Math.hypot(a.x - b.x, a.y - b.y);
      };

      this.root.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.ppmap-ctl, .ppmap-marker')) return;
        this.root.setPointerCapture(e.pointerId);
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pts.size === 2) pinch = dist();
      });
      this.root.addEventListener('pointermove', (e) => {
        const prev = pts.get(e.pointerId);
        if (!prev) return;
        const cur = { x: e.clientX, y: e.clientY };
        if (pts.size === 1) {
          this.panBy(cur.x - prev.x, cur.y - prev.y);
        }
        pts.set(e.pointerId, cur);
        if (pts.size === 2 && pinch) {
          const d = dist();
          const [a, b] = [...pts.values()];
          const r = this.root.getBoundingClientRect();
          const mid = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
          if (d / pinch > 1.45) { this.zoomBy(1, mid); pinch = d; }
          else if (d / pinch < 0.69) { this.zoomBy(-1, mid); pinch = d; }
        }
      });
      const up = (e) => {
        if (pts.delete(e.pointerId) && pts.size === 0) this.o.onMove?.();
        if (pts.size < 2) pinch = 0;
      };
      this.root.addEventListener('pointerup', up);
      this.root.addEventListener('pointercancel', up);
      this.root.addEventListener('wheel', (e) => {
        e.preventDefault();
        const now = Date.now();
        if (now - lastWheel < 250) return;
        lastWheel = now;
        this.zoomBy(e.deltaY < 0 ? 1 : -1, rel(e));
      }, { passive: false });
      this.root.addEventListener('dblclick', (e) => {
        if (e.target.closest('.ppmap-ctl, .ppmap-marker')) return;
        this.zoomBy(1, rel(e));
      });
    }

    render() {
      const { w, h } = this.size();
      if (!w || !h) return;
      const o = this.origin();
      const n = 2 ** this.z;
      const want = new Set();
      for (let x = Math.floor(o.x / T); x <= Math.floor((o.x + w) / T); x++) {
        for (let y = Math.floor(o.y / T); y <= Math.floor((o.y + h) / T); y++) {
          if (y < 0 || y >= n) continue;
          const xx = ((x % n) + n) % n;
          const key = `${this.z}/${x}/${y}`;
          want.add(key);
          let img = this.tiles.get(key);
          if (!img) {
            img = new Image();
            img.referrerPolicy = 'strict-origin-when-cross-origin';
            img.crossOrigin = 'anonymous'; // CORS responses cache compactly (opaque ones are padded)
            img.decoding = 'async';
            img.alt = '';
            img.draggable = false;
            img.className = 'ppmap-tile';
            img.src = this.o.tiles.replace('{z}', this.z).replace('{x}', xx).replace('{y}', y)
              .replace('{s}', 'abc'[(xx + y) % 3]);
            this.tiles.set(key, img);
            this.tileLayer.append(img);
          }
          img.style.transform = `translate(${Math.round(x * T - o.x)}px, ${Math.round(y * T - o.y)}px)`;
        }
      }
      for (const [key, img] of this.tiles) {
        if (!want.has(key)) { img.remove(); this.tiles.delete(key); }
      }

      for (const b of this.markerEls.values()) {
        const m = b._m;
        const p = project(m.lat, m.lng, this.z);
        const x = p.x - o.x;
        const y = p.y - o.y;
        b.hidden = x < -40 || y < -40 || x > w + 40 || y > h + 40;
        b.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%)`;
      }

      if (this.route) {
        const toXY = (pt) => { const q = project(pt.lat, pt.lng, this.z); return `${(q.x - o.x).toFixed(1)},${(q.y - o.y).toFixed(1)}`; };
        const pts = this.route.points;
        const cut = Math.max(0, Math.min(pts.length - 1, this.route.doneUpTo));
        this.routeSvg.setAttribute('width', w);
        this.routeSvg.setAttribute('height', h);
        this.routeSvg.setAttribute('viewBox', `0 0 ${w} ${h}`);
        this.routePath.setAttribute('d', 'M' + pts.slice(cut).map(toXY).join(' L'));
        this.routeDone.setAttribute('d', cut > 0 ? 'M' + pts.slice(0, cut + 1).map(toXY).join(' L') : '');
        this.routeSvg.style.display = '';
      } else {
        this.routeSvg.style.display = 'none';
      }

      if (this.user) {
        const p = project(this.user.lat, this.user.lng, this.z);
        const x = p.x - o.x;
        const y = p.y - o.y;
        const mpp = (156543.03392 * Math.cos((this.user.lat * Math.PI) / 180)) / n; // metres per pixel
        const r = Math.max(8, Math.min(400, (this.user.acc || 0) / mpp));
        this.dot.hidden = this.acc.hidden = false;
        this.dot.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
        this.acc.style.width = this.acc.style.height = `${r * 2}px`;
        this.acc.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      } else {
        this.dot.hidden = this.acc.hidden = true;
      }
    }
  }

  /** Straight-line distance in metres. */
  PPMap.metres = (a, b) => {
    const dLat = (b.lat - a.lat) * 111320;
    const dLng = (b.lng - a.lng) * 111320 * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
    return Math.hypot(dLat, dLng);
  };

  window.PPMap = PPMap;
})();
