/* Park Pulse front end — vanilla JS, no build step. */
'use strict';

(() => {
  // ------------------------------------------------------------ helpers

  const $ = (sel, root = document) => root.querySelector(sel);

  /** Build DOM without innerHTML so API text can never inject markup. */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : String(kid));
    }
    return el;
  }

  /** el.replaceChildren(), but skipping null/false like h() does (the DOM would print "null"). */
  function fill(el, ...kids) {
    el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
    return el;
  }

  /** el.append(), but skipping null/false like h() does (the DOM would print "null"). */
  function add(el, ...kids) {
    el.append(...kids.flat(Infinity).filter((k) => k != null && k !== false));
    return el;
  }

  function svg(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
    return el;
  }

  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem('pp:' + key);
        return v == null ? fallback : JSON.parse(v);
      } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('pp:' + key, JSON.stringify(value)); } catch { /* full or blocked */ }
    },
  };

  let TZ = 'Europe/Paris';
  const fmtCache = {};
  function fmt(opts) {
    const k = JSON.stringify(opts);
    return fmtCache[k] || (fmtCache[k] = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...opts }));
  }
  const time = (iso) => (iso ? fmt({ hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '–');
  const timeTs = (ts) => fmt({ hour: '2-digit', minute: '2-digit' }).format(new Date(ts * 1000));
  const parkDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d); // YYYY-MM-DD
  const today = () => parkDate(new Date());
  const dayLabel = (ymd) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })
    .format(new Date(ymd + 'T12:00:00Z'));
  const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

  function ago(ts) {
    const s = Math.max(0, Math.round(Date.now() / 1000 - ts));
    if (s < 50) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min ago`;
    const hrs = Math.floor(m / 60);
    if (hrs < 24) return `${hrs} h ${m % 60} min ago`;
    return `${Math.floor(hrs / 24)} d ago`;
  }

  function minsUntil(iso) {
    return Math.round((Date.parse(iso) - Date.now()) / 60000);
  }

  function inLabel(mins) {
    if (mins <= 0) return 'now';
    if (mins < 60) return `in ${mins} min`;
    return `in ${Math.floor(mins / 60)} h ${mins % 60 ? (mins % 60) + ' min' : ''}`.trim();
  }

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  async function api(path, { method = 'GET', body } = {}) {
    const opts = { method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
    if (method !== 'GET') {
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['X-Park-Pulse'] = '1';
      opts.body = JSON.stringify(body || {});
    }
    const res = await fetch('api/' + path, opts);
    let data = null;
    try { data = await res.json(); } catch { /* not JSON */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || `HTTP ${res.status}`);
      err.status = res.status;
      if (res.status === 401) showLogin();
      throw err;
    }
    return data;
  }

  // -------------------------------------------------------------- state

  const S = {
    boot: null,
    park: store.get('park', 'dlp'),
    tab: store.get('tab', 'now'),
    live: store.get('live', {}), // park -> response
    liveErr: {},
    me: store.get('me', { favourites: [], log: [] }),
    trip: store.get('trip', null),
    tripErr: null,
    filter: store.get('filter', 'open'),
    sort: store.get('sort', 'wait'),
    q: '',
    showAll: false,
    hideReserved: store.get('hideReserved', true),
    foodArea: store.get('foodArea', store.get('park', 'dlp')),
    foodFilter: store.get('foodFilter', 'open'),
    foodSort: store.get('foodSort', 'status'),
    village: store.get('village', null),
    justMe: store.get('justMe', false),
    weather: store.get('weather', null),
    transit: store.get('transit', null),
    alerts: store.get('alerts', {}), // entity id -> { name, park, reopen, maxWait } (per device)
    placeKind: store.get('placeKind', 'food'), // Eat & shop tab: 'food' | 'shop'
    shops: store.get('shops', null),
    foodSched: store.get('foodSched', {}), // park -> per-restaurant Disney schedules
    best: store.get('best', null), // best times of day per ride
    bestAll: false,
    bestPick: {}, // ride id -> hour tapped in its strip
    mapKinds: { ride: true, show: true, food: true, shop: true, ess: false, rain: false, seat: false, smoke: false, view: false, ...store.get('mapKinds', {}) },
    dietFilter: store.get('dietFilter', null),
    ess: store.get('ess', null),
    leave: store.get('leave', {}), // "leave now" show alerts
    geo: null, // { lat, lng, acc, at }
    geoErr: null,
    mapSel: null,
    expanded: null,
    history: {},
    loading: {},
    online: navigator.onLine,
    deleting: null,
  };

  const QUEUE_TYPES = [
    ['STANDBY', 'Standby'],
    ['SINGLE_RIDER', 'Single rider'],
    ['PREMIER_ACCESS', 'Premier Access'],
    ['OTHER', 'Other'],
  ];

  const parkShort = (key) => (key === 'village' ? 'Disney Village' : (S.boot?.parks.find((p) => p.key === key)?.short) || key);
  const isLiveTab = () => S.tab === 'now' || S.tab === 'shows' || (S.tab === 'food' && S.foodArea !== 'village');
  /** Park whose live data the current screen shows. */
  const viewPark = () => (S.tab === 'food' && S.foodArea !== 'village' ? S.foodArea : S.park);

  // -------------------------------------------------------------- loading

  async function loadLive(park = S.park, { quiet = false } = {}) {
    if (S.loading[park]) return;
    S.loading[park] = true;
    if (!quiet) renderStatus();
    try {
      const data = await api('live/' + park);
      checkAlerts(park, S.live[park], data);
      S.live[park] = data;
      setTimeout(() => autoReplanCheck(park), 0);
      delete S.liveErr[park];
      store.set('live', S.live);
    } catch (e) {
      S.liveErr[park] = e.message;
    } finally {
      S.loading[park] = false;
    }
    if (park === viewPark()) {
      renderHeader();
      if (isLiveTab()) renderView();
    }
    if (S.tab === 'mine' || S.tab === 'map') renderView();
  }

  async function loadShops() {
    try {
      S.shops = await api('shops');
      store.set('shops', S.shops);
    } catch (e) {
      if (!S.shops) toast('Couldn’t load shops: ' + e.message);
    }
    if (S.tab === 'food' || S.tab === 'map' || S.tab === 'mine') renderView();
  }

  async function loadWeather() {
    try {
      S.weather = await api('weather');
      store.set('weather', S.weather);
      renderHeader();
      if (S.tab === 'trip' || S.tab === 'now') renderView();
    } catch { /* weather is optional */ }
  }

  async function loadTransit() {
    if (!S.boot?.transit) return;
    try {
      S.transit = await api('transit');
      store.set('transit', S.transit);
      if (S.tab === 'trip') renderView();
    } catch { /* optional */ }
  }

  // ------------------------------------------------------------ alerts
  // Per-device, checked whenever live data refreshes while the app is open.

  async function notify(title, body, tag) {
    toast(`${title} — ${body}`);
    if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) await reg.showNotification(title, { body, tag, icon: 'assets/icon.svg', badge: 'assets/icon.svg' });
      else new Notification(title, { body, tag });
    } catch { /* toast already shown */ }
  }

  const onTrip = () => today() >= S.boot.trip.start && today() <= S.boot.trip.end;

  function checkAlerts(park, prev, next) {
    if (!prev || !next || !onTrip()) return;
    const before = new Map(prev.items.map((it) => [it.id, it]));
    let changed = false;
    for (const it of next.items) {
      const a = S.alerts[it.id];
      if (!a) continue;
      const old = before.get(it.id);
      if (!old) continue;
      if (a.reopen && old.status !== 'OPERATING' && it.status === 'OPERATING') {
        notify(`${it.name} is open`, it.wait != null ? `Standby ${it.wait} min` : 'Back up and running', 'reopen-' + it.id);
        a.reopen = false;
        changed = true;
      }
      if (a.maxWait != null && it.status === 'OPERATING' && it.wait != null && it.wait <= a.maxWait
          && (old.wait == null || old.wait > a.maxWait || old.status !== 'OPERATING')) {
        notify(`${it.name}: ${it.wait} min`, `At or under your ${a.maxWait} min target`, 'wait-' + it.id);
      }
      if (a.down && old.status === 'OPERATING' && it.status === 'DOWN') {
        notify(`${it.name} just went down`, 'Temporarily closed', 'down-' + it.id);
      }
      if (!a.reopen && a.maxWait == null && !a.down) { delete S.alerts[it.id]; changed = true; }
    }
    if (changed) syncAlerts();
  }

  function alertParks() {
    return new Set(Object.values(S.alerts).map((a) => a.park));
  }

  function openAlertSheet(it, park) {
    const dlg = $('#sheet');
    const cur = S.alerts[it.id] || {};
    let reopen = cur.reopen ?? it.status !== 'OPERATING';
    let down = cur.down ?? false;
    let maxWait = cur.maxWait ?? (it.wait != null ? Math.max(5, Math.round((it.wait - 10) / 5) * 5) : 20);
    let useWait = cur.maxWait != null || (it.status === 'OPERATING' && cur.reopen == null);
    const out = h('output', null, String(maxWait));
    const step = (n) => () => { maxWait = Math.max(0, Math.min(180, maxWait + n)); out.textContent = String(maxWait); };
    const toggles = h('div', { class: 'qtypes' });
    const draw = () => toggles.replaceChildren(
      chip('When it reopens', reopen, () => { reopen = !reopen; draw(); }),
      chip('When wait ≤ target', useWait, () => { useWait = !useWait; draw(); }),
      chip('If it goes down', down, () => { down = !down; draw(); }));
    draw();

    const save = async () => {
      if (!reopen && !useWait && !down) delete S.alerts[it.id];
      else S.alerts[it.id] = { name: it.name, park, reopen, down, maxWait: useWait ? maxWait : null };
      syncAlerts();
      closeSheet();
      renderView();
      if (S.alerts[it.id] && 'Notification' in window && Notification.permission === 'default') {
        try { await Notification.requestPermission(); } catch { /* ignore */ }
      }
      toast(S.alerts[it.id] ? 'Alert set — keep Park Pulse open (or in the background)' : 'Alert removed');
    };

    dlg.replaceChildren(h('form', { method: 'dialog', onsubmit: (e) => { e.preventDefault(); save(); } },
      h('h2', null, `Alert · ${it.name}`),
      h('label', null, 'Tell me', toggles),
      h('label', null, 'Target wait (min)',
        h('div', { class: 'stepper' },
          h('button', { type: 'button', onclick: step(-5), 'aria-label': 'Minus 5' }, '−5'), out,
          h('button', { type: 'button', onclick: step(5), 'aria-label': 'Plus 5' }, '+5'))),
      h('p', { class: 'spark-lbl' }, 'Alerts are checked each time waits refresh while Park Pulse is open or in a background tab. They’re stored on this phone only.'),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn', onclick: closeSheet }, 'Cancel'),
        h('button', { type: 'submit', class: 'btn primary' }, 'Save'))));
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  }

  async function loadVillage() {
    try {
      S.village = await api('village');
      store.set('village', S.village);
    } catch (e) {
      if (!S.village) toast('Couldn’t load Disney Village: ' + e.message);
    }
    if (S.tab === 'food' || S.tab === 'mine') renderView();
  }

  async function loadMe() {
    try {
      S.me = await api('me');
      store.set('me', S.me);
      renderUser();
      if (S.tab === 'mine') renderView();
    } catch { /* keep cached */ }
  }

  async function loadTrip() {
    try {
      S.trip = await api('trip');
      S.tripErr = null;
      store.set('trip', S.trip);
    } catch (e) {
      S.tripErr = e.message;
    }
    if (S.tab === 'trip') renderView();
  }

  async function loadHistory(id) {
    const cached = S.history[id];
    if (cached && Date.now() - cached.at < 120000) return;
    try {
      const data = await api('history/' + encodeURIComponent(id));
      S.history[id] = { at: Date.now(), points: data.points };
      if (S.expanded === id) renderView();
    } catch { /* sparkline is optional */ }
  }

  async function setFav(item, park, on) {
    try {
      S.me = await api('favourites', { method: 'POST', body: { id: item.id, park, name: item.name, on } });
      store.set('me', S.me);
      for (const p of [...Object.values(S.live), S.village, S.shops]) {
        const it = p?.items?.find((x) => x.id === item.id);
        if (it) it.fav = on;
      }
      toast(on ? 'Added to must-do' : 'Removed from must-do');
      renderView();
    } catch (e) { toast(e.message); }
  }

  // ------------------------------------------------------------ rendering

  function render() {
    renderUser();
    renderParks();
    renderHeader();
    renderTabs();
    renderToolbar();
    renderView();
  }

  function renderParks() {
    const seg = $('#parkSeg');
    const parks = (S.boot?.parks || []).map((p) => ({ key: p.key, short: p.short, name: p.name }));
    const food = S.tab === 'food';
    if (food) parks.push({ key: 'village', short: 'Village', name: 'Disney Village & hotels' });
    const current = food ? S.foodArea : S.park;
    seg.hidden = ['trip', 'mine', 'map', 'guide', 'about', 'features', 'docs'].includes(S.tab) || parks.length === 0;
    seg.replaceChildren(...parks.map((p) => h('button', {
      type: 'button',
      role: 'tab',
      'aria-selected': String(p.key === current),
      title: p.name,
      onclick: () => switchPark(p.key),
    }, p.short)));
  }

  function switchPark(key) {
    if (S.tab === 'food') {
      if (key === S.foodArea) return;
      S.foodArea = key;
      store.set('foodArea', key);
    } else if (key === S.park) {
      return;
    }
    if (key !== 'village') {
      S.park = key;
      store.set('park', key);
    }
    S.expanded = null;
    render();
    window.scrollTo(0, 0);
    if (key === 'village') {
      if (!S.village) loadVillage();
      return;
    }
    const d = S.live[key];
    if (!d || Date.now() / 1000 - d.meta.fetchedAt > 60) loadLive(key);
  }

  function renderHeader() {
    renderStatus();
    const box = $('#hours');
    box.replaceChildren();
    if (['trip', 'mine', 'guide', 'about', 'features', 'docs'].includes(S.tab)) return;
    const wc = S.weather?.current;
    if (wc) {
      const rainSoon = (S.weather.hourly || []).slice(0, 6).find((x) => (x.pop ?? 0) >= 50);
      add(box, h('button', { type: 'button', class: 'wx-chip', onclick: openWeatherSheet, 'aria-label': 'Weather details' },
        `${wc.icon} ${wc.temp}°`, rainSoon ? ` · 💧${rainSoon.pop}% ${rainSoon.time.slice(11, 16)}` : '',
        wc.gusts >= 50 ? ' · 💨' : ''));
    }
    if (S.tab === 'map') {
      add(box, h('span', null, 'Both parks & Disney Village'));
      return;
    }
    if (S.tab === 'food' && S.foodArea === 'village') {
      add(box, h('span', null, 'Disney Village & hotels · hours from OpenStreetMap'));
      return;
    }
    const d = S.live[viewPark()];
    if (!d) return;
    if (d.date !== today()) {
      add(box, h('span', null, 'Hours from ' + dayLabel(d.date)));
      return;
    }
    const segs = d.hours || [];
    const op = segs.find((s) => s.type === 'OPERATING');
    const emh = segs.find((s) => s.type === 'EXTRA_HOURS');
    const now = Date.now();
    if (op) {
      const o = Date.parse(op.open), c = Date.parse(op.close);
      const emhOn = emh && now >= Date.parse(emh.open) && now < Date.parse(emh.close);
      if (emhOn) add(box, h('span', { class: 'badge emh' }, 'EXTRA MAGIC HOURS'));
      else if (now >= o && now < c) add(box, h('span', { class: 'badge open' }, 'OPEN'));
      else add(box, h('span', { class: 'badge closed' }, now < o ? 'NOT YET OPEN' : 'CLOSED'));
      add(box, h('span', null, `${time(op.open)}–${time(op.close)}`));
    } else if (segs.length === 0) {
      add(box, h('span', null, 'No hours published for today'));
    }
    if (emh) add(box, h('span', null, h('span', { class: 'badge emh' }, 'EMH'), ` ${time(emh.open)}–${time(emh.close)}`));
    for (const s of segs) {
      if (s.type !== 'OPERATING' && s.type !== 'EXTRA_HOURS') {
        add(box, h('span', null, `${s.description || s.type.toLowerCase()} ${time(s.open)}–${time(s.close)}`));
      }
    }
  }

  function renderStatus() {
    const el = $('#status');
    const pulse = $('.pulse');
    const park = viewPark();
    const d = S.live[park];
    let text = '';
    let warn = false;
    if (!S.online) { text = 'Offline'; warn = true; }
    if (isLiveTab()) {
      if (S.loading[park] && !d) text = 'Loading…';
      else if (d) {
        const age = Date.now() / 1000 - d.meta.fetchedAt;
        const parts = [(S.online ? '' : 'Offline · ') + 'Updated ' + ago(d.meta.fetchedAt)];
        if (d.meta.sources.includes('queue-times') && !d.meta.sources.includes('themeparks')) parts.push('via Queue-Times');
        text = parts.join(' · ');
        warn = !S.online || d.meta.stale || age > 600 || !!S.liveErr[park];
      } else if (S.liveErr[park]) { text = 'Can’t load live data'; warn = true; }
    }
    el.textContent = text;
    el.classList.toggle('warn', warn);
    pulse?.classList.toggle('off', warn);
  }

  function renderTabs() {
    $('#guideBtn')?.setAttribute('aria-pressed', String(S.tab === 'guide'));
    for (const b of document.querySelectorAll('#tabs button')) {
      if (b.dataset.tab === S.tab) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    }
  }

  function switchTab(tab) {
    S.tab = tab;
    store.set('tab', tab);
    S.expanded = null;
    S.q = '';
    S.searchOpen = false;
    render();
    window.scrollTo(0, 0);
    if (tab === 'trip' && (!S.trip || Date.now() / 1000 - S.trip.fetchedAt > 1800)) loadTrip();
    if (tab === 'trip' && (!S.transit || Date.now() / 1000 - S.transit.fetchedAt > 60)) loadTransit();
    if (tab === 'trip') { loadCrowd(); loadTouringPlans(); startPlanPolling(); }
    if (tab === 'guide') {
      loadGuide();
      loadRatings();
      if (!S.village) loadVillage();
      for (const p of S.boot.parks) if (!S.live[p.key]) loadLive(p.key, { quiet: true });
    }
    if (tab === 'food') { loadRatings(); loadMenus(); loadEssentials(); }
    if (tab === 'guide') loadMenus();
    if (tab === 'mine') {
      loadMe();
      loadBest();
      if (!S.village) loadVillage();
      if (!S.shops && (S.me?.favourites || []).some((f) => f.id.startsWith('osm-'))) loadShops();
    }
    if (tab === 'food' && S.foodArea === 'village' && !S.village) loadVillage();
    if ((tab === 'food' && S.placeKind === 'shop') || tab === 'map') {
      if (!S.shops || Date.now() / 1000 - S.shops.fetchedAt > 86400) loadShops();
    }
    if (tab === 'map') {
      if (!S.village) loadVillage();
      loadEssentials();
      for (const p of S.boot.parks) {
        const d = S.live[p.key];
        if (!d || Date.now() / 1000 - d.meta.fetchedAt > 60) loadLive(p.key, { quiet: true });
      }
      for (const p of S.boot.parks) loadFoodSched(p.key);
      startGeo();
      startPartyPolling();
    } else if (!S.share && !S.nav && !leavePending()) {
      stopGeo();
    }
    if (isLiveTab() && !S.live[viewPark()]) loadLive(viewPark());
  }

  function chip(label, pressed, onclick, title) {
    return h('button', { type: 'button', class: 'chip', 'aria-pressed': String(!!pressed), onclick, title }, label);
  }

  function renderToolbar() {
    renderSearch();
    const bar = $('#toolbar');
    bar.replaceChildren();
    bar.hidden = true;
    if (S.tab === 'now') {
      bar.hidden = false;
      const setFilter = (f) => () => { S.filter = f; store.set('filter', f); renderToolbar(); renderView(); };
      const sort = h('select', {
        'aria-label': 'Sort',
        onchange: (e) => { S.sort = e.target.value; store.set('sort', S.sort); renderView(); },
      },
      h('option', { value: 'wait', selected: S.sort === 'wait' }, 'Shortest'),
      h('option', { value: 'land', selected: S.sort === 'land' }, 'By land'),
      h('option', { value: 'name', selected: S.sort === 'name' }, 'A–Z'));
      add(bar, 
        chip('Open', S.filter === 'open', setFilter('open')),
        chip('★', S.filter === 'fav', setFilter('fav'), 'Must-do only'),
        chip('All', S.filter === 'all', setFilter('all')),
        chip('☔', !!S.rainMode, () => { S.rainMode = !S.rainMode; renderToolbar(); renderView(); }, 'Rain plan: indoor rides only'),
        chip('🔮 Later', !!S.laterMode, () => { S.laterMode = !S.laterMode; renderToolbar(); renderView(); }, 'Predicted waits for the next hours'),
        sort,
      );
    } else if (S.tab === 'shows') {
      bar.hidden = false;
      add(bar, 
        chip('Upcoming', !S.showAll, () => { S.showAll = false; renderToolbar(); renderView(); }),
        chip('All today', S.showAll, () => { S.showAll = true; renderToolbar(); renderView(); }),
        chip('Reserved areas', !S.hideReserved, () => {
          S.hideReserved = !S.hideReserved; store.set('hideReserved', S.hideReserved); renderToolbar(); renderView();
        }, 'Show reserved viewing area sessions'),
        refreshChip(),
      );
    } else if (S.tab === 'food') {
      bar.hidden = false;
      const setFilter = (f) => () => { S.foodFilter = f; store.set('foodFilter', f); renderToolbar(); renderView(); };
      const sort = h('select', {
        'aria-label': 'Sort',
        onchange: (e) => { S.foodSort = e.target.value; store.set('foodSort', S.foodSort); renderView(); },
      },
      h('option', { value: 'status', selected: S.foodSort === 'status' }, 'Open first'),
      h('option', { value: 'land', selected: S.foodSort === 'land' }, 'By area'),
      h('option', { value: 'name', selected: S.foodSort === 'name' }, 'A–Z'));
      const shop = S.placeKind === 'shop';
      const setKind = (k) => () => {
        S.placeKind = k; store.set('placeKind', k); S.expanded = null;
        if (k === 'shop' && !S.shops) loadShops();
        renderToolbar(); renderView();
      };
      add(bar, 
        chip('🍴 Food', !shop, setKind('food')),
        chip('🛍 Shops', shop, setKind('shop')),
        h('span', { class: 'tb-sep', 'aria-hidden': 'true' }),
        shop ? null : chip('Open now', S.foodFilter === 'open', setFilter('open')),
        chip('★', S.foodFilter === 'fav', setFilter('fav'), 'Must-do only'),
        chip('All', S.foodFilter === 'all' || (shop && S.foodFilter === 'open'), setFilter('all')),
        shop ? null : chip(S.dietFilter ? DIETS[S.dietFilter] : '🥗 Any diet', !!S.dietFilter, () => {
          S.dietFilter = DIET_CYCLE[(DIET_CYCLE.indexOf(S.dietFilter) + 1) % DIET_CYCLE.length];
          store.set('dietFilter', S.dietFilter);
          if (!S.ess) loadEssentials();
          renderToolbar(); renderView();
        }, 'Filter by diet (tap to cycle)'),
        shop ? null : sort,
      );
    } else if (S.tab === 'guide') {
      bar.hidden = false;
      const secs = [['hotels', '🏨 Hotels'], ['dining', '🍽 Dining'], ['skip', '⚡ Skip line'], ['park', '🎢 Park info'], ['access', '♿ Access'], ['transport', '🚆 Transport'], ['events', '🎉 Events']];
      add(bar, ...secs.map(([k, l]) => chip(l, S.guideSec === k, () => { S.guideSec = k; store.set('guideSec', k); renderToolbar(); renderView(); window.scrollTo(0, 0); })));
    } else if (S.tab === 'map') {
      bar.hidden = false;
      const on = MAP_LAYERS.filter(([k]) => S.mapKinds[k]).length;
      add(bar, 
        chip(`🗂 Layers · ${on}`, false, openLayersSheet, 'Choose what the map shows'),
        chip('◎ Me', false, () => centreOnMe()),
        chip('🚻 Nearest', false, () => goNearest('toilets'), 'Walk to the nearest toilet'),
        chip(S.share ? '👥 Sharing' : '👥 Share me', S.share, () => setSharing(!S.share), 'Share your location with your party'),
        chip('📌 Pin me', false, () => (S.geo ? setMeet(S.geo.lat, S.geo.lng, `Meet ${myName() || 'here'}`) : toast('Waiting for your location…')), 'Drop a meet-up pin where you are'),
        S.boot.w3w ? chip('/// Me', false, openMyW3w, 'My what3words address') : null,
        chip('⬇ Offline', false, openOfflineSheet, 'Offline map'),
      );
    } else if (S.tab === 'trip') {
      bar.hidden = false;
      add(bar, 
        chip('Reserved areas', !S.hideReserved, () => {
          S.hideReserved = !S.hideReserved; store.set('hideReserved', S.hideReserved); renderToolbar(); renderView();
        }),
        chip('↻ Refresh', false, () => { toast('Refreshing schedules…'); loadTrip(); }),
      );
    }
  }

  // ------------------------------------------------------------- search
  // 🔍 in the header opens a search bar under it (Waits and Eat & shop tabs).

  const searchLabel = () => (S.tab === 'now' ? 'Search rides or lands'
    : S.placeKind === 'shop' ? 'Search shops' : 'Search food & drink');

  function renderSearch() {
    const btn = $('#searchBtn');
    const bar = $('#searchBar');
    const input = $('#searchInput');
    const available = S.boot?.authed !== false && (S.tab === 'now' || S.tab === 'food');
    btn.hidden = !available;
    if (!available) S.searchOpen = false;
    bar.hidden = !S.searchOpen;
    btn.setAttribute('aria-expanded', String(!!S.searchOpen));
    btn.classList.toggle('active', !!S.q);
    input.placeholder = searchLabel();
    input.setAttribute('aria-label', searchLabel());
    if (input.value !== S.q) input.value = S.q;
  }

  function openSearch() {
    S.searchOpen = true;
    renderSearch();
    const input = $('#searchInput');
    input.focus();
    input.select();
  }

  function closeSearch() {
    S.searchOpen = false;
    if (S.q) { S.q = ''; renderView(); }
    renderSearch();
  }

  function refreshChip() {
    return chip('↻ Refresh', false, () => loadLive(S.park));
  }

  /** Footer on every screen: when the cron collector last ran (newest value we've seen). */
  function cronFooter() {
    if (!S.boot) return '';
    const last = Math.max(S.boot.cronLast || 0, ...Object.values(S.live).map((d) => d?.meta?.cronLast || 0));
    if (!last) {
      return h('p', { class: 'foot cron-foot warn' }, '⏱ Data collector (cron) hasn’t run yet — history, alerts and reminders need it. See README → cron.');
    }
    const mins = (Date.now() / 1000 - last) / 60;
    const day = parkDate(new Date(last * 1000)) === today() ? '' : `${dayLabel(parkDate(new Date(last * 1000)))} `;
    return h('p', { class: 'foot cron-foot' + (mins > 15 ? ' warn' : '') },
      `⏱ Cron last ran ${day}${timeTs(last)} (${ago(last)})`, mins > 15 ? ' — it should run every 5 min' : '');
  }

  /** Footer links: scan this site's security headers and check its DNSSEC (Verisign Labs). */
  function securityFooter() {
    const host = location.hostname;
    const site = `${location.protocol}//${location.host}${document.baseURI ? new URL(document.baseURI).pathname : '/'}`;
    const ext = (href, label) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, label);
    return h('p', { class: 'foot sec-foot' },
      S.boot?.version ? h('span', { class: 'ver' }, `${S.boot.appName || 'Park Pulse'} v${S.boot.version} · `) : null,
      h('a', { href: '#tab=about', onclick: (e) => { e.preventDefault(); openPage('about'); } }, 'ℹ️ About'),
      ' · ', h('a', { href: '#tab=features', onclick: (e) => { e.preventDefault(); openPage('features'); } }, 'Features'),
      ' · ', h('a', { href: '#tab=docs', onclick: (e) => { e.preventDefault(); openPage('docs'); } }, 'Docs'),
      ' · 🔒 ', ext(`https://securityheaders.com/?q=${encodeURIComponent(site)}&followRedirects=on`, 'Security headers'),
      ' · ', ext(`https://dnssec-analyzer.verisignlabs.com/${encodeURIComponent(host)}`, 'DNSSEC (Verisign)'));
  }

  function renderView() {
    const view = $('#view');
    let content;
    if (!S.boot) content = h('p', { class: 'empty' }, 'Loading…');
    else if (S.tab === 'shows') content = viewShows();
    else if (S.tab === 'food') content = S.placeKind === 'shop' ? viewShops() : viewFood();
    else if (S.tab === 'map') content = viewMap();
    else if (S.tab === 'guide') content = viewGuide();
    else if (S.tab === 'about') content = viewAbout();
    else if (S.tab === 'features') content = viewFeatures();
    else if (S.tab === 'docs') content = viewDocs();
    else if (S.tab === 'trip') content = viewTrip();
    else if (S.tab === 'mine') content = viewMine();
    else content = viewNow();
    fill(view, queueBar(), content, cronFooter(), securityFooter());
  }

  // ------------------------------------------------------------ queue timer
  // Kept on this phone, so it survives closing the app. A timer left over from another day is dropped.

  S.queue = store.get('queueTimer', null);
  S.charOpen = store.get('charOpen', false);

  function activeQueue() {
    if (S.queue && parkDate(new Date(S.queue.startedAt)) !== today()) setQueue(null);
    return S.queue;
  }

  function setQueue(q) {
    S.queue = q;
    store.set('queueTimer', q);
  }

  const queueMins = (q) => Math.max(0, Math.round((Date.now() - q.startedAt) / 60000));

  function startQueue(it, park) {
    const was = activeQueue();
    setQueue({
      id: it.id,
      park,
      name: it.name,
      startedAt: Date.now(),
      posted: { STANDBY: it.wait ?? null, SINGLE_RIDER: it.singleRider ?? null },
    });
    toast(was && was.id !== it.id ? `Timer moved from ${was.name}` : `Timing your queue for ${it.name}`);
    renderView();
  }

  function boardQueue() {
    const q = activeQueue();
    if (q) openLogSheet(liveItem(q.id) || { id: q.id, name: q.name }, q.park, q);
  }

  function queueButton(it, park) {
    const q = activeQueue();
    if (q?.id === it.id) return h('button', { type: 'button', class: 'btn primary', onclick: boardQueue }, '✓ I’m on');
    if (it.status !== 'OPERATING') return null;
    return h('button', { type: 'button', class: 'btn', onclick: () => startQueue(it, park) }, '⏱ I’m in the queue');
  }

  function queueBar() {
    const q = S.boot?.authed ? activeQueue() : null;
    if (!q) return null;
    const sign = q.posted?.STANDBY;
    let confirming = false;
    return h('div', { class: 'card queue-bar', role: 'status' },
      h('span', { class: 'what' }, `⏱ ${q.name}`, h('small', null, sign != null ? `Sign said ${sign} min when you joined` : 'Timing your queue')),
      h('b', { id: 'queueMins' }, `${queueMins(q)} min`),
      h('button', {
        type: 'button',
        class: 'btn small',
        onclick: (e) => {
          if (!confirming) {
            confirming = true;
            e.currentTarget.classList.add('danger');
            e.currentTarget.textContent = 'Stop?';
            return;
          }
          setQueue(null);
          renderView();
        },
      }, 'Cancel'),
      h('button', { type: 'button', class: 'btn small primary', onclick: boardQueue }, 'I’m on'));
  }

  setInterval(() => {
    const el = document.getElementById('queueMins');
    if (!el) return;
    const q = activeQueue();
    if (q) el.textContent = `${queueMins(q)} min`;
    else renderView();
  }, 15000);

  // ------------------------------------------------------------ money

  const money = (cents) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR' }).format(cents / 100);
  const sumCents = (rows) => rows.reduce((n, p) => n + (p.amountCents || 0), 0);

  function amountInput(label) {
    return h('input', { type: 'number', inputmode: 'decimal', min: '0', max: '100000', step: '0.01', placeholder: '0.00', 'aria-label': label });
  }

  function spendSection(scope, oidc) {
    let all = S.me?.places || [];
    if (scope) all = all.filter((p) => p.day >= scope.start && p.day <= scope.end);
    const justMe = oidc && S.justMe;
    const rows = (justMe ? all.filter((p) => p.mine) : all).filter((p) => p.amountCents != null);
    const visit = scope?.id ? (S.boot.visits || []).find((v) => v.id === scope.id) : null;
    const budget = visit?.budgetCents ?? null;
    if (!scope && !rows.length) return null;

    const tally = (keyOf) => {
      const m = new Map();
      for (const p of rows) m.set(keyOf(p), (m.get(keyOf(p)) || 0) + p.amountCents);
      return [...m.entries()];
    };
    const line = (label, cents) => h('li', null, h('span', null, label), h('b', null, money(cents)));
    const party = sumCents(all);
    const people = justMe ? [] : tally((p) => p.by || 'Unknown').sort((a, b) => b[1] - a[1]);
    const kinds = tally((p) => p.kind);

    return h('section', { class: 'card spend' },
      h('h2', null, '💶 Spending'),
      rows.length ? h('p', { class: 'spend-total' }, h('b', null, money(sumCents(rows))), ` ${justMe ? 'spent by you' : 'spent'}`) : null,
      budget != null ? h('div', { class: 'spend-budget' },
        h('progress', { value: String(Math.min(party, budget)), max: String(Math.max(budget, 1)), 'aria-label': 'Party budget used' }),
        h('p', { class: party > budget ? 'over' : null },
          `Party: ${money(party)} of ${money(budget)} · `,
          party > budget ? `${money(party - budget)} over` : `${money(budget - party)} left`)) : null,
      !rows.length ? h('p', { class: 'spark-lbl' }, 'Add an amount when you tap I ate here or I shopped here, and it’s totalled here.') : null,
      rows.length ? h('ul', { class: 'spend-list' },
        kinds.map(([k, c]) => line(k === 'food' ? '🍽 Food' : '🛍 Shops', c))) : null,
      people.length > 1 ? [h('h3', null, 'By person'), h('ul', { class: 'spend-list' }, people.map(([n, c]) => line(n, c)))] : null,
      rows.length ? [h('h3', null, 'By day'), h('ul', { class: 'spend-list' },
        tally((p) => p.day).sort((a, b) => a[0].localeCompare(b[0])).map(([d, c]) => line(dayLabelY(d), c)))] : null,
      visit ? h('div', { class: 'wr-actions' }, h('button', { type: 'button', class: 'btn small', onclick: () => openBudgetSheet(visit) }, budget != null ? '✏️ Change budget' : '＋ Set a budget')) : null);
  }

  function openBudgetSheet(visit) {
    const dlg = $('#sheet');
    const input = amountInput('Budget in euros');
    if (visit.budgetCents != null) input.value = (visit.budgetCents / 100).toFixed(2);
    const form = h('form', {
      method: 'dialog',
      onsubmit: async (e) => {
        e.preventDefault();
        const btn = form.querySelector('button[type=submit]');
        btn.disabled = true;
        try {
          applyVisits(await api(`visits/${visit.id}/budget`, { method: 'POST', body: { amount: input.value === '' ? null : input.value } }));
          toast('Budget saved');
        } catch (err) {
          btn.disabled = false;
          toast(err.message);
        }
      },
    },
    h('h2', null, `Budget for ${visitName(visit)}`),
    h('label', null, 'Party budget (€)', input),
    h('p', { class: 'spark-lbl' }, 'Shared with everyone. Leave it empty to remove the budget.'),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn', onclick: closeSheet }, 'Cancel'),
      h('button', { type: 'submit', class: 'btn primary' }, 'Save')));
    dlg.replaceChildren(form);
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
  }

  // ------------------------------------------------------------ character collection

  const isMeet = (n) => /meet|encounter|pavilion|meeting/i.test(n);

  /** The checklist from characters.php, plus anyone the party has added. */
  function characterChecklist() {
    const out = new Map();
    for (const c of S.me?.characterList || []) out.set(normName(c.name), { name: c.name, emoji: c.emoji || '🤝' });
    for (const c of (S.me?.characters || []).slice().reverse()) {
      if (!out.has(normName(c.name))) out.set(normName(c.name), { name: c.name, emoji: '🤝' });
    }
    return out;
  }

  /** "Meet Mickey at ..." → Mickey Mouse. Empty when the name doesn't say who it is. */
  function guessCharacter(showName) {
    const words = new Set(normName(showName).split(' '));
    for (const c of characterChecklist().values()) {
      const parts = normName(c.name).split(' ');
      if (words.has(parts[0]) && parts[0].length > 2) return c;
    }
    return null;
  }

  const characterPhotoUrl = (id) => `api/characters/${id}/photo`;

  /** Fit a photo inside 1000 px as a JPEG small enough to upload over park signal. */
  async function photoFromFile(file) {
    const bmp = await createImageBitmap(file);
    for (const [side, quality] of [[1000, 0.75], [800, 0.65], [600, 0.55]]) {
      const scale = Math.min(1, side / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * scale);
      c.height = Math.round(bmp.height * scale);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const url = c.toDataURL('image/jpeg', quality);
      if (url.length < 500000) return url; // about 370 KB once decoded
    }
    throw new Error('Too big');
  }

  function photoPicker() {
    let photo = null;
    const preview = h('div', { class: 'char-preview' });
    const clearBtn = h('button', { type: 'button', class: 'btn small', hidden: true, onclick: () => { photo = null; draw(); } }, '✕ Remove');
    const draw = () => {
      fill(preview, photo ? h('img', { src: photo, alt: 'Your photo' }) : null);
      clearBtn.hidden = !photo;
    };
    const file = h('input', {
      type: 'file', accept: 'image/*', hidden: true,
      onchange: async (e) => {
        const f = e.target.files[0];
        e.target.value = '';
        if (!f) return;
        try { photo = await photoFromFile(f); draw(); } catch { toast('Couldn’t use that photo — try another.'); }
      },
    });
    return {
      el: h('div', { class: 'char-photo-pick' }, preview,
        h('div', { class: 'wr-actions' }, h('button', { type: 'button', class: 'btn small', onclick: () => file.click() }, '📷 Add a photo'), clearBtn), file),
      value: () => photo,
    };
  }

  function characterMeetings(c, reopen) {
    const key = normName(c.name);
    const oidc = !!(S.me?.user || S.boot.user);
    const rows = (S.me?.characters || []).filter((m) => normName(m.name) === key);
    if (!rows.length) return null;
    return h('ul', { class: 'char-meets' }, rows.map((m) => {
      let confirming = false;
      return h('li', null,
        m.photo ? h('img', {
          src: characterPhotoUrl(m.id), alt: `Photo with ${m.name}`, loading: 'lazy',
          onclick: (e) => e.currentTarget.classList.toggle('big'),
        }) : null,
        h('span', { class: 'what' }, `${m.kind === 'seen' ? '👀 Seen' : '🤝 Met'} · ${dayLabelY(m.day)} · ${timeTs(m.metAt)}`,
          h('small', null, [oidc && m.by ? (m.mine ? 'You' : m.by) : null, m.note].filter(Boolean).join(' · '))),
        h('button', {
          type: 'button', class: 'btn small', 'aria-label': 'Delete entry',
          onclick: async (e) => {
            if (!confirming) {
              confirming = true;
              e.currentTarget.classList.add('danger');
              e.currentTarget.textContent = 'Delete?';
              return;
            }
            try {
              S.me = await api(`characters/${m.id}`, { method: 'DELETE' });
              store.set('me', S.me);
              toast('Deleted');
              renderView();
              reopen();
            } catch (err) { toast(err.message); }
          },
        }, '✕'));
    }));
  }

  /** Log a meeting or a sighting. With no character given, the sheet asks who it was. */
  function openCharacterSheet(c, { asked } = {}) {
    const picker = photoPicker();
    let kind = 'met';
    const kindBox = h('div', { class: 'qtypes' });
    const drawKind = () => kindBox.replaceChildren(
      chip('🤝 Met them', kind === 'met', () => { kind = 'met'; drawKind(); }),
      chip('👀 Seen them', kind === 'seen', () => { kind = 'seen'; drawKind(); }));
    drawKind();
    const who = c ? null : h('input', { type: 'text', required: true, maxlength: '60', value: asked?.name || '', placeholder: 'e.g. Mickey Mouse', 'aria-label': 'Who did you see or meet?' });
    openDaySheet({
      title: c ? `${c.emoji} ${c.name}` : '🤝 Who did you see or meet?',
      at: new Date(),
      timeLabel: 'Time',
      placeholder: 'Optional — they waved from the parade…',
      top: c ? characterMeetings(c, () => openCharacterSheet(c)) : null,
      extras: [who ? h('label', null, 'Character', who) : null, h('label', null, 'Did you meet them or just see them?', kindBox), picker.el],
      saved: () => `Logged ${c ? c.name : who.value.trim()}`,
      send: (when, note) => api('characters', { method: 'POST', body: { name: c ? c.name : who.value.trim(), kind, note, metAt: when, photo: picker.value() } }),
    });
  }

  function characterSection(scope, oidc) {
    let rows = S.me?.characters || [];
    if (oidc && S.justMe) rows = rows.filter((m) => m.mine);
    if (scope) rows = rows.filter((m) => m.day >= scope.start && m.day <= scope.end);
    const list = [...characterChecklist().entries()];
    const entries = (key) => rows.filter((m) => normName(m.name) === key);
    const hasMet = (seen) => seen.some((m) => m.kind !== 'seen');
    const metCount = list.filter(([key]) => hasMet(entries(key))).length;
    const done = list.filter(([key]) => entries(key).length).length;
    const seenCount = done - metCount;
    const card = h('details', { class: 'card char-card', open: S.charOpen || null },
      h('summary', {
        onclick: (e) => {
          e.preventDefault();
          S.charOpen = !S.charOpen;
          store.set('charOpen', S.charOpen);
          card.open = S.charOpen;
        },
      }, '🤝 Character collection', h('small', null, `${done} of ${list.length} · ${metCount} met, ${seenCount} seen`)),
      h('progress', { value: String(done), max: String(Math.max(list.length, 1)), 'aria-label': 'Characters met or seen' }),
      h('ul', { class: 'list' }, list.map(([key, c]) => {
        const seen = entries(key);
        const photo = seen.find((m) => m.photo);
        const names = [...new Set(seen.map((m) => (oidc && m.by ? (m.mine ? 'You' : m.by) : null)).filter(Boolean))];
        return h('li', { class: 'card' }, h('button', {
          type: 'button', class: 'fav-item ride-main',
          onclick: () => openCharacterSheet(c),
        },
        h('span', { class: 'tick' }, !seen.length ? '' : hasMet(seen) ? '✓' : '👀'),
        photo ? h('img', { class: 'char-thumb', src: characterPhotoUrl(photo.id), alt: '', loading: 'lazy' }) : h('span', { class: 'char-emoji', 'aria-hidden': 'true' }, c.emoji),
        h('span', { class: 'what' }, c.name, seen.length
          ? h('small', null, [hasMet(seen) ? 'Met' : 'Seen', names.join(', '), seen.length > 1 ? `×${seen.length}` : null, dayLabelY(seen[0].day)].filter(Boolean).join(' · '))
          : null)));
      })),
      h('div', { class: 'wr-actions' }, h('button', { type: 'button', class: 'btn small', onclick: () => openCharacterSheet(null) }, '＋ Add someone else')));
    return card;
  }

  // ------------------------------------------------------------ visit vs visit

  function visitTotals(v, justMe) {
    const pick = (rows) => (rows || []).filter((r) => r.day >= v.start && r.day <= v.end && (!justMe || r.mine));
    const log = pick(S.me?.log);
    const places = pick(S.me?.places);
    const timed = log.filter((l) => l.wait != null);
    const queued = timed.reduce((n, l) => n + l.wait, 0);
    const days = new Set(log.map((l) => l.day)).size;
    const chars = pick(S.me?.characters);
    const metNames = new Set(chars.filter((c) => c.kind !== 'seen').map((c) => normName(c.name)));
    const seenNames = new Set(chars.filter((c) => c.kind === 'seen' && !metNames.has(normName(c.name))).map((c) => normName(c.name)));
    const counts = new Map();
    for (const l of log) counts.set(l.name, (counts.get(l.name) || 0) + 1);
    return {
      rides: log.length,
      names: counts,
      different: counts.size,
      days,
      perDay: days ? (log.length / days).toFixed(1) : '–',
      queued: fmtQueued(queued),
      average: timed.length ? `${Math.round(queued / timed.length)} min` : '–',
      shows: pick(S.me?.shows).length,
      meals: places.filter((p) => p.kind === 'food').length,
      shops: places.filter((p) => p.kind === 'shop').length,
      perused: places.filter((p) => p.kind === 'browse').length,
      characters: metNames.size,
      seen: seenNames.size,
      spent: money(sumCents(places)),
      top: [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3),
    };
  }

  /** Oldest first, so "since last time" always reads forwards whichever way round they were picked. */
  function compareBody(a, b, justMe) {
    const [old, recent] = a.start <= b.start ? [a, b] : [b, a];
    const x = visitTotals(old, justMe);
    const y = visitTotals(recent, justMe);
    const rows = [
      ['Rides', x.rides, y.rides], ['Different rides', x.different, y.different],
      ['Days with rides', x.days, y.days], ['Rides per day', x.perDay, y.perDay],
      ['Time queued', x.queued, y.queued], ['Average wait', x.average, y.average],
      ['Shows watched', x.shows, y.shows], ['Places you ate', x.meals, y.meals], ['Shops visited', x.shops, y.shops], ['Shops perused', x.perused, y.perused],
      ['Characters met', x.characters, y.characters], ['Characters only seen', x.seen, y.seen], ['Spent', x.spent, y.spent],
    ];
    const names = (list) => {
      const shown = list.slice(0, 8);
      return `${shown.join(', ')}${list.length > shown.length ? ` and ${list.length - shown.length} more` : ''}`;
    };
    const firstTime = [...y.names.keys()].filter((n) => !x.names.has(n));
    const skipped = [...x.names.keys()].filter((n) => !y.names.has(n));
    const added = (S.catalog?.added || []).filter((c) => c.firstSeen > old.end && c.firstSeen <= recent.end).map((c) => c.name);
    const topList = (v, t) => h('div', null, h('h3', null, `Top rides, ${visitName(v)}`), t.top.length
      ? h('ol', { class: 'cmp-top' }, t.top.map(([n, c]) => h('li', null, n, c > 1 ? ` ×${c}` : '')))
      : h('p', { class: 'spark-lbl' }, 'No rides logged.'));
    const para = (title, list) => (list.length ? [h('h3', null, title), h('p', { class: 'cmp-names' }, names(list))] : null);
    return [
      h('div', { class: 'cmp-wrap' }, h('table', { class: 'cmp' },
        h('thead', null, h('tr', null, h('th', null, ''), h('th', { scope: 'col' }, visitName(old)), h('th', { scope: 'col' }, visitName(recent)))),
        h('tbody', null, rows.map(([label, p, q]) => h('tr', null, h('th', { scope: 'row' }, label), h('td', null, String(p)), h('td', null, String(q))))))),
      h('div', { class: 'cmp-tops' }, topList(old, x), topList(recent, y)),
      para(`New to ${justMe ? 'you' : 'the party'} on ${visitName(recent)}`, firstTime),
      para(`Ridden on ${visitName(old)}, not on ${visitName(recent)}`, skipped),
      para(`New at the parks since ${visitName(old)}`, added),
    ];
  }

  function openCompareSheet(scope) {
    const dlg = $('#sheet');
    const visits = S.boot.visits || []; // newest first
    const justMe = !!(S.me?.user || S.boot.user) && S.justMe;
    const hasData = (v) => [S.me?.log, S.me?.shows, S.me?.places, S.me?.characters].some((rows) => (rows || []).some((r) => r.day >= v.start && r.day <= v.end));
    const used = visits.filter(hasData);
    const pool = used.length >= 2 ? used : visits;
    let right = scope && pool.some((v) => v.id === scope.id) ? scope : pool[0];
    let left = pool.find((v) => v.start < right.start) || pool.find((v) => v.id !== right.id);
    const box = h('div');
    const draw = () => {
      const chips = (current, set) => h('div', { class: 'qtypes' }, visits.map((v) => chip(visitName(v), v.id === current.id, () => { set(v); draw(); })));
      fill(box,
        h('label', null, 'Compare', chips(left, (v) => { left = v; })),
        h('label', null, 'With', chips(right, (v) => { right = v; })),
        h('p', { class: 'spark-lbl' }, justMe ? 'Just you. Change this with Everyone / Just me on Mine.' : 'Everyone. Change this with Everyone / Just me on Mine.'),
        left.id === right.id ? h('p', { class: 'empty' }, 'Pick two different visits.') : compareBody(left, right, justMe));
    };
    draw();
    dlg.replaceChildren(h('div', { class: 'cmp-sheet' },
      h('h2', null, '📊 Compare visits'),
      box,
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn primary', onclick: closeSheet }, 'Done'))));
    if (typeof dlg.showModal === 'function' && !dlg.open) dlg.showModal();
    else dlg.setAttribute('open', '');
  }

  // ------------------------------------------------------------ waits tab

  function waitClass(it) {
    if (it.status === 'DOWN') return 'down';
    if (it.status === 'CLOSED') return 'closed';
    if (it.status === 'REFURBISHMENT') return 'refurb';
    if (it.status !== 'OPERATING') return 'unknown';
    if (it.wait == null) return 'open';
    if (it.wait <= 15) return 'low';
    if (it.wait <= 35) return 'mid';
    if (it.wait <= 60) return 'high';
    return 'max';
  }

  function waitBadge(it) {
    const cls = waitClass(it);
    const labels = { down: 'Down', closed: 'Closed', refurb: 'Refurb', unknown: '?', open: 'Open' };
    if (labels[cls]) return h('div', { class: 'wait ' + cls }, labels[cls]);
    return h('div', { class: 'wait ' + cls, 'aria-label': `${it.wait} minute wait` }, String(it.wait), h('small', null, 'MIN'));
  }

  function rank(it) {
    if (it.status === 'OPERATING') return it.wait == null ? 1 : 0;
    if (it.status === 'DOWN') return 2;
    return 3;
  }

  function viewNow() {
    const d = S.live[S.park];
    const frag = document.createDocumentFragment();
    if (S.liveErr[S.park]) {
      add(frag, h('p', { class: 'notice' + (d ? '' : ' err') },
        d ? `Couldn’t refresh (${S.liveErr[S.park]}). Showing data from ${ago(d.meta.fetchedAt)}.` : `Couldn’t load waits: ${S.liveErr[S.park]}`));
    } else if (d && d.meta.stale) {
      add(frag, h('p', { class: 'notice' }, `Live feeds are unreachable — showing waits from ${ago(d.meta.fetchedAt)}.`));
    }
    if (!d) {
      add(frag, h('p', { class: 'empty' }, S.loading[S.park] ? 'Loading waits…' : 'No data yet.'));
      return frag;
    }

    if (!S.q) {
      const rd = ropeDropBanner();
      if (rd) add(frag, rd);
      const nu = nextUpCard();
      if (nu) add(frag, nu);
      for (const a of S.weather?.alerts || []) {
        add(frag, h('p', { class: 'notice wx' }, a.text,
          a.kind === 'rain' && !S.rainMode ? h('button', { type: 'button', class: 'btn small', onclick: () => { S.rainMode = true; renderToolbar(); renderView(); } }, '☔ Rain plan') : null,
          a.kind === 'rain' || a.kind === 'storm' ? h('button', { type: 'button', class: 'btn small', onclick: () => goNearest('shelter') }, '☂️ Nearest shelter') : null));
      }
      if (S.rainMode) add(frag, h('p', { class: 'notice wx' }, '☔ Rain plan: indoor and covered rides only (from ride-info.php).'));
      if (d.crowd) add(frag, crowdCard(d.crowd, d.items));
    }

    const q = S.q.trim().toLowerCase();
    // Attractions with show times today live in the Shows tab instead (no queue to show here).
    let items = d.items.filter((it) => it.type === 'ATTRACTION' && !hasShowtimesToday(it));
    if (S.filter === 'open') items = items.filter((it) => it.status === 'OPERATING' || it.status === 'DOWN');
    if (S.filter === 'fav') items = items.filter((it) => it.fav);
    if (S.rainMode) items = items.filter((it) => it.info && it.info.where !== 'outdoor');
    if (q) items = items.filter((it) => it.name.toLowerCase().includes(q) || (it.land || '').toLowerCase().includes(q));

    const byName = (a, b) => a.name.localeCompare(b.name);
    const byWait = (a, b) => rank(a) - rank(b) || (a.wait ?? 0) - (b.wait ?? 0) || byName(a, b);

    if (items.length === 0) {
      const msg = S.filter === 'fav' ? 'No must-dos here yet. Open a ride and tap ★.'
        : S.filter === 'open' ? 'Nothing is open right now. Try “All”.' : 'No matching rides.';
      add(frag, h('p', { class: 'empty' }, msg));
    } else if (S.sort === 'land') {
      const groups = new Map();
      for (const it of items.sort(byWait)) {
        const k = it.land || 'Other';
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(it);
      }
      for (const [land, list] of [...groups].sort((a, b) => (a[0] === 'Other') - (b[0] === 'Other') || a[0].localeCompare(b[0]))) {
        add(frag, h('h2', { class: 'group-h' }, land), h('ul', { class: 'list' }, list.map(rideRow)));
      }
    } else {
      items.sort(S.sort === 'name' ? byName : byWait);
      add(frag, h('ul', { class: 'list' }, items.map(rideRow)));
    }

    add(frag, credits(d));
    return frag;
  }

  function crowdCard(c, items) {
    const down = items.filter((it) => it.type === 'ATTRACTION' && it.status === 'DOWN').length;
    const vs = c.usual != null && Math.abs(c.avg - c.usual) >= 5
      ? `${c.avg > c.usual ? 'busier' : 'quieter'} than usual (${c.usual})` : (c.usual != null ? 'about usual' : null);
    const trend = c.trend != null && Math.abs(c.trend) >= 5 ? (c.trend > 0 ? ' · rising ↑' : ' · easing ↓') : '';
    const pts = (c.series || []).map((p) => ({ t: p.t, w: p.avg }));
    return h('div', { class: 'card crowd' },
      h('div', { class: 'crowd-h' },
        h('div', null,
          h('div', { class: 'crowd-l' }, 'Crowd · ', h('b', null, c.label)),
          h('div', { class: 'ride-meta' }, h('span', null, `avg ${c.avg} min across ${c.rides} rides${trend}`),
            vs ? h('span', null, vs) : null,
            c.peak > c.avg ? h('span', null, `today’s peak ${c.peak}`) : null,
            down ? h('span', { class: 'up' }, `${down} down`) : null)),
        h('div', { class: 'meter', role: 'img', 'aria-label': `Crowd level ${c.level} of 5` },
          [1, 2, 3, 4, 5].map((i) => h('span', { class: i <= c.level ? 'on l' + c.level : '' })))),
      pts.length >= 2 ? sparkline(pts) : null);
  }

  function credits(d) {
    const qt = d?.meta.sources.includes('queue-times');
    return h('p', { class: 'foot' },
      'Data: ', h('a', { href: 'https://themeparks.wiki', target: '_blank', rel: 'noopener' }, 'ThemeParks.wiki'),
      ' · Lands', qt ? ' & some waits' : '', ': ',
      h('a', { href: 'https://queue-times.com/en-US', target: '_blank', rel: 'noopener' }, 'Powered by Queue-Times.com'));
  }

  function rideRow(it) {
    const open = S.expanded === it.id;
    const meta = [];
    if (it.land && S.sort !== 'land') meta.push(h('span', null, it.land));
    if (it.singleRider != null && it.status === 'OPERATING' && !(it.wait != null && it.wait - it.singleRider >= 15)) meta.push(h('span', null, `Single rider ${it.singleRider}`));
    meta.push(...hintChips(it));
    if (it.info?.where === 'indoor' && S.rainMode) meta.push(h('span', null, '🏠 indoor'));
    if (it.paid && it.paid.state === 'AVAILABLE') {
      meta.push(h('span', null, `PA ${it.paid.price || ''}${it.paid.returnStart ? ' · ' + time(it.paid.returnStart) : ''}`.trim()));
    }
    if (it.trend != null && Math.abs(it.trend) >= 10) {
      meta.push(h('span', { class: it.trend > 0 ? 'up' : 'down' }, `${it.trend > 0 ? '↑' : '↓'} ${Math.abs(it.trend)}`));
    }
    if (it.usually != null && it.wait != null && Math.abs(it.usually - it.wait) >= 10) meta.push(h('span', null, `usually ${it.usually}`));
    const since = it.since ? Math.round((Date.now() / 1000 - it.since) / 60) : null;
    if (it.status === 'DOWN' && since != null) meta.push(h('span', { class: 'up' }, `down since ${timeTs(it.since)} (${since} min)`));
    else if (it.status === 'OPERATING' && it.prevStatus === 'DOWN' && since != null && since <= 60) {
      meta.push(h('span', { class: 'down' }, `back up ${since <= 1 ? 'just now' : since + ' min ago'}`));
    }
    if (it.rides) meta.push(h('span', { class: 'done' }, `✓${it.rides > 1 ? '×' + it.rides : ''}`));
    if (S.alerts[it.id]) meta.push(h('span', { 'aria-label': 'Alert set' }, '🔔'));

    const li = h('li', { class: 'card ride' + (it.status === 'OPERATING' ? '' : ' closed'), id: 'r-' + it.id },
      h('button', {
        type: 'button', class: 'ride-main', 'aria-expanded': String(open),
        onclick: () => {
          S.expanded = open ? null : it.id;
          renderView();
          if (!open) loadHistory(it.id);
        },
      },
      h('div', { class: 'ride-info' },
        h('div', { class: 'ride-name' }, it.fav ? h('span', { class: 'star', 'aria-label': 'Must-do' }, '★') : null, it.name, newTag(it.id)),
        meta.length ? h('div', { class: 'ride-meta' }, meta) : null,
        S.laterMode ? laterLine(it) : null),
      waitBadge(it)),
      open ? rideDetail(it) : null);
    return li;
  }

  function rideDetail(it) {
    const facts = [];
    const statusText = { OPERATING: 'Operating', DOWN: 'Temporarily down', CLOSED: 'Closed', REFURBISHMENT: 'Refurbishment' };
    facts.push(h('div', null, `Status: ${statusText[it.status] || it.status}`));
    if (it.wait != null) facts.push(h('div', null, `Standby: ${it.wait} min`));
    if (it.singleRider != null) facts.push(h('div', null, `Single rider: ${it.singleRider} min`));
    if (it.paid) {
      const st = { AVAILABLE: 'available', FINISHED: 'sold out / finished', TEMP_FULL: 'temporarily full', NOT_STARTED: 'not on sale yet' };
      let s = `Premier Access ${it.paid.price || ''}: ${st[it.paid.state] || (it.paid.state || 'n/a').toLowerCase()}`;
      if (it.paid.returnStart) s += ` · return ${time(it.paid.returnStart)}${it.paid.returnEnd ? '–' + time(it.paid.returnEnd) : ''}`;
      facts.push(h('div', null, s));
    }
    const info = infoLine(it);
    if (info) facts.push(info);
    if (it.usually != null) facts.push(h('div', null, `Usually ~${it.usually} min at this hour (earlier days)`));
    const pred = predictionLine(it);
    if (pred) facts.push(pred);
    const wv = it.paid ? worthIt(it, S.park) : null;
    if (wv) facts.push(h('div', { class: 'worth-line' }, 'Premier Access: ', verdictBadge(wv), ' ', wv.reason));
    if (it.paTrend && it.paid?.state === 'AVAILABLE') {
      facts.push(h('div', null, `Premier Access return times moving +${it.paTrend.perHour} min per hour`
        + (it.paTrend.sellsOutAt ? ` — likely sold out around ${time(it.paTrend.sellsOutAt)}` : '')));
    }
    if (it.since) facts.push(h('div', null, `${statusText[it.status] || it.status} since ${timeTs(it.since)}`));
    if (it.downToday) {
      facts.push(h('div', null, `Breakdowns today: ${it.downToday.count} (${it.downToday.minutes} min in total)`));
    }
    if (it.lastUpdated) facts.push(h('div', null, `Reported ${time(it.lastUpdated)}${it.source === 'queue-times' ? ' via Queue-Times' : ''}`));

    return h('div', { class: 'ride-detail' },
      h('div', { class: 'facts' }, facts),
      sparkline(S.history[it.id]?.points),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn', onclick: () => setFav(it, S.park, !it.fav) }, it.fav ? '★' : '☆', h('span', { class: 'btn-l' }, ' Must-do')),
        h('button', { type: 'button', class: 'btn', onclick: () => openAlertSheet(it, S.park) }, S.alerts[it.id] ? '🔔' : '🔕', h('span', { class: 'btn-l' }, ' Alert')),
        it.location ? h('button', { type: 'button', class: 'btn', onclick: () => showOnMap(it.id), 'aria-label': 'Show on map' }, '📍') : null,
        queueButton(it, S.park),
        h('button', { type: 'button', class: 'btn primary', onclick: () => openLogSheet(it, S.park) }, 'I rode it')));
  }

  function sparkline(points) {
    const pts = (points || []).filter((p) => p.w != null);
    if (pts.length < 2) {
      return h('p', { class: 'spark-lbl' }, points ? 'Today’s wait trend appears after a couple of refreshes (snapshots every 5 min).' : 'Loading trend…');
    }
    const W = 300, H = 72, pad = 4;
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    const max = Math.max(15, ...pts.map((p) => p.w));
    const x = (t) => pad + ((t - t0) / Math.max(1, t1 - t0)) * (W - 2 * pad);
    const y = (w) => H - pad - (w / max) * (H - 2 * pad);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.w).toFixed(1)}`).join(' ');
    const el = svg('svg', { class: 'spark', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Wait time today' });
    el.append(
      svg('path', { class: 'ar', d: `${line} L${x(t1).toFixed(1)},${H} L${x(t0).toFixed(1)},${H} Z` }),
      svg('path', { class: 'ln', d: line }),
    );
    const peak = pts.reduce((a, b) => (b.w > a.w ? b : a));
    return h('div', null, el, h('div', { class: 'spark-lbl' },
      h('span', null, timeTs(t0)), h('span', null, `peak ${peak.w} min at ${timeTs(peak.t)}`), h('span', null, timeTs(t1))));
  }

  // ----------------------------------------------------------- log sheet

  /** @param timer the queue timer being stopped: its wait goes in, and it only ends once this saves */
  function openLogSheet(it, park, timer = null) {
    const dlg = $('#sheet');
    let wait = timer ? Math.min(600, queueMins(timer)) : it.wait != null ? Math.round(it.wait / 5) * 5 : 0;
    let qtype = 'STANDBY';
    const out = h('output', { 'aria-live': 'polite' }, String(wait));
    const postedNow = () => timer?.posted?.[qtype] ?? null;
    const signLine = timer ? h('p', { class: 'spark-lbl' }) : null;
    const drawSign = () => {
      if (!timer) return;
      const posted = postedNow();
      signLine.textContent = `⏱ Timed at ${queueMins(timer)} min${posted != null ? `. The sign said ${posted}.` : '.'}`;
    };
    const step = (n) => () => { wait = Math.max(0, Math.min(600, wait + n)); out.textContent = String(wait); };
    const typeBox = h('div', { class: 'qtypes' });
    const drawTypes = () => typeBox.replaceChildren(...QUEUE_TYPES.map(([k, label]) =>
      chip(label, qtype === k, () => { qtype = k; drawTypes(); drawSign(); })));
    drawTypes();
    drawSign();

    const now = new Date();
    const hhmm = fmt({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
    const when = h('input', { type: 'time', value: hhmm, 'aria-label': 'Time ridden' });
    const note = h('textarea', { rows: '2', maxlength: '480', placeholder: 'Optional — got wet, best ride ever…' });
    const frontRow = h('input', { type: 'checkbox' });

    const form = h('form', {
      method: 'dialog',
      onsubmit: async (e) => {
        e.preventDefault();
        const btn = form.querySelector('button[type=submit]');
        btn.disabled = true;
        try {
          const riddenAt = when.value && when.value !== hhmm ? `${today()}T${when.value}:00` : null;
          S.me = await api('log', {
            method: 'POST',
            body: { id: it.id, park, name: it.name, wait, posted: postedNow(), queueType: qtype, note: [frontRow.checked ? 'Front row' : null, note.value.trim()].filter(Boolean).join(' · '), riddenAt },
          });
          store.set('me', S.me);
          it.rides = (it.rides || 0) + 1;
          if (timer) setQueue(null);
          closeSheet();
          toast(`Logged ${it.name}`);
          renderView();
        } catch (err) {
          btn.disabled = false;
          toast(err.message);
        }
      },
    },
    h('h2', null, it.name),
    signLine,
    h('label', null, 'How long did you actually queue? (min)',
      h('div', { class: 'stepper' },
        h('button', { type: 'button', onclick: step(-5), 'aria-label': 'Minus 5 minutes' }, '−5'),
        out,
        h('button', { type: 'button', onclick: step(5), 'aria-label': 'Plus 5 minutes' }, '+5'))),
    h('label', null, 'Queue', typeBox),
    h('label', null, 'Time', when),
    h('label', { class: 'check-row' }, frontRow, ' Front row'),
    h('label', null, 'Note', note),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn', onclick: closeSheet }, 'Cancel'),
      h('button', { type: 'submit', class: 'btn primary' }, 'Save')));

    dlg.replaceChildren(form);
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
  }

  /** "I watched it": which trip day and roughly when. The trip may be over, so past days are offered. */
  function openWatchedSheet(s, park) {
    // Today's latest performance so far, else the first one: schedules barely change day to day.
    const now = Date.now();
    const started = (s.times || []).filter((x) => Date.parse(x) <= now);
    const guess = started[started.length - 1] || s.times?.[0];
    openDaySheet({
      title: s.name,
      at: guess ? new Date(guess) : new Date(),
      timeLabel: 'Time watched',
      placeholder: 'Optional — the finale was unreal…',
      send: (when, note) => api('watched', { method: 'POST', body: { id: s.id, park, name: s.name, note, watchedAt: when } }),
    });
  }

  const PLACE_LOG = {
    food: { label: 'I ate here', done: 'Ate here', timeLabel: 'Time you ate', placeholder: 'Optional — the churros were worth it…' },
    shop: { label: 'I shopped here', done: 'Shopped here', timeLabel: 'Time you shopped', placeholder: 'Optional — what did you buy?' },
    browse: { label: 'I perused here', done: 'Perused here', timeLabel: 'Time you perused', placeholder: 'Optional — what caught your eye?', noAmount: true, quiet: true },
  };

  function placeLogButton(it, park, kind) {
    const c = PLACE_LOG[kind];
    const n = (S.me?.places || []).filter((p) => p.kind === kind && p.entityId === it.id && p.mine).length;
    return h('button', {
      type: 'button',
      class: c.quiet ? 'btn' : 'btn primary',
      onclick: () => {
        const amount = c.noAmount ? null : amountInput('Amount in euros');
        openDaySheet({
          title: it.name,
          at: new Date(),
          timeLabel: c.timeLabel,
          placeholder: c.placeholder,
          extras: amount ? [h('label', null, 'Amount spent (€, optional)', amount)] : [],
          send: (when, note) => api('places', { method: 'POST', body: { kind, id: it.id, park, name: it.name, note, amount: amount?.value || null, visitedAt: when } }),
        });
      },
    }, n ? `✓ ${c.done}${n > 1 ? ` ×${n}` : ''} · again` : c.label);
  }

  /** Log something with a trip day, time and note. The trip may be over, so past days are offered. */
  function openDaySheet({ title, at, timeLabel, placeholder, send, top = null, extras = [], saved = null }) {
    const dlg = $('#sheet');
    const t = today();
    const days = tripDates().filter((d) => d <= t);
    if (!days.length) days.push(t);
    let day = days.includes(t) ? t : days[days.length - 1];
    const dayBox = h('div', { class: 'qtypes' });
    const drawDays = () => dayBox.replaceChildren(...days.map((d) => chip(dayLabel(d), d === day, () => { day = d; drawDays(); })));
    drawDays();

    const clock = fmt({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
    const when = h('input', { type: 'time', value: clock, required: true, 'aria-label': timeLabel });
    const note = h('textarea', { rows: '2', maxlength: '500', placeholder });

    const form = h('form', {
      method: 'dialog',
      onsubmit: async (e) => {
        e.preventDefault();
        const btn = form.querySelector('button[type=submit]');
        btn.disabled = true;
        try {
          S.me = await send(`${day}T${when.value}:00`, note.value.trim());
          store.set('me', S.me);
          const done = saved ? saved() : `Logged ${title}`;
          closeSheet();
          toast(done);
          renderView();
        } catch (err) {
          btn.disabled = false;
          toast(err.message);
        }
      },
    },
    h('h2', null, title),
    top,
    extras,
    h('label', null, 'Day', dayBox),
    h('label', null, 'Time', when),
    h('label', null, 'Note', note),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn', onclick: closeSheet }, 'Cancel'),
      h('button', { type: 'submit', class: 'btn primary' }, 'Save')));

    dlg.replaceChildren(form);
    if (typeof dlg.showModal === 'function' && !dlg.open) dlg.showModal();
    else dlg.setAttribute('open', '');
  }

  function openWeatherSheet() {
    const w = S.weather;
    if (!w) return;
    const dlg = $('#sheet');
    const c = w.current;
    const tripDays = Object.values(w.daily || {}).filter((d) => d.date >= S.boot.trip.start && d.date <= S.boot.trip.end);
    dlg.replaceChildren(h('form', { method: 'dialog', onsubmit: (e) => { e.preventDefault(); closeSheet(); } },
      h('h2', null, `${c.icon} ${c.temp}° · ${c.label}`),
      h('p', { class: 'spark-lbl' }, `Feels like ${c.feels ?? c.temp}° · wind ${c.wind} km/h, gusts ${c.gusts} km/h`),
      (w.alerts || []).map((a) => h('p', { class: 'notice' }, a.text)),
      h('div', { class: 'hourly' }, (w.hourly || []).slice(0, 14).map((x) => h('div', { class: 'hr' },
        h('small', null, x.time.slice(11, 16)), h('span', { class: 'hr-i' }, x.icon), h('b', null, `${x.temp}°`),
        h('small', { class: (x.pop ?? 0) >= 50 ? 'wet' : '' }, x.pop != null ? `${x.pop}%` : '')))),
      tripDays.length ? h('div', null, h('div', { class: 'group-h' }, 'Trip days'),
        tripDays.map((d) => h('div', { class: 'day-park' }, h('span', null, dayLabel(d.date)), h('span', { class: 'hrs' }, dayWeather(d))))) : null,
      h('p', { class: 'foot' }, 'Forecast: ', h('a', { href: 'https://open-meteo.com', target: '_blank', rel: 'noopener' }, 'Open-Meteo.com'), ` · updated ${ago(w.fetchedAt)}`),
      h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'btn primary' }, 'Close'))));
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  }

  function dayWeather(d) {
    const bits = [`${d.icon} ${d.max}°/${d.min}°`];
    if (d.pop != null) bits.push(`💧${d.pop}%`);
    if (d.gusts >= 45) bits.push(`💨${d.gusts}`);
    if (d.sunset) bits.push(`🌇${d.sunset.slice(11, 16)}`);
    return bits.join(' · ');
  }

  function closeSheet() {
    stopTicketMedia();
    const dlg = $('#sheet');
    if (typeof dlg.close === 'function' && dlg.open) dlg.close();
    else dlg.removeAttribute('open');
  }

  // ------------------------------------------------------------ shows tab

  function groupShows(list) {
    const map = new Map();
    for (const s of list) {
      const key = s.park + '|' + s.name;
      if (!map.has(key)) map.set(key, { park: s.park, name: s.name, id: s.id, times: [] });
      map.get(key).times.push(s.start);
    }
    return [...map.values()];
  }

  function timeChips(times, highlightNext) {
    const now = Date.now();
    const nextIdx = highlightNext ? times.findIndex((t) => Date.parse(t) > now) : -1;
    return h('div', { class: 'times' }, times.map((t, i) => h('span', {
      class: 'time' + (highlightNext && Date.parse(t) <= now ? ' past' : '') + (i === nextIdx ? ' next' : ''),
    }, time(t))));
  }

  S.catalog = store.get('catalog', null);
  const newTag = (id) => (S.catalog?.new?.some((n) => n.id === id) ? h('span', { class: 'badge new' }, 'NEW') : null);
  const completedShow = (id) => S.catalog?.completed?.find((c) => c.id === id) || null;
  const completedTag = (id) => (completedShow(id) ? h('span', { class: 'badge finished' }, 'COMPLETED') : null);
  const showOnToday = (it) => (it.showtimes || []).some((st) => parkDate(new Date(st.start)) === today());

  async function loadCatalog() {
    try {
      S.catalog = await api('catalog');
      store.set('catalog', S.catalog);
      if (['shows', 'trip', 'mine', 'now'].includes(S.tab)) renderView();
    } catch { /* keep cached */ }
  }

  /** An attraction that runs as timed performances today (PhilharMagic-style). */
  function hasShowtimesToday(it) {
    if (it.type !== 'ATTRACTION' || !(it.showtimes || []).length) return false;
    const t = today();
    return it.showtimes.some((st) => parkDate(new Date(st.start)) === t);
  }

  function viewShows() {
    const d = S.live[S.park];
    const frag = document.createDocumentFragment();
    if (!d) {
      add(frag, h('p', { class: 'empty' }, S.loading[S.park] ? 'Loading shows…' : (S.liveErr[S.park] || 'No data yet.')));
      return frag;
    }
    const t = today();
    const shows = [];
    for (const it of d.items) {
      // Shows, plus attractions that run as timed performances (e.g. Mickey's PhilharMagic).
      if (!(it.type === 'SHOW' || hasShowtimesToday(it)) || (S.hideReserved && it.reserved)) continue;
      const times = it.showtimes.map((s) => s.start).filter((s) => parkDate(new Date(s)) === t).sort();
      if (times.length) shows.push({ ...it, times });
    }
    const now = Date.now();
    const upcoming = shows.filter((s) => s.times.some((x) => Date.parse(x) > now))
      .sort((a, b) => Date.parse(a.times.find((x) => Date.parse(x) > now)) - Date.parse(b.times.find((x) => Date.parse(x) > now)));
    const done = shows.filter((s) => !s.times.some((x) => Date.parse(x) > now));
    const watchedBox = (s) => {
      const n = (S.me?.shows || []).filter((w) => w.entityId === s.id && w.mine).length;
      return h('div', { class: 'actions' },
        s.location && Date.parse(s.times[s.times.length - 1]) > now ? leaveButton(s, s.times.find((x) => Date.parse(x) > now)) : null,
        isMeet(s.name) ? h('button', { type: 'button', class: 'btn small primary', onclick: () => openCharacterSheet(guessCharacter(s.name)) }, '🤝 I met or saw them') : null,
        h('button', { type: 'button', class: 'btn small primary', onclick: () => openWatchedSheet(s, S.park) }, n ? `✓ Watched${n > 1 ? ` ×${n}` : ''} · again` : 'I watched it'));
    };

    const pend = Object.values(S.leave).filter((a) => a.start > Date.now());
    if (pend.length) {
      add(frag, h('p', { class: 'notice' }, '🚶 Leave alerts: ', pend.map((a) => `${a.name} ${hhmm(a.start)}${a.done ? ' (sent)' : ''}`).join(' · ')));
    }
    if (upcoming.length) {
      add(frag, h('p', { class: 'spark-lbl' }, S.push
        ? '★ a show to get a notification 15 min before it starts.'
        : '★ a show to add it to your plan — turn on notifications (Mine) for a reminder before it starts.'));
    }
    if (!upcoming.length && (!S.showAll || !done.length)) {
      add(frag, h('p', { class: 'empty' }, shows.length ? 'All shows have finished for today.' : 'No show times published for today.'));
    }
    if (upcoming.length) {
      add(frag, h('ul', { class: 'list' }, upcoming.map((s) => {
        const next = s.times.find((x) => Date.parse(x) > now);
        return h('li', { class: 'card show' },
          h('div', { class: 'show-h' },
            h('button', { type: 'button', class: 'star-btn', 'aria-label': s.fav ? 'Remove from must-do' : 'Star for a reminder', onclick: () => setFav(s, S.park, !s.fav) }, s.fav ? '★' : '☆'),
            h('span', { class: 'show-name' }, s.name, newTag(s.id)),
            h('span', { class: 'show-next' }, `${time(next)} · ${inLabel(minsUntil(next))}`)),
          timeChips(s.times, true),
          watchedBox(s));
      })));
    }
    if (S.showAll && done.length) {
      add(frag, h('h2', { class: 'group-h' }, 'Finished for today'),
        h('ul', { class: 'list' }, done.map((s) => h('li', { class: 'card show' },
          h('div', { class: 'show-name' }, s.name), timeChips(s.times, true), watchedBox(s)))));
    }
    const ended = (S.catalog?.completed || []).filter((c) => c.park === S.park);
    if (ended.length) {
      add(frag, h('details', { class: 'completed-shows' },
        h('summary', null, `Completed shows (${ended.length})`),
        h('ul', { class: 'list' }, ended.map((c) => h('li', { class: 'card log-item' },
          h('span', { class: 'what' }, c.name, h('small', null, `Last ran ${dayLabelY(c.lastDay)}`)),
          completedTag(c.id))))));
    }
    return frag;
  }

  // ------------------------------------------------------------- food tab

  const SOURCE_LABEL = {
    live: 'Disney (live)', schedule: 'Disney schedule', osm: 'OpenStreetMap', park: '≈ park hours', manual: 'your list', web: 'web',
  };

  /** Park whose restaurant schedule applies to this item (null for Village/hotels). */
  const schedPark = (it) => (it.type === 'RESTAURANT' ? Object.keys(S.live).find((k) => S.live[k]?.items?.some((x) => x.id === it.id)) : null);

  /** Today's opening periods + where they came from: live feed, Disney schedule, OSM or park hours. */
  function hoursOf(it) {
    if (it.hours && it.hours.length) return { segs: it.hours, source: it.hoursSource || 'live' };
    const park = schedPark(it);
    const segs = park ? S.foodSched[park]?.schedules?.[it.id]?.[today()] : null;
    if (segs && segs.length) return { segs, source: 'schedule' };
    return { segs: [], source: null };
  }

  /** Opening periods per trip day (Disney schedule for park restaurants, OSM for Village/hotels). */
  function tripHoursOf(it) {
    if (it.tripHours && Object.keys(it.tripHours).length) return it.tripHours;
    const park = schedPark(it);
    const all = park ? S.foodSched[park]?.schedules?.[it.id] : null;
    if (!all) return null;
    const out = {};
    for (const [d, segs] of Object.entries(all)) if (d >= S.boot.trip.start && d <= S.boot.trip.end) out[d] = segs;
    return Object.keys(out).length ? out : null;
  }

  /** What to say about a restaurant/shop right now. rank: 0 open, 1 opens later, 2 closed, 3 unknown, 4 refurb */
  function foodState(it) {
    const now = Date.now();
    const { segs, source } = hoursOf(it);
    const t = today();
    const valid = segs.filter((x) => x.start && x.end && x.type !== 'INFO');
    const cur = valid.find((x) => Date.parse(x.start) <= now && now < Date.parse(x.end));
    const next = valid.filter((x) => Date.parse(x.start) > now && parkDate(new Date(x.start)) === t)
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
    const last = valid.filter((x) => parkDate(new Date(x.start)) === t).pop();
    const approx = source === 'park' ? '≈ ' : '';

    if (it.status === 'REFURBISHMENT') return { rank: 4, cls: 'refurb', badge: 'Refurb', text: 'Closed for refurbishment' };
    if (it.closedNote) return { rank: 4, cls: 'refurb', badge: 'Closed', text: it.closedNote };
    const liveOpen = it.type === 'RESTAURANT' && it.status === 'OPERATING';
    if (cur || liveOpen) {
      if (cur) {
        const left = Math.round((Date.parse(cur.end) - now) / 60000);
        return { rank: 0, cls: 'open', badge: 'Open', text: `${approx}${left <= 45 ? 'Closes soon · ' : 'Open until '}${time(cur.end)}` };
      }
      return { rank: 0, cls: 'open', badge: 'Open', text: 'Open now' };
    }
    if (next) return { rank: 1, cls: 'later', badge: time(next.start), text: `${approx}Opens ${time(next.start)}–${time(next.end)}` };
    if ((it.type === 'RESTAURANT' && it.status === 'CLOSED') || last || valid.length) {
      return { rank: 2, cls: 'closed', badge: 'Closed', text: last ? `Closed · was ${time(last.start)}–${time(last.end)}` : 'Closed today' };
    }
    if (it.hoursText) return { rank: 3, cls: 'unknown', badge: '–', text: `Hours: ${it.hoursText}` };
    return { rank: 3, cls: 'unknown', badge: '–', text: it.type === 'RESTAURANT' ? 'No hours today' : 'Hours unknown' };
  }

  const DIETS = { vegetarian: '🥕 Veg', vegan: '🌱 Vegan', gluten_free: '🌾 Gluten-free', lactose_free: '🥛 Lactose-free', halal: '☪️ Halal', kosher: '✡️ Kosher' };
  const DIET_CYCLE = [null, 'vegetarian', 'vegan', 'gluten_free', 'halal'];

  /** Diet tags from OpenStreetMap for a restaurant (exact OSM id, else name match nearby). */
  function dietFor(it) {
    const list = S.ess?.diets;
    if (!list?.length) return null;
    let hit = list.find((d) => d.osmId === it.id);
    if (!hit) {
      hit = list.find((d) => d.name && (looseMatch(d.name, it.name)
        || (it.location && PPMap.metres(d, it.location) < 120 && normName(d.name).split(' ')[0].length >= 5
          && normName(d.name).split(' ')[0] === normName(it.name).split(' ')[0])));
    }
    return hit ? hit.diet : null;
  }
  const dietBadges = (diet) => Object.entries(diet || {}).filter(([k, v]) => DIETS[k] && v !== 'no')
    .map(([k, v]) => h('span', { class: 'diet' }, DIETS[k] + (v === 'limited' ? ' (limited)' : v === 'only' ? ' only' : '')));

  function mapUrl(it) {
    const q = it.location ? `${it.location.lat},${it.location.lng}` : `${it.name}, Disney Village, Chessy`;
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
  }

  async function loadFoodSched(park) {
    const cur = S.foodSched[park];
    if (cur && cur.today === today() && Date.now() - (cur._at || 0) < 3 * 3600 * 1000) return;
    if (S.loading['sched:' + park]) return;
    S.loading['sched:' + park] = true;
    try {
      const d = await api('food-schedule/' + park);
      d._at = Date.now();
      S.foodSched[park] = d;
      store.set('foodSched', S.foodSched);
      if (S.tab === 'food' || S.tab === 'map') renderView();
    } catch { /* optional */ }
    S.loading['sched:' + park] = false;
  }

  const VILLAGE_ORDER = ['Restaurants', 'Quick bites', 'Bars', 'Entertainment'];

  function viewFood() {
    const frag = document.createDocumentFragment();
    const village = S.foodArea === 'village';
    let items;
    if (village) {
      if (!S.village) {
        add(frag, h('p', { class: 'empty' }, 'Loading Disney Village…'));
        return frag;
      }
      items = S.village.items.filter((it) => it.section !== 'Shops').map((it) => ({ ...it, land: it.section }));
      if (S.village.error && S.village.fetchedAt == null) {
        add(frag, h('p', { class: 'notice' }, `OpenStreetMap is unreachable, so only the hand-made list is shown (${S.village.error}).`));
      }
    } else {
      const park = S.foodArea;
      loadFoodSched(park);
      const d = S.live[park];
      if (S.liveErr[park]) add(frag, h('p', { class: 'notice' + (d ? '' : ' err') }, `Couldn’t refresh: ${S.liveErr[park]}`));
      if (!d) {
        add(frag, h('p', { class: 'empty' }, S.loading[park] ? 'Loading restaurants…' : 'No data yet.'));
        return frag;
      }
      items = d.items.filter((it) => it.type === 'RESTAURANT');
    }

    const q = S.q.trim().toLowerCase();
    let list = items.map((it) => ({ it, st: foodState(it) }));
    if (S.foodFilter === 'open') list = list.filter((x) => x.st.rank <= 1 || (village && x.st.rank === 3));
    if (S.foodFilter === 'fav') list = list.filter((x) => x.it.fav);
    if (S.dietFilter) {
      list = list.filter(({ it }) => { const d = dietFor(it); return d && d[S.dietFilter] && d[S.dietFilter] !== 'no'; });
      add(frag, h('p', { class: 'notice' }, `Showing places tagged ${DIETS[S.dietFilter]} in OpenStreetMap — coverage is partial, so others may still cater for you. Always check allergens with staff.`));
    }
    if (q) {
      list = list.filter(({ it }) => [it.name, it.land, it.kind, it.about].some((v) => (v || '').toLowerCase().includes(q)));
    }

    const byName = (a, b) => a.it.name.localeCompare(b.it.name);
    const byStatus = (a, b) => a.st.rank - b.st.rank || byName(a, b);

    if (!list.length) {
      add(frag, h('p', { class: 'empty' },
        S.foodFilter === 'fav' ? 'No food on your must-do list here yet.'
          : S.foodFilter === 'open' ? 'Nothing open right now. Try “All”.' : 'No matches.'));
    } else if (S.foodSort === 'land' || village) {
      const groups = new Map();
      for (const x of list.sort(village && S.foodSort === 'name' ? byName : byStatus)) {
        const k = x.it.land || 'Other';
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(x);
      }
      const keys = [...groups.keys()];
      if (village) {
        const rank = (k) => (VILLAGE_ORDER.includes(k) ? VILLAGE_ORDER.indexOf(k) : k.startsWith('🏨') ? 100 : 50);
        keys.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
      } else {
        keys.sort((a, b) => (a === 'Other') - (b === 'Other') || a.localeCompare(b));
      }
      for (const k of keys) add(frag, h('h2', { class: 'group-h' }, k), h('ul', { class: 'list' }, groups.get(k).map(foodRow)));
    } else {
      list.sort(S.foodSort === 'name' ? byName : byStatus);
      add(frag, h('ul', { class: 'list' }, list.map(foodRow)));
    }

    add(frag, village
      ? h('p', { class: 'foot' }, 'Hours & extra venues: ',
        h('a', { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener' }, '© OpenStreetMap contributors'),
        ' · descriptions: disney-village.php · always double-check in the official app')
      : h('p', { class: 'foot' }, 'Status & hours: ',
        h('a', { href: 'https://themeparks.wiki', target: '_blank', rel: 'noopener' }, 'ThemeParks.wiki'),
        ' (live feed + Disney schedules) · areas estimated from nearby rides'));
    return frag;
  }

  /** "Hours" block for the expanded card: today + each trip day, with the source. */
  function hoursFacts(it) {
    const out = [];
    const { segs, source } = hoursOf(it);
    const fmtSegs = (list) => list.filter((x) => x.start && x.end && x.type !== 'INFO')
      .map((x) => `${time(x.start)}–${time(x.end)}`).join(', ');
    if (it.closedNote) out.push(h('div', null, `Closed: ${it.closedNote}`));
    else if (segs.length) out.push(h('div', null, `Today: ${fmtSegs(segs)}`, h('small', { class: 'src' }, ` · ${SOURCE_LABEL[source] || source}`)));
    else if (it.hoursText) out.push(h('div', null, `Hours: ${it.hoursText}`));
    else out.push(h('div', null, 'No opening hours found in any source — check the official app.'));
    if (it.note && !it.closedNote) out.push(h('div', null, it.note));
    if (it.hoursInfo) {
      const i = it.hoursInfo;
      out.push(h('div', { class: 'src' },
        i.weak ? '⚠ ' : '', 'Hours from ',
        i.url ? h('a', { href: i.url, target: '_blank', rel: 'noopener' }, i.source) : i.source,
        i.checked ? `, checked ${dayLabel(i.checked)}` : '',
        i.weak ? ' — fan guide/listing only, double-check' : ''));
    }
    const trip = it.closedNote ? null : tripHoursOf(it);
    if (trip) {
      out.push(h('div', { class: 'trip-hours' }, Object.entries(trip).sort().map(([d, list]) =>
        h('span', null, h('b', null, dayLabel(d)), ' ', fmtSegs(list) || 'closed'))));
    }
    return out;
  }

  function foodRow({ it, st }) {
    const open = S.expanded === it.id;
    const area = S.foodArea;
    const meta = [];
    if (it.kind) meta.push(h('span', null, it.kind));
    if (it.land && S.foodSort !== 'land' && it.type !== 'VILLAGE') meta.push(h('span', null, it.land));
    meta.push(h('span', { class: st.rank === 0 ? 'down' : '' }, st.text));
    if (it.book) meta.push(h('span', null, 'Book ahead'));
    meta.push(...dietBadges(dietFor(it)));
    const rb = ratingBadge(it.id);
    if (rb) meta.unshift(rb);

    return h('li', { class: 'card ride' + (st.rank >= 2 ? ' closed' : ''), id: 'r-' + it.id },
      h('button', {
        type: 'button', class: 'ride-main', 'aria-expanded': String(open),
        onclick: () => { S.expanded = open ? null : it.id; renderView(); },
      },
      h('div', { class: 'ride-info' },
        h('div', { class: 'ride-name' }, it.fav ? h('span', { class: 'star', 'aria-label': 'Must-do' }, '★') : null, it.name, newTag(it.id)),
        h('div', { class: 'ride-meta' }, meta)),
      h('div', { class: 'fstate ' + st.cls }, st.badge)),
      open ? h('div', { class: 'ride-detail' },
        h('div', { class: 'facts' },
          it.about ? h('div', null, it.about) : null,
          hoursFacts(it),
          dietFor(it) ? h('div', null, 'Diet options: ', dietBadges(dietFor(it)), h('small', { class: 'src' }, ' · OpenStreetMap, partial — always check allergens with staff')) : null,
          it.book ? h('div', null, 'Reservations recommended (Disneyland Paris app or website).') : null),
        ratingBlock(it, area),
        h('div', { class: 'actions' },
          placeLogButton(it, area, 'food'),
          h('button', { type: 'button', class: 'btn', onclick: () => setFav(it, area, !it.fav) }, it.fav ? '★ Must-do' : '☆ Must-do'),
          menuButton(it),
          it.location ? h('button', { type: 'button', class: 'btn', onclick: () => showOnMap(it.id) }, '📍 Map')
            : h('a', { class: 'btn', href: mapUrl(it), target: '_blank', rel: 'noopener' }, 'Map'))) : null);
  }

  // ------------------------------------------------------------ shops

  const normName = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

  /** Land of the nearest ride (from live data) — same trick the server uses for restaurants. */
  function landFor(loc, park) {
    let best = null;
    let bestD = 200;
    for (const it of S.live[park]?.items || []) {
      if (it.type !== 'ATTRACTION' || !it.land || !it.location) continue;
      const d = PPMap.metres(loc, it.location);
      if (d < bestD) { bestD = d; best = it.land; }
    }
    return best;
  }

  function viewShops() {
    const frag = document.createDocumentFragment();
    const area = S.foodArea;
    if (!S.shops) {
      add(frag, h('p', { class: 'empty' }, 'Loading shops…'));
      return frag;
    }
    if (S.shops.error) {
      add(frag, h('p', { class: 'notice' }, S.shops.items.length
        ? `Showing shops saved ${ago(S.shops.fetchedAt)} (OpenStreetMap is busy right now).`
        : `Couldn’t load shops from OpenStreetMap: ${S.shops.error}`));
    }
    let items = S.shops.items.filter((it) => it.area === area)
      .map((it) => ({ ...it, land: area === 'village' ? null : landFor(it.location, area) }));
    if (area === 'village' && S.village) {
      // Hand-maintained Village shops that OSM doesn't have yet.
      const known = new Set(items.map((it) => normName(it.name)));
      for (const v of S.village.items) {
        if (v.section === 'Shops' && !known.has(normName(v.name))) items.push({ ...v, type: 'SHOP' });
      }
    }
    const q = S.q.trim().toLowerCase();
    if (S.foodFilter === 'fav') items = items.filter((it) => it.fav);
    if (q) items = items.filter((it) => [it.name, it.kind, it.near, it.land].some((v) => (v || '').toLowerCase().includes(q)));

    if (!items.length) {
      add(frag, h('p', { class: 'empty' }, S.foodFilter === 'fav' ? 'No shops on your must-do list here yet.' : 'No shops found.'));
    } else {
      const groups = new Map();
      for (const it of items.sort((a, b) => a.name.localeCompare(b.name))) {
        const k = it.land || (area === 'village' ? 'Disney Village' : 'Other');
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(it);
      }
      const keys = [...groups.keys()].sort((a, b) => (a === 'Other') - (b === 'Other') || a.localeCompare(b));
      for (const k of keys) add(frag, h('h2', { class: 'group-h' }, k), h('ul', { class: 'list' }, groups.get(k).map(shopRow)));
    }
    add(frag, h('p', { class: 'foot' }, 'Shops: ',
      h('a', { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener' }, '© OpenStreetMap contributors'),
      ' · usually open park hours'));
    return frag;
  }

  function shopRow(it) {
    const open = S.expanded === it.id;
    const st = foodState(it);
    const meta = [h('span', null, it.kind || 'Shop')];
    if (it.near) meta.push(h('span', null, `near ${it.near}`));
    if (st.rank !== 3 || it.hoursText) meta.push(h('span', { class: st.rank === 0 ? 'down' : '' }, st.text));
    return h('li', { class: 'card ride', id: 'r-' + it.id },
      h('button', {
        type: 'button', class: 'ride-main', 'aria-expanded': String(open),
        onclick: () => { S.expanded = open ? null : it.id; renderView(); },
      },
      h('div', { class: 'ride-info' },
        h('div', { class: 'ride-name' }, it.fav ? h('span', { class: 'star', 'aria-label': 'Must-do' }, '★') : null, it.name, newTag(it.id)),
        h('div', { class: 'ride-meta' }, meta)),
      h('div', { class: 'fstate ' + (st.rank === 3 ? 'shop' : st.cls) }, st.rank === 3 ? '🛍' : st.badge)),
      open ? h('div', { class: 'ride-detail' },
        h('div', { class: 'facts' },
          it.about ? h('div', null, it.about) : null,
          hoursFacts(it),
          hoursOf(it).source === 'park' ? h('div', null, 'No hours on OpenStreetMap — Disney shops usually follow park hours.') : null,
          it.near ? h('div', null, `Near ${it.near}`) : null),
        h('div', { class: 'actions' },
          placeLogButton(it, S.foodArea, 'shop'),
          placeLogButton(it, S.foodArea, 'browse'),
          h('button', { type: 'button', class: 'btn', onclick: () => setFav(it, S.foodArea, !it.fav) }, it.fav ? '★ Must-do' : '☆ Must-do'),
          it.location ? h('button', { type: 'button', class: 'btn', onclick: () => showOnMap(it.id) }, '📍 Map') : null)) : null);
  }

  // -------------------------------------------------------------- map tab

  const RESORT = { lat: 48.8705, lng: 2.7795 };
  let map = null;
  let mapBox = null;
  let geoWatch = null;
  let followMe = false;

  function placeStatus(p) {
    const it = p.it;
    if (p.kind === 'ess') return [ESS[it.type].label, it.baby ? 'baby changing' : null, it.wheelchair ? 'wheelchair' : null, it.fee ? 'fee' : null].filter(Boolean).join(' · ');
    if (p.kind === 'person') return `seen ${ago(it.ts)}`;
    if (p.kind === 'meet') return `meet-up pin${it.by ? ' by ' + it.by : ''} · ${ago(it.ts)}`;
    if (p.kind === 'ride') {
      if (it.status === 'OPERATING') return it.wait != null ? `${it.wait} min wait` : 'Open';
      return { DOWN: 'Temporarily down', CLOSED: 'Closed', REFURBISHMENT: 'Refurbishment' }[it.status] || it.status;
    }
    if (p.kind === 'show') {
      const next = (it.showtimes || []).map((x) => x.start).filter((x) => Date.parse(x) > Date.now()).sort()[0];
      return next ? `Next ${time(next)} (${inLabel(minsUntil(next))})` : 'No more shows today';
    }
    if (p.kind === 'food') return foodState(it).text;
    const st = foodState(it);
    return [it.kind, st.rank !== 3 ? st.text : null, it.near ? `near ${it.near}` : null].filter(Boolean).join(' · ');
  }

  function mapPlaces() {
    const out = [];
    for (const [park, d] of Object.entries(S.live)) {
      for (const it of d?.items || []) {
        if (!it.location || it.reserved || (it.type === 'SHOW' && !showOnToday(it))) continue;
        const kind = it.type === 'ATTRACTION' ? 'ride' : it.type === 'SHOW' ? 'show' : 'food';
        out.push({ id: it.id, it, park, kind, lat: it.location.lat, lng: it.location.lng });
      }
    }
    for (const it of S.shops?.items || []) {
      out.push({ id: it.id, it, park: it.area, kind: 'shop', lat: it.location.lat, lng: it.location.lng });
    }
    for (const it of S.village?.items || []) {
      if (!it.location || it.section === 'Shops') continue;
      out.push({ id: it.id, it, park: 'village', kind: 'food', lat: it.location.lat, lng: it.location.lng });
    }
    for (const e of S.ess?.items || []) {
      if (!ESS[e.type] || !S.mapKinds[ESS[e.type].cat]) continue;
      out.push({ id: e.id, it: { ...e, name: essLabel(e) }, park: null, kind: 'ess', lat: e.lat, lng: e.lng });
    }
    return out.filter((p) => p.kind === 'ess' || S.mapKinds[p.kind]).concat(partyPlaces());
  }

  function markerFor(p) {
    const it = p.it;
    if (p.kind === 'ride') {
      const cls = waitClass(it);
      const label = it.status === 'OPERATING' ? (it.wait != null ? String(it.wait) : '✓') : it.status === 'DOWN' ? '!' : '·';
      return { label, cls: 'mk-ride w-' + cls };
    }
    if (p.kind === 'ess') return { label: ESS[it.type].icon, cls: 'mk-ess mk-' + it.type };
    if (p.kind === 'person') return { label: (it.name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase(), cls: 'mk-person' };
    if (p.kind === 'meet') return { label: '📌', cls: 'mk-meet' };
    if (p.kind === 'show') return { label: '✨', cls: 'mk-show' };
    if (p.kind === 'food') return { label: '🍴', cls: 'mk-food' + (foodState(it).rank === 0 ? '' : ' mk-off') };
    return { label: '🛍', cls: 'mk-shop' };
  }

  const atResort = () => S.geo && PPMap.metres(S.geo, RESORT) < 3000;
  const walk = (m) => `${m < 1000 ? Math.round(m / 10) * 10 + ' m' : (m / 1000).toFixed(1) + ' km'} · ${Math.max(1, Math.round((m * 1.3) / 75))} min walk`;

  const MAP_LAYERS = [['ride', '🎢 Rides'], ['show', '✨ Shows'], ['food', '🍴 Food'], ['shop', '🛍 Shops'], ['ess', '🚻 Essentials'],
    ['rain', '☂️ Shelter'], ['seat', '🪑 Seats'], ['smoke', '🚬 Smoking'], ['view', '📸 Views']];

  /** Sheet with every map layer toggle (keeps the toolbar short). */
  function openLayersSheet() {
    const dlg = $('#sheet');
    const box = h('div', { class: 'qtypes layers' });
    const setAll = (v) => { S.mapKinds = Object.fromEntries(MAP_LAYERS.map(([k]) => [k, v])); apply(); };
    const apply = () => { store.set('mapKinds', S.mapKinds); draw(); renderToolbar(); if (S.tab === 'map') renderView(); };
    const draw = () => fill(box, MAP_LAYERS.map(([k, label]) => chip(label, !!S.mapKinds[k], () => {
      S.mapKinds = { ...S.mapKinds, [k]: !S.mapKinds[k] };
      apply();
    })));
    draw();
    fill(dlg, h('form', { method: 'dialog', onsubmit: (e) => { e.preventDefault(); closeSheet(); } },
      h('h2', null, '🗂 Map layers'),
      box,
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn small', onclick: () => setAll(true) }, 'All'),
        h('button', { type: 'button', class: 'btn small', onclick: () => setAll(false) }, 'None'),
        h('button', { type: 'submit', class: 'btn primary' }, 'Done'))));
    if (typeof dlg.showModal === 'function' && !dlg.open) dlg.showModal(); else dlg.setAttribute('open', '');
  }

  function startGeo() {
    if (geoWatch != null) return;
    if (!('geolocation' in navigator)) { S.geoErr = 'This browser has no location support.'; return; }
    if (!window.isSecureContext) { S.geoErr = 'Location needs the site to be opened over https.'; return; }
    geoWatch = navigator.geolocation.watchPosition((pos) => {
      const first = !S.geo;
      S.geo = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, at: Date.now() };
      S.geoErr = null;
      if (first && S.share) shareTick();
      if (S.nav) updateNav();
      if (map) {
        map.setUser(S.geo);
        if ((first && atResort()) || followMe) map.setView(S.geo.lat, S.geo.lng);
      }
      if (S.tab === 'map') renderNearby();
    }, (err) => {
      S.geoErr = err.code === 1 ? 'Location permission was denied — allow it in your browser settings to see what’s near you.'
        : 'Couldn’t get your location yet.';
      if (S.tab === 'map') renderNearby();
    }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
  }

  function stopGeo() {
    if (geoWatch != null) navigator.geolocation.clearWatch(geoWatch);
    geoWatch = null;
    followMe = false;
  }

  function centreOnMe() {
    startGeo();
    if (S.geo && map) {
      followMe = true;
      map.setView(S.geo.lat, S.geo.lng, Math.max(map.z, 17));
      if (!atResort()) toast('You’re not at the resort yet — the dot is where you are now.');
    } else {
      toast(S.geoErr || 'Finding you…');
    }
  }

  function ensureMap() {
    if (map) return;
    mapBox = h('div', { class: 'map-wrap' });
    const mapEl = h('div', { class: 'map', role: 'application', 'aria-label': 'Resort map' });
    const card = h('div', { class: 'map-card', id: 'mapCard', hidden: true });
    mapBox.append(mapEl, card);
    const cfg = S.boot.map || {};
    map = new PPMap(mapEl, {
      tiles: cfg.tiles || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: cfg.attribution || '© OpenStreetMap contributors',
      center: S.geo && atResort() ? S.geo : RESORT,
      zoom: 16,
      onMarker: (id) => selectPlace(id),
      onLocate: () => centreOnMe(),
      onMove: () => { followMe = false; },
    });
    if (S.geo) map.setUser(S.geo);
  }

  function selectPlace(id, centre) {
    S.mapSel = id;
    map?.select(id);
    const p = mapPlaces().find((x) => x.id === id) || allPlaces().find((x) => x.id === id);
    if (p && centre) map.setView(p.lat, p.lng, Math.max(map.z, 18));
    renderMapCard();
  }

  function allPlaces() {
    const keep = S.mapKinds;
    S.mapKinds = { ride: true, show: true, food: true, shop: true, ess: true, rain: true, seat: true, smoke: true, view: true };
    const all = mapPlaces();
    S.mapKinds = keep;
    return all;
  }

  function renderMapCard() {
    const card = $('#mapCard');
    if (!card) return;
    if (S.nav) { renderNavPanel(); return; }
    card.classList.remove('nav-on');
    const p = allPlaces().find((x) => x.id === S.mapSel);
    if (!p) { card.hidden = true; return; }
    const it = p.it;
    const icons = { ride: '🎢', show: '✨', food: '🍴', shop: '🛍', person: '🧑', meet: '📌', ess: p.kind === 'ess' ? ESS[it.type].icon : '' };
    const social = p.kind === 'person' || p.kind === 'meet' || p.kind === 'ess';
    card.hidden = false;
    fill(card,
      h('div', { class: 'mc-h' },
        h('b', null, `${icons[p.kind]} ${it.name}`),
        h('button', { type: 'button', class: 'mc-x', 'aria-label': 'Close', onclick: () => { S.mapSel = null; map.select(null); renderMapCard(); } }, '✕')),
      h('div', { class: 'ride-meta' },
        h('span', null, placeStatus(p)),
        p.park ? h('span', null, parkShort(p.park)) : null,
        S.geo ? h('span', null, walk(PPMap.metres(S.geo, p))) : null),
      h('div', { class: 'actions' },
        social ? null : h('button', { type: 'button', class: 'btn small', onclick: () => openPlace(p) }, 'Details'),
        social ? null : h('button', { type: 'button', class: 'btn small', onclick: () => setFav(it, p.park, !it.fav).then(renderMapCard) }, it.fav ? '★' : '☆'),
        p.kind === 'meet'
          ? h('button', { type: 'button', class: 'btn small danger', onclick: clearMeet }, 'Remove pin')
          : h('button', { type: 'button', class: 'btn small', onclick: () => setMeet(p.lat, p.lng, p.kind === 'person' ? `Meet at ${it.name}` : `Meet at ${it.name}`) }, '📌 Meet here'),
        h('button', { type: 'button', class: 'btn small primary', onclick: () => startNav({ id: p.id, name: it.name, lat: p.lat, lng: p.lng }) }, '🧭 Go'),
        isIOS()
          ? h('a', { class: 'btn small', target: '_blank', rel: 'noopener', href: `https://maps.apple.com/?daddr=${p.lat},${p.lng}&dirflg=w` }, 'Apple Maps')
          : h('a', {
            class: 'btn small', target: '_blank', rel: 'noopener',
            href: `https://www.google.com/maps/dir/?api=1&travelmode=walking&destination=${p.lat},${p.lng}`,
          }, 'Google Maps')),
      w3wControl(p.lat, p.lng, it.name));
  }

  /** Jump from the map to the place's own tab, expanded. */
  function openPlace(p) {
    if (p.kind === 'ride') { S.park = p.park; store.set('park', p.park); S.filter = 'all'; switchTab('now'); loadHistory(p.id); }
    else if (p.kind === 'show') { S.park = p.park; store.set('park', p.park); switchTab('shows'); }
    else {
      S.foodArea = p.park; store.set('foodArea', p.park);
      S.placeKind = p.kind === 'shop' ? 'shop' : 'food'; store.set('placeKind', S.placeKind);
      S.foodFilter = 'all';
      switchTab('food');
    }
    S.expanded = p.id;
    renderView();
    requestAnimationFrame(() => document.getElementById('r-' + p.id)?.scrollIntoView({ block: 'center' }));
  }

  function showOnMap(id) {
    const p = allPlaces().find((x) => x.id === id);
    if (p && !S.mapKinds[p.kind]) { S.mapKinds = { ...S.mapKinds, [p.kind]: true }; store.set('mapKinds', S.mapKinds); }
    switchTab('map');
    requestAnimationFrame(() => selectPlace(id, true));
  }

  function renderNearby() {
    const box = $('#nearby');
    if (!box) return;
    box.replaceChildren();
    if (!S.geo) {
      add(box, h('p', { class: 'notice' }, S.geoErr || 'Finding your location… (allow location access when asked)'));
      return;
    }
    if (!atResort()) {
      add(box, h('p', { class: 'notice' },
        `You’re ${(PPMap.metres(S.geo, RESORT) / 1000).toFixed(0)} km from the resort — “near you” kicks in once you’re there. You can still browse the map.`));
      return;
    }
    const near = mapPlaces()
      .map((p) => ({ p, d: PPMap.metres(S.geo, p) }))
      .filter((x) => x.d <= 700)
      .sort((a, b) => a.d - b.d)
      .slice(0, 25);
    add(box, h('h2', { class: 'group-h' }, `Near you · ±${Math.round(S.geo.acc)} m`));
    if (!near.length) {
      add(box, h('p', { class: 'empty' }, 'Nothing within 700 m for the selected types.'));
      return;
    }
    const icons = { ride: '🎢', show: '✨', food: '🍴', shop: '🛍', person: '🧑', meet: '📌', ess: '📍' };
    add(box, h('ul', { class: 'list' }, near.map(({ p, d }) => h('li', { class: 'card' },
      h('button', { type: 'button', class: 'near-item ride-main', onclick: () => { followMe = false; selectPlace(p.id, true); window.scrollTo({ top: 0, behavior: 'smooth' }); } },
        h('span', { class: 'ni-i', 'aria-hidden': 'true' }, icons[p.kind]),
        h('span', { class: 'what' }, p.it.name, h('small', null, placeStatus(p))),
        h('span', { class: 'ni-d' }, d < 1000 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toFixed(1)} km`))))));
  }

  function viewMap() {
    ensureMap();
    const frag = document.createDocumentFragment();
    add(frag, mapBox, h('div', { id: 'nearby' }));
    map.setMarkers(mapPlaces().map((p) => ({
      id: p.id, lat: p.lat, lng: p.lng, title: `${p.it.name} — ${placeStatus(p)}`, ...markerFor(p),
    })));
    requestAnimationFrame(() => { map.render(); renderNearby(); renderMapCard(); });
    return frag;
  }

  // ------------------------------------------------------------ user pill

  function renderUser() {
    const pill = $('#userPill');
    if (!pill) return;
    const show = S.boot && S.boot.auth !== 'none' && S.boot.authed;
    pill.hidden = !show;
    if (!show) return;
    const u = S.me?.user || S.boot.user;
    const name = u?.name || 'Signed in';
    pill.replaceChildren(avatarEl(u, 'up-i'), h('span', { class: 'up-n' }, u?.name ? name.split(/\s+/)[0] : 'PIN'));
    pill.title = u ? `Signed in as ${u.name}${u.email ? ' (' + u.email + ')' : ''}` : 'Signed in with PIN';
    pill.setAttribute('aria-label', pill.title);
    pill.onclick = () => {
      const dlg = $('#sheet');
      dlg.replaceChildren(h('form', { method: 'dialog', onsubmit: (e) => { e.preventDefault(); closeSheet(); } },
        h('h2', null, 'Signed in'),
        h('div', { class: 'account-big' },
          avatarEl(u, 'up-i big'),
          h('div', null, h('b', null, u?.name || 'Shared PIN login'), u?.email ? h('small', null, u.email) : null,
            h('small', null, S.boot.auth === 'oidc' ? 'via single sign-on' : 'PIN profile — your rides and alerts are your own'))),
        h('div', { class: 'actions' },
          u ? h('button', { type: 'button', class: 'btn', onclick: openAvatarSheet }, '🎨 Picture') : null,
          S.boot.auth === 'pin' ? h('button', { type: 'button', class: 'btn', onclick: () => showProfilePicker({ switching: true }) }, '🔁 Switch profile') : null,
          h('button', { type: 'button', class: 'btn danger', onclick: signOut }, 'Sign out'),
          h('button', { type: 'submit', class: 'btn primary' }, 'Close'))));
      if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    };
  }

  // ================================================================
  //  Predictions · planner · bookings · push · party · offline · wrapped
  // ================================================================

  const GENERIC = { 7: 0.3, 8: 0.4, 9: 0.55, 10: 0.8, 11: 1, 12: 1.1, 13: 1.15, 14: 1.2, 15: 1.15, 16: 1.1, 17: 1, 18: 0.9, 19: 0.8, 20: 0.65, 21: 0.5, 22: 0.4, 23: 0.35 };
  const parkHour = (ms) => Number(fmt({ hour: 'numeric', hourCycle: 'h23' }).format(new Date(ms)));
  const bestFor = (id) => S.best?.rides?.find((r) => r.id === id) || null;
  const walkMins = (a, b) => (a && b ? Math.round((PPMap.metres(a, b) * 1.3) / 75) : 0);
  const hhmm = (ms) => fmt({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));

  /** Expected standby at time ms: history for that hour (or a typical-day curve), nudged by how today is going. */
  function predictWait(it, ms, sameDay) {
    const hr = parkHour(ms);
    const b = bestFor(it.id);
    const hist = b?.hours?.[hr]?.avg;
    let base = hist ?? ((b?.avg ?? it.usually ?? it.wait ?? 20) * (GENERIC[hr] ?? 0.8));
    if (sameDay && it.wait != null && it.status === 'OPERATING') {
      const nowHr = parkHour(Date.now());
      const ref = b?.hours?.[nowHr]?.avg ?? ((b?.avg ?? it.wait) * (GENERIC[nowHr] ?? 1));
      const ratio = Math.max(0.5, Math.min(2, ref > 0 ? it.wait / ref : 1));
      const ahead = Math.max(0, (ms - Date.now()) / 3600000);
      base *= 1 + (ratio - 1) * Math.max(0, 1 - ahead / 4);
    }
    return Math.max(0, Math.round(base / 5) * 5);
  }

  function predictionLine(it) {
    if (it.status !== 'OPERATING' && it.status !== 'DOWN') return null;
    const close = S.live[S.park]?.hours?.find((x) => x.type === 'OPERATING')?.close;
    const end = close ? Date.parse(close) : Date.now() + 4 * 3600000;
    const next = new Date();
    next.setMinutes(0, 0, 0);
    const pts = [];
    for (let i = 1; i <= 5; i++) {
      const ms = next.getTime() + i * 3600000;
      if (ms > end) break;
      pts.push(`${hhmm(ms)} ~${predictWait(it, ms, true)}`);
    }
    if (!pts.length) return null;
    const b = bestFor(it.id);
    return h('div', null, `Likely later: ${pts.join(' · ')}`,
      h('small', { class: 'src' }, b ? ` · from ${S.best.days} day(s) of history + today` : ' · typical-day curve (history still building)'));
  }

  const RIDE_WHERE = { indoor: '🏠 Indoor', covered: '⛱ Covered', outdoor: '🌤 Outdoor' };
  function infoLine(it) {
    const i = it.info;
    if (!i) return null;
    const bits = [RIDE_WHERE[i.where] || i.where];
    if (i.height) bits.push(`min ${i.height} cm`);
    bits.push(['', 'gentle', 'moderate', 'intense'][i.thrill] || '');
    bits.push(`~${i.mins} min ride`);
    return h('div', null, bits.filter(Boolean).join(' · '));
  }

  /** Extra meta chips: single rider saving, Premier Access trend. */
  function hintChips(it) {
    const out = [];
    if (it.status === 'OPERATING' && it.singleRider != null && it.wait != null && it.wait - it.singleRider >= 15) {
      out.push(h('span', { class: 'down' }, `Single rider saves ${it.wait - it.singleRider} min`));
    }
    if (it.paid?.state === 'AVAILABLE' && it.paTrend) {
      if (it.paTrend.sellsOutAt) out.push(h('span', { class: 'up' }, `PA likely gone ~${time(it.paTrend.sellsOutAt)}`));
      else if (it.paTrend.perHour >= 20) out.push(h('span', null, `PA returns +${it.paTrend.perHour} min/h`));
    }
    return out;
  }

  // ---------------------------------------------------------- locations

  function locOf(id) {
    for (const p of [...Object.values(S.live), S.village, S.shops]) {
      const it = p?.items?.find((x) => x.id === id);
      if (it?.location) return it.location;
    }
    return null;
  }

  function hoursOn(date, park) {
    let segs = null;
    if (date === today() && S.live[park]?.date === date) segs = S.live[park].hours;
    else segs = S.trip?.days?.find((d) => d.date === date)?.parks?.[park];
    segs = segs || [];
    const op = segs.find((s) => s.type === 'OPERATING');
    const emh = segs.find((s) => s.type === 'EXTRA_HOURS');
    return { open: op ? Date.parse(op.open) : null, close: op ? Date.parse(op.close) : null, emh: emh ? Date.parse(emh.open) : null };
  }

  function showsOn(date, park) {
    const out = [];
    if (date === today()) {
      for (const it of S.live[park]?.items || []) {
        if (it.type !== 'SHOW' || it.reserved) continue;
        for (const st of it.showtimes || []) if (parkDate(new Date(st.start)) === date) out.push({ id: it.id, name: it.name, start: Date.parse(st.start), end: st.end ? Date.parse(st.end) : null, fav: it.fav });
      }
    } else {
      const favs = new Set((S.me?.favourites || []).map((f) => f.id));
      for (const s of S.trip?.days?.find((d) => d.date === date)?.shows || []) {
        if (s.park !== park || s.reserved) continue;
        out.push({ id: s.id, name: s.name, start: Date.parse(s.start), end: s.end ? Date.parse(s.end) : null, fav: favs.has(s.id) });
      }
    }
    return out.sort((a, b) => a.start - b.start);
  }

  // ------------------------------------------------------------- planner

  S.plan = store.get('plan', null);
  S.planner = { open: false, date: null, park: null, start: '', emh: false, rides: null, shows: null, result: null };

  function plannerRides(park) {
    const favs = new Set((S.me?.favourites || []).map((f) => f.id));
    return (S.live[park]?.items || [])
      .filter((it) => it.type === 'ATTRACTION' && it.location && it.status !== 'REFURBISHMENT')
      .map((it) => ({ it, fav: favs.has(it.id), avg: bestFor(it.id)?.avg ?? it.wait ?? 0 }))
      .sort((a, b) => (b.fav - a.fav) || (b.avg - a.avg) || a.it.name.localeCompare(b.it.name));
  }

  /**
   * Greedy day plan: repeatedly pick the ride that is cheapest now (walk + predicted wait)
   * and closest to its best wait of the rest of the day, around fixed shows/bookings.
   */
  function buildPlan({ date, park, start, end, rideIds, showPicks }) {
    const sameDay = date === today();
    const rides = rideIds.map((id) => S.live[park]?.items?.find((x) => x.id === id)).filter(Boolean);
    const fixed = [];
    for (const s of showPicks) {
      fixed.push({ kind: 'show', id: s.id, name: s.name, start: s.start - 15 * 60000, at: s.start, end: s.end || s.start + 30 * 60000, loc: locOf(s.id) });
    }
    for (const b of S.bookings || []) {
      if (b.day !== date) continue;
      const at = b.at * 1000;
      const dur = b.endsAt ? b.endsAt * 1000 - at : b.kind === 'RESTAURANT' ? 60 * 60000 : b.kind === 'PREMIER_ACCESS' ? 20 * 60000 : 30 * 60000;
      fixed.push({ kind: 'booking', id: 'b' + b.id, name: b.name, sub: b.kind, start: at - 5 * 60000, at, end: at + Math.min(dur, 90 * 60000), loc: b.entityId ? locOf(b.entityId) : null, entityId: b.entityId });
    }
    fixed.sort((a, b) => a.start - b.start);
    // A Premier Access booking covers that ride.
    const covered = new Set(fixed.filter((f) => f.sub === 'PREMIER_ACCESS' && f.entityId).map((f) => f.entityId));
    let remaining = rides.filter((r) => !covered.has(r.id));

    const items = [];
    let t = start;
    let pos = null;
    let guard = 0;
    while (t < end && guard++ < 200) {
      const nextFixed = fixed.find((f) => !f.done && f.end > t);
      const limit = nextFixed ? nextFixed.start : end;
      let best = null;
      for (const r of remaining) {
        const walk = walkMins(pos, r.location);
        const arrive = t + walk * 60000;
        const w = predictWait(r, arrive, sameDay);
        const dur = r.info?.mins ?? 5;
        const finish = arrive + (w + dur) * 60000;
        if (finish > limit - walkMins(r.location, nextFixed?.loc) * 60000) continue;
        let minFuture = w;
        for (let ms = arrive + 3600000; ms < end; ms += 3600000) minFuture = Math.min(minFuture, predictWait(r, ms, sameDay));
        const score = walk + w + 0.8 * (w - minFuture);
        if (!best || score < best.score) best = { r, walk, arrive, w, finish, score };
      }
      if (best) {
        items.push({ kind: 'ride', id: best.r.id, name: best.r.name, start: best.arrive, end: best.finish, wait: best.w, walk: best.walk });
        t = best.finish;
        pos = best.r.location;
        remaining = remaining.filter((r) => r !== best.r);
        continue;
      }
      if (!nextFixed) break;
      const walk = walkMins(pos, nextFixed.loc);
      items.push({ ...nextFixed, walk, start: Math.max(nextFixed.start, t) });
      nextFixed.done = true;
      t = Math.max(t, nextFixed.end);
      pos = nextFixed.loc || pos;
    }
    for (const f of fixed) if (!f.done && f.at >= start) items.push({ ...f, walk: 0 });
    items.sort((a, b) => a.start - b.start);
    return { date, park, start, end, items, skipped: remaining.map((r) => r.name), builtAt: Date.now() };
  }

  function openPlanner() {
    const dates = [...new Set([today(), ...tripDates()])].filter((d) => d >= today());
    const p = S.planner;
    p.open = true;
    p.date = p.date && dates.includes(p.date) ? p.date : dates.find((d) => d >= S.boot.trip.start) || dates[0];
    p.park = p.park || S.park;
    p.rides = null;
    p.shows = null;
    p.result = null;
    if (!S.trip) loadTrip();
    if (!S.best) loadBest();
    loadTouringPlans();
    for (const pk of S.boot.parks) if (!S.live[pk.key]) loadLive(pk.key, { quiet: true });
    renderView();
  }

  function tripDates() {
    const out = [];
    for (let d = S.boot.trip.start; d <= S.boot.trip.end;) {
      out.push(d);
      const n = new Date(d + 'T12:00:00Z');
      n.setUTCDate(n.getUTCDate() + 1);
      d = n.toISOString().slice(0, 10);
    }
    return out;
  }

  function plannerStartDefault(p) {
    const hrs = hoursOn(p.date, p.park);
    let ms = (p.emh && hrs.emh) || hrs.open;
    if (p.date === today()) ms = Math.max(ms || 0, Date.now());
    return ms ? hhmm(ms) : '09:00';
  }

  function plannerCard() {
    const p = S.planner;
    const card = h('section', { class: 'card day planner' });
    if (!p.open) {
      add(card, h('h2', null, '🧭 Plan my day'));
      if (S.plan) {
        const rides = S.plan.items.filter((x) => x.kind === 'ride').length;
        add(card, h('p', { class: 'spark-lbl' }, `Saved plan: ${dayLabel(S.plan.date)} · ${parkShort(S.plan.park)} · ${rides} rides`),
          planTimeline(S.plan, !S.planExpanded, true));
      } else {
        add(card, h('p', { class: 'spark-lbl' }, 'Pick your must-dos and shows; Park Pulse orders them around quiet times, walking distance, shows and bookings.'));
      }
      add(card, h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn primary', onclick: openPlanner }, S.plan ? 'New plan' : 'Plan my day'),
        S.plan && S.plan.date === today() ? h('button', { type: 'button', class: 'btn', onclick: () => replanFromNow() }, 'Re-plan from now') : null,
        S.plan ? h('button', { type: 'button', class: 'btn', onclick: () => { S.plan = null; store.set('plan', null); syncPlan(); renderView(); } }, 'Clear') : null));
      return card;
    }

    const dates = [...new Set([today(), ...tripDates()])].filter((d) => d >= today());
    const hrs = hoursOn(p.date, p.park);
    const rides = plannerRides(p.park);
    if (p.rides === null) p.rides = new Set(rides.filter((r) => r.fav).map((r) => r.it.id).concat(rides.some((r) => r.fav) ? [] : rides.slice(0, 8).map((r) => r.it.id)));
    const shows = showsOn(p.date, p.park);
    const showNames = [...new Map(shows.map((s) => [s.id, s])).values()];
    if (p.shows === null) p.shows = new Set(showNames.filter((s) => s.fav).map((s) => s.id));
    if (!p.start) p.start = plannerStartDefault(p);
    const reset = () => { p.rides = null; p.shows = null; p.start = ''; p.result = null; renderView(); };

    add(card, 
      h('h2', null, '🧭 Plan my day', h('button', { type: 'button', class: 'btn small', onclick: () => { p.open = false; renderView(); } }, 'Close')),
      h('div', { class: 'qtypes' }, dates.map((d) => chip(dayLabel(d), p.date === d, () => { p.date = d; reset(); }))),
      h('div', { class: 'qtypes' }, S.boot.parks.map((pk) => chip(pk.short, p.park === pk.key, () => { p.park = pk.key; p.group = null; reset(); }))),
      templateChips(),
      h('div', { class: 'spark-lbl' }, hrs.open ? `Park ${hhmm(hrs.open)}–${hhmm(hrs.close)}${hrs.emh ? ` · EMH from ${hhmm(hrs.emh)}` : ''}` : 'Hours not published for this day yet'),
      h('div', { class: 'plan-row' },
        h('label', null, 'Start ', h('input', { type: 'time', value: p.start, onchange: (e) => { p.start = e.target.value; } })),
        hrs.emh ? chip('Use Extra Magic Hours', p.emh, () => { p.emh = !p.emh; p.start = ''; renderView(); }) : null),
      h('div', { class: 'group-h' }, `Rides (${p.rides.size} picked)`),
      h('div', { class: 'pick-list' }, rides.map(({ it, fav }) => h('label', { class: 'pick' },
        h('input', { type: 'checkbox', checked: p.rides.has(it.id), onchange: (e) => { e.target.checked ? p.rides.add(it.id) : p.rides.delete(it.id); } }),
        h('span', null, fav ? '★ ' : '', it.name), it.info?.height ? h('small', null, ` ${it.info.height} cm`) : null))),
      showNames.length ? h('div', { class: 'group-h' }, 'Shows') : null,
      showNames.length ? h('div', { class: 'pick-list' }, showNames.map((s) => h('label', { class: 'pick' },
        h('input', { type: 'checkbox', checked: p.shows.has(s.id), onchange: (e) => { e.target.checked ? p.shows.add(s.id) : p.shows.delete(s.id); } }),
        h('span', null, s.fav ? '★ ' : '', s.name), h('small', null, ' ' + shows.filter((x) => x.id === s.id).map((x) => hhmm(x.start)).join(', '))))) : null,
      h('div', { class: 'actions' }, h('button', {
        type: 'button', class: 'btn primary',
        onclick: () => {
          if (!hrs.open) { toast('No park hours for that day yet'); return; }
          const [H, M] = (p.start || '09:00').split(':').map(Number);
          const openMin = parkHour(hrs.open) * 60 + new Date(hrs.open).getMinutes();
          const startMs = hrs.open + ((H * 60 + M) - openMin) * 60000;
          const showPicks = [];
          for (const id of p.shows) {
            const times = shows.filter((s) => s.id === id && s.start >= startMs);
            if (times.length) showPicks.push(times[0]);
          }
          p.result = buildPlan({ date: p.date, park: p.park, start: startMs, end: hrs.close, rideIds: [...p.rides], showPicks });
          renderView();
        },
      }, 'Build plan')),
    );
    if (p.result) {
      add(card, planTimeline(p.result, false), h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn primary', onclick: () => { S.plan = p.result; store.set('plan', S.plan); syncPlan(); p.open = false; toast('Plan saved — it re-optimises itself through the day'); renderView(); } }, 'Save plan')));
    }
    return card;
  }

  function planTimeline(plan, compact, expandable) {
    const doneIds = new Set((S.me?.log || []).filter((l) => l.day === plan.date).map((l) => l.entityId));
    const icon = { ride: '🎢', show: '✨', booking: '📅' };
    const items = compact ? plan.items.filter((x) => x.end > Date.now() || plan.date !== today()).slice(0, 6) : plan.items;
    const ul = h('ol', { class: 'timeline' }, items.map((x) => h('li', { class: (doneIds.has(x.id) ? 'done ' : '') + x.kind },
      h('b', null, hhmm(x.kind === 'show' || x.kind === 'booking' ? x.at : x.start)),
      h('span', { class: 'what' }, `${icon[x.kind]} ${x.name}`,
        h('small', null, x.kind === 'ride' ? `~${x.wait} min wait${x.walk ? ` · ${x.walk} min walk` : ''}` : x.kind === 'show' ? 'be there 15 min early' : (x.sub || '').replace('_', ' ').toLowerCase())))));
    const frag = h('div', null, ul);
    if (!compact && plan.skipped?.length) add(frag, h('p', { class: 'spark-lbl' }, `Didn’t fit: ${plan.skipped.join(', ')}`));
    if (compact && plan.items.length > items.length) {
      add(frag, h('button', { type: 'button', class: 'btn small', onclick: () => { S.planExpanded = true; renderView(); } }, `+ ${plan.items.length - items.length} more`));
    } else if (expandable && !compact && S.planExpanded) {
      add(frag, h('button', { type: 'button', class: 'btn small', onclick: () => { S.planExpanded = false; renderView(); } }, 'Show less'));
    }
    return frag;
  }

  function replanFromNow(quiet) {
    if (!S.plan) return;
    const done = new Set((S.me?.log || []).filter((l) => l.day === today()).map((l) => l.entityId));
    const rideIds = S.plan.items.filter((x) => x.kind === 'ride' && !done.has(x.id) && x.start > Date.now() - 30 * 60000).map((x) => x.id)
      .concat(S.plan.skipped?.length ? (S.live[S.plan.park]?.items || []).filter((it) => S.plan.skipped.includes(it.name)).map((it) => it.id) : []);
    const hrs = hoursOn(S.plan.date, S.plan.park);
    const showPicks = S.plan.items.filter((x) => x.kind === 'show' && x.at > Date.now()).map((x) => ({ id: x.id, name: x.name, start: x.at, end: x.end }));
    S.plan = buildPlan({ date: S.plan.date, park: S.plan.park, start: Date.now(), end: hrs.close || Date.now() + 6 * 3600000, rideIds, showPicks });
    store.set('plan', S.plan);
    syncPlan();
    if (quiet !== true) toast('Plan updated from now');
    renderView();
  }

  function nextUpCard() {
    const plan = S.plan;
    if (!plan || plan.date !== today() || plan.park !== S.park) return null;
    const done = new Set((S.me?.log || []).filter((l) => l.day === today()).map((l) => l.entityId));
    const next = plan.items.find((x) => x.end > Date.now() && !done.has(x.id));
    if (!next) return null;
    const it = S.live[S.park]?.items?.find((x) => x.id === next.id);
    const down = it && it.type === 'ATTRACTION' && it.status !== 'OPERATING';
    return h('div', { class: 'card nextup' + (down ? ' warn' : '') },
      h('div', null, h('small', null, 'Next up in your plan'),
        h('b', null, `${hhmm(next.kind === 'ride' ? next.start : next.at)} · ${next.name}`),
        h('small', null, it?.type === 'ATTRACTION' ? (down ? 'Currently not running — re-plan?' : `planned ~${next.wait} min · now ${it.wait ?? '–'} min`) : '')),
      h('button', { type: 'button', class: 'btn small', onclick: () => replanFromNow() }, 'Re-plan'));
  }

  // ------------------------------------------------------------- bookings

  S.bookings = store.get('bookings', []);

  async function loadBookings() {
    try {
      S.bookings = (await api('bookings')).bookings;
      store.set('bookings', S.bookings);
      if (S.tab === 'trip') renderView();
    } catch { /* keep cached */ }
  }

  const BOOKING_ICON = { RESTAURANT: '🍽', PREMIER_ACCESS: '⚡', SHOW: '✨', OTHER: '📌' };

  function bookingsCard() {
    const card = h('section', { class: 'card day' }, h('h2', null, '📅 Bookings',
      h('button', { type: 'button', class: 'btn small', onclick: () => openBookingSheet() }, '+ Add')));
    const list = (S.bookings || []).filter((b) => b.at * 1000 > Date.now() - 3 * 3600000);
    if (!list.length) {
      add(card, h('p', { class: 'spark-lbl' }, 'Add restaurant reservations and Premier Access return times — they go into your day plan, and everyone with notifications on gets a reminder 30 min before.'));
      return card;
    }
    let lastDay = null;
    for (const b of list) {
      if (b.day !== lastDay) { add(card, h('div', { class: 'group-h' }, dayLabel(b.day))); lastDay = b.day; }
      const confirming = S.deleting === 'b' + b.id;
      add(card, h('div', { class: 'log-item' },
        h('span', { class: 'when' }, timeTs(b.at)),
        h('span', { class: 'what' }, `${BOOKING_ICON[b.kind] || '📌'} ${b.name}`,
          h('small', null, [b.endsAt ? `until ${timeTs(b.endsAt)}` : null, b.note, b.by ? `by ${b.by}` : null].filter(Boolean).join(' · '))),
        h('button', {
          type: 'button', class: 'btn small' + (confirming ? ' danger' : ''),
          onclick: async () => {
            if (!confirming) { S.deleting = 'b' + b.id; renderView(); return; }
            try { S.bookings = (await api('bookings/' + b.id, { method: 'DELETE' })).bookings; store.set('bookings', S.bookings); } catch (e) { toast(e.message); }
            S.deleting = null; renderView();
          },
        }, confirming ? 'Delete?' : '✕')));
    }
    return card;
  }

  function openBookingSheet(prefill) {
    const dlg = $('#sheet');
    let kind = 'RESTAURANT';
    const names = new Map();
    for (const [park, d] of Object.entries(S.live)) for (const it of d?.items || []) if (it.type === 'RESTAURANT' || it.type === 'ATTRACTION') names.set(it.name, { id: it.id, park, type: it.type });
    for (const it of S.village?.items || []) if (it.section !== 'Shops') names.set(it.name, { id: it.id, park: 'village', type: 'RESTAURANT' });
    const listId = 'bk-names';
    const datalist = h('datalist', { id: listId });
    const kinds = h('div', { class: 'qtypes' });
    const draw = () => {
      kinds.replaceChildren(...[['RESTAURANT', '🍽 Restaurant'], ['PREMIER_ACCESS', '⚡ Premier Access'], ['SHOW', '✨ Show'], ['OTHER', '📌 Other']]
        .map(([k, l]) => chip(l, kind === k, () => { kind = k; draw(); })));
      datalist.replaceChildren(...[...names.entries()].filter(([, v]) => (kind === 'PREMIER_ACCESS' ? v.type === 'ATTRACTION' : kind === 'RESTAURANT' ? v.type === 'RESTAURANT' : true))
        .map(([n]) => h('option', { value: n })));
      endWrap.hidden = kind !== 'PREMIER_ACCESS';
    };
    const name = h('input', { type: 'text', list: listId, required: true, placeholder: 'e.g. Bistrot Chez Rémy', maxlength: '200', value: typeof prefill === 'string' ? prefill : '' });
    const dates = [...new Set([today(), ...tripDates()])].filter((d) => d >= today());
    const date = h('select', null, dates.map((d) => h('option', { value: d }, dayLabel(d))));
    const at = h('input', { type: 'time', required: true, value: '12:30' });
    const ends = h('input', { type: 'time' });
    const endWrap = h('label', null, 'Return window ends (optional)', ends);
    const note = h('input', { type: 'text', maxlength: '300', placeholder: 'Optional — confirmation no., party size…' });
    draw();
    const form = h('form', {
      method: 'dialog',
      onsubmit: async (e) => {
        e.preventDefault();
        const m = names.get(name.value.trim());
        try {
          S.bookings = (await api('bookings', {
            method: 'POST',
            body: {
              kind, name: name.value.trim(), entityId: m?.id || null, park: m?.park || null,
              at: `${date.value}T${at.value}:00`, endsAt: ends.value ? `${date.value}T${ends.value}:00` : null, note: note.value,
            },
          })).bookings;
          store.set('bookings', S.bookings);
          closeSheet();
          toast('Booking added');
          renderView();
        } catch (err) { toast(err.message); }
      },
    },
    h('h2', null, 'Add a booking'), kinds,
    h('label', null, 'What', name, datalist),
    h('div', { class: 'plan-row' }, h('label', null, 'Day', date), h('label', null, 'Time', at)),
    endWrap,
    h('label', null, 'Note', note),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn', onclick: closeSheet }, 'Cancel'),
      h('button', { type: 'submit', class: 'btn primary' }, 'Save')));
    dlg.replaceChildren(form);
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  }

  // ---------------------------------------------------------------- push

  S.push = store.get('push', null); // { endpoint, status }
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  function deviceId() {
    let id = store.get('device', null);
    if (!id) {
      const a = new Uint8Array(12);
      crypto.getRandomValues(a);
      id = [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
      store.set('device', id);
    }
    return id;
  }

  const b64ToBytes = (s) => {
    const pad = '='.repeat((4 - (s.length % 4)) % 4);
    const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  };
  const alertsPayload = () => Object.entries(S.alerts).map(([id, a]) => ({ id, park: a.park, name: a.name, reopen: !!a.reopen, down: !!a.down, maxWait: a.maxWait ?? null }));

  async function refreshPush() {
    if (!pushSupported()) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) { if (S.push) { S.push = null; store.set('push', null); } return; }
      const r = await api('push/status', { method: 'POST', body: { endpoint: sub.endpoint } });
      if (!r.status) { // server forgot us (e.g. new database) — re-register silently
        await api('push/subscribe', { method: 'POST', body: { subscription: sub.toJSON(), device: deviceId(), prefs: S.push?.status?.prefs || {}, alerts: alertsPayload() } });
      }
      S.push = { endpoint: sub.endpoint, status: r.status || S.push?.status || null };
      store.set('push', S.push);
      if (S.tab === 'mine') renderView();
    } catch { /* offline */ }
  }

  async function enablePush() {
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { toast('Notifications are blocked — allow them in your browser settings'); return; }
      const key = await api('push/key');
      if (!key.available) { toast('The server can’t send push (needs PHP openssl)'); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription()
        || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key.publicKey) });
      const r = await api('push/subscribe', { method: 'POST', body: { subscription: sub.toJSON(), device: deviceId(), prefs: {}, alerts: alertsPayload() } });
      S.push = { endpoint: sub.endpoint, status: r.status };
      store.set('push', S.push);
      toast('Notifications on ✨');
      renderView();
    } catch (e) { toast('Couldn’t turn on notifications: ' + e.message); }
  }

  async function disablePush() {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api('push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
        await sub.unsubscribe();
      }
    } catch { /* ignore */ }
    S.push = null;
    store.set('push', null);
    renderView();
  }

  async function setPushPref(key, on) {
    if (!S.push) return;
    const prefs = { ...(S.push.status?.prefs || {}), [key]: on };
    try {
      const r = await api('push/prefs', { method: 'POST', body: { endpoint: S.push.endpoint, prefs } });
      S.push.status = r.status;
      store.set('push', S.push);
      renderView();
    } catch (e) { toast(e.message); }
  }

  function syncAlerts() {
    store.set('alerts', S.alerts);
    if (S.push?.endpoint) api('push/alerts', { method: 'POST', body: { endpoint: S.push.endpoint, alerts: alertsPayload() } }).catch(() => {});
  }

  // ------------------------------------------------- notification check

  const PUSH_CODES = {
    0: 'The server couldn’t reach the push service — your host may block outgoing connections (ask them to allow HTTPS to fcm.googleapis.com / web.push.apple.com / push.services.mozilla.com).',
    400: 'The push service rejected the request format — usually a VAPID/subject problem. Set push_subject in config.local.php to "mailto:you@yourdomain" and re-subscribe.',
    401: 'Authorisation failed (VAPID). Set push_subject to a real "mailto:" address, then turn notifications off and on again.',
    403: 'Forbidden: the VAPID key doesn’t match this subscription (e.g. the database was reset). Turn notifications off and on again.',
    404: 'This subscription has expired — re-subscribing now fixes it.',
    410: 'This subscription was removed by the browser — re-subscribing now fixes it.',
    413: 'Message too large.',
    429: 'Too many messages — the push service is rate-limiting; try again later.',
  };

  async function runPushCheck() {
    const rows = [];
    const add = (ok, label, detail) => rows.push({ ok, label, detail });
    const dlg = $('#sheet');
    const render = (done) => {
      dlg.replaceChildren(h('form', { method: 'dialog', onsubmit: (e) => { e.preventDefault(); closeSheet(); } },
        h('h2', null, '🩺 Notification check'),
        h('ul', { class: 'check-list' }, rows.map((r) => h('li', { class: r.ok === true ? 'ok' : r.ok === false ? 'bad' : 'warn' },
          h('b', null, `${r.ok === true ? '✅' : r.ok === false ? '❌' : '⚠️'} ${r.label}`), r.detail ? h('small', null, r.detail) : null))),
        done ? null : h('p', { class: 'spark-lbl' }, 'Checking…'),
        h('div', { class: 'actions' },
          done ? h('button', { type: 'button', class: 'btn', onclick: async () => { closeSheet(); await disablePush(); await enablePush(); } }, 'Re-subscribe') : null,
          h('button', { type: 'submit', class: 'btn primary' }, 'Close'))));
      if (!dlg.open) { if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', ''); }
    };
    render(false);

    add(window.isSecureContext, 'Secure connection (https)', window.isSecureContext ? null : 'Push only works over https — open the site via https://');
    if (isIOS()) add(isStandalone(), 'Opened from the Home Screen (iPhone/iPad)', isStandalone() ? null : 'On iOS, notifications only work in the Home-Screen app: Share → Add to Home Screen, then open Park Pulse from that icon and turn notifications on there.');
    add(pushSupported(), 'Browser supports push', pushSupported() ? null : 'This browser can’t receive push notifications.');
    if (!pushSupported()) { render(true); return; }

    const perm = Notification.permission;
    add(perm === 'granted', `Notification permission: ${perm}`, perm === 'denied'
      ? 'Blocked. Allow notifications for this site in your browser/phone settings (on iPhone: Settings → Notifications → Park Pulse).'
      : perm === 'default' ? 'Not asked yet — tap “Turn on notifications”.' : null);
    render(false);

    let reg = null;
    try { reg = await navigator.serviceWorker.getRegistration(); } catch { /* ignore */ }
    add(!!reg?.active, 'Service worker running', reg?.active ? `scope ${new URL(reg.scope).pathname}` : 'Not active — reload the page once and try again.');
    render(false);

    if (reg && perm === 'granted') {
      try {
        await reg.showNotification('Park Pulse — local test', { body: 'If you see this, your phone can display Park Pulse notifications.', tag: 'local-test', icon: 'assets/icon.svg' });
        add(true, 'Phone can display a notification', 'You should see a “local test” notification now. If not, check Focus / Do Not Disturb and per-app notification settings.');
      } catch (e) {
        add(false, 'Phone can display a notification', e.message);
      }
    }

    let sub = null;
    try { sub = reg ? await reg.pushManager.getSubscription() : null; } catch { /* ignore */ }
    add(!!sub, 'This phone is subscribed', sub ? `via ${new URL(sub.endpoint).host}` : 'Not subscribed — tap “Turn on notifications”.');
    render(false);
    if (!sub) { render(true); return; }

    let st = null;
    try { st = await api('push/status', { method: 'POST', body: { endpoint: sub.endpoint } }); } catch (e) { add(false, 'Server reachable', e.message); }
    if (st) {
      add(!!st.available, 'Server can send push', st.available ? null : 'PHP openssl (EC + aes-128-gcm) is missing on the host.');
      add(!!st.status, 'Server knows this phone', st.status ? `${st.status.alerts} ride alert(s) synced` : 'The server has no record of it (e.g. new database) — use Re-subscribe below.');
      const subj = st.subject || '';
      add(/^(mailto:|https:\/\/)/.test(subj) && !/localhost|example\.invalid/.test(subj), `VAPID contact: ${subj || 'none'}`,
        /^(mailto:|https:\/\/)/.test(subj) ? null : 'Set push_subject in config.local.php to "mailto:you@yourdomain".');
      const cronOk = st.cronLast && Date.now() / 1000 - st.cronLast < 15 * 60;
      add(cronOk ? true : false, 'Cron collector running', cronOk ? `last ran ${ago(st.cronLast)}`
        : (st.cronLast ? `last ran ${ago(st.cronLast)} — ` : 'never ran — ') + 'ride alerts, show/booking reminders and the morning brief are sent by the 5-minute cron job; without it only “Send test” works. See README → cron.');
      render(false);
    }

    if (st?.status) {
      try {
        const r = await api('push/test', { method: 'POST', body: { endpoint: sub.endpoint } });
        const explain = PUSH_CODES[r.code] || (r.ok ? null : `Push service answered HTTP ${r.code}.`);
        add(r.ok, `Server → push service: HTTP ${r.code}`, r.ok ? 'Accepted. A “Notifications work on this phone ✨” message should arrive within a minute.' : [explain, r.reason].filter(Boolean).join(' — '));
        if (r.code === 404 || r.code === 410) { await disablePush(); await enablePush(); }
      } catch (e) {
        add(false, 'Server → push service', e.message);
      }
    }
    if (st?.log?.length) {
      add(null, 'Recent deliveries', st.log.slice(0, 5).map((l) => `${timeTs(l.t)} ${l.tag || 'push'} → ${l.code}${l.reason ? ' (' + l.reason.slice(0, 60) + ')' : ''}`).join(' · '));
    }
    render(true);
  }

  function pushSection() {
    const frag = document.createDocumentFragment();
    add(frag, h('h2', { class: 'group-h' }, '🔔 Notifications on this phone'));
    add(frag, h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn small', onclick: runPushCheck }, '🩺 Check notifications')));
    if (!pushSupported()) {
      add(frag, h('p', { class: 'notice' }, isIOS() && !isStandalone()
        ? 'On iPhone/iPad: tap Share → “Add to Home Screen”, open Park Pulse from the home screen, then come back here to turn notifications on.'
        : 'This browser can’t receive push notifications. Alerts still pop up while the app is open.'));
      return frag;
    }
    if (!S.push) {
      add(frag, h('div', { class: 'card push-card' },
        h('p', null, 'Get ride alerts, show reminders, booking reminders and a morning brief — even with Park Pulse closed.'),
        h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn primary', onclick: enablePush }, 'Turn on notifications'))));
      return frag;
    }
    const pr = S.push.status?.prefs || {};
    const labels = [['alerts', '🔔 Ride alerts'], ['shows', '✨ Show reminders (★ shows)'], ['bookings', '📅 Booking reminders'], ['brief', '☀️ Morning brief'], ['lastchance', '⏳ Last chance before closing']];
    add(frag, h('div', { class: 'card push-card' },
      h('p', { class: 'spark-lbl' }, `On · ${S.push.status?.alerts ?? 0} ride alert(s) synced${S.push.status?.lastOk ? ` · last delivered ${ago(S.push.status.lastOk)}` : ''}`),
      h('div', { class: 'qtypes' }, labels.map(([k, l]) => chip(l, pr[k] !== false, () => setPushPref(k, pr[k] === false)))),
      h('div', { class: 'actions' },
        h('button', {
          type: 'button', class: 'btn small',
          onclick: async () => {
            try {
              const r = await api('push/test', { method: 'POST', body: { endpoint: S.push.endpoint } });
              if (r.ok) toast('Test sent — check your notifications');
              else { toast(`Push failed (HTTP ${r.code}) — running the check…`); runPushCheck(); }
            } catch (e) { toast(e.message); }
          },
        }, 'Send test'),
        h('button', { type: 'button', class: 'btn small danger', onclick: disablePush }, 'Turn off'))));
    return frag;
  }

  // --------------------------------------------------------------- party

  S.share = store.get('share', false);
  S.partyState = null;
  let shareTimer = null;
  let partyTimer = null;
  let planTimer = null;

  const myName = () => S.me?.user?.name || S.boot?.user?.name || store.get('nick', '');

  function askNick(then) {
    const dlg = $('#sheet');
    const input = h('input', { type: 'text', maxlength: '40', required: true, placeholder: 'e.g. Sam', value: store.get('nick', '') });
    dlg.replaceChildren(h('form', {
      method: 'dialog',
      onsubmit: (e) => { e.preventDefault(); store.set('nick', input.value.trim()); closeSheet(); then(); },
    }, h('h2', null, 'Your name on the map'), h('label', null, 'Shown to your party', input),
    h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: closeSheet }, 'Cancel'), h('button', { type: 'submit', class: 'btn primary' }, 'OK'))));
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    input.focus();
  }

  async function shareTick() {
    if (!S.share || !S.geo) return;
    try {
      S.partyState = await api('party/location', { method: 'POST', body: { device: deviceId(), name: myName() || 'Someone', lat: S.geo.lat, lng: S.geo.lng, acc: S.geo.acc } });
      if (S.tab === 'map') renderView();
    } catch { /* offline */ }
  }

  function setSharing(on) {
    if (on && !myName()) { askNick(() => setSharing(true)); return; }
    S.share = on;
    store.set('share', on);
    clearInterval(shareTimer);
    if (on) {
      startGeo();
      shareTimer = setInterval(shareTick, 60000);
      setTimeout(shareTick, 1500);
      toast('Sharing your location with the party');
    } else {
      api('party/stop', { method: 'POST', body: { device: deviceId() } }).then((st) => { S.partyState = st; renderView(); }).catch(() => {});
      if (S.tab !== 'map') stopGeo();
      toast('Location sharing off');
    }
    renderToolbar();
  }

  async function loadParty() {
    try {
      S.partyState = await api('party');
      if (S.tab === 'map') renderView();
    } catch { /* offline */ }
  }

  function startPartyPolling() {
    clearInterval(partyTimer);
    loadParty();
    partyTimer = setInterval(() => { if (S.tab === 'map' && document.visibilityState === 'visible') loadParty(); }, 30000);
  }

  /** The day plan is shared by the whole party — whoever set it last, everyone sees it. */
  async function loadPlan() {
    try {
      const { plan } = await api('plan');
      S.plan = plan;
      store.set('plan', plan);
      if (S.tab === 'trip' || S.tab === 'now') renderView();
    } catch { /* keep cached */ }
  }

  function startPlanPolling() {
    clearInterval(planTimer);
    loadPlan();
    planTimer = setInterval(() => { if (S.tab === 'trip' && document.visibilityState === 'visible') loadPlan(); }, 30000);
  }

  function partyPlaces() {
    const out = [];
    const me = deviceId();
    for (const p of S.partyState?.people || []) {
      if (p.device === me) continue;
      out.push({ id: 'person-' + p.device, kind: 'person', it: { name: p.name, ts: p.ts }, park: null, lat: p.lat, lng: p.lng });
    }
    const m = S.partyState?.meet;
    if (m) out.push({ id: 'meet', kind: 'meet', it: { name: m.label || 'Meet here', by: m.by, ts: m.ts }, park: null, lat: m.lat, lng: m.lng });
    return out;
  }

  async function setMeet(lat, lng, label) {
    try {
      S.partyState = await api('meet', { method: 'POST', body: { lat, lng, label, by: myName() } });
      toast('📌 Meet-up pin set for everyone');
      renderView();
    } catch (e) { toast(e.message); }
  }

  async function clearMeet() {
    try { S.partyState = await api('meet', { method: 'DELETE' }); renderView(); } catch (e) { toast(e.message); }
  }

  // ------------------------------------------------------------ what3words
  // Session-only memory (what3words' licence restricts storing addresses).
  const w3wMemo = new Map();

  async function w3wFor(lat, lng) {
    const k = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    if (w3wMemo.has(k)) return w3wMemo.get(k);
    const r = await api(`w3w?lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}`);
    w3wMemo.set(k, r);
    return r;
  }

  /** Inline "/// words" control: tap to look up, then copy / share / open in what3words. */
  function w3wControl(lat, lng, label) {
    if (!S.boot?.w3w) return null;
    const box = h('div', { class: 'w3w' });
    const show = (r) => fill(box,
      h('span', { class: 'w3w-words' }, h('b', null, '///'), r.words),
      h('button', {
        type: 'button', class: 'btn small',
        onclick: async () => { try { await navigator.clipboard.writeText('///' + r.words); toast('Copied ///' + r.words); } catch { toast('///' + r.words); } },
      }, 'Copy'),
      navigator.share ? h('button', {
        type: 'button', class: 'btn small',
        onclick: () => navigator.share({ title: label || 'Meet here', text: `${label ? label + ': ' : ''}///${r.words}`, url: r.map }).catch(() => {}),
      }, 'Share') : null,
      h('a', { class: 'btn small', href: r.map, target: '_blank', rel: 'noopener' }, 'Open'));
    const k = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    if (w3wMemo.has(k)) show(w3wMemo.get(k));
    else {
      add(box, h('button', {
        type: 'button', class: 'btn small w3w-get',
        onclick: async (e) => {
          e.target.disabled = true;
          e.target.textContent = '/// …';
          try { show(await w3wFor(lat, lng)); } catch (err) { e.target.disabled = false; e.target.textContent = '/// what3words'; toast(err.message); }
        },
      }, '/// what3words'));
    }
    return box;
  }

  function openMyW3w() {
    if (!S.geo) { toast('Waiting for your location…'); startGeo(); return; }
    const dlg = $('#sheet');
    dlg.replaceChildren(h('form', { method: 'dialog', onsubmit: (e) => { e.preventDefault(); closeSheet(); } },
      h('h2', null, '/// Where I am'),
      h('p', { class: 'spark-lbl' }, `Accuracy ±${Math.round(S.geo.acc)} m — each what3words square is 3 m × 3 m.`),
      w3wControl(S.geo.lat, S.geo.lng, `${myName() || 'I'}’m here`),
      h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'btn primary' }, 'Close'))));
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  }

  // --------------------------------------------------------- offline map

  const OFFLINE_BOX = [48.862, 2.770, 48.877, 2.799]; // parks + Village + hotels
  function tileUrlsForBox(tpl, [s, w, n, e], zooms) {
    const urls = [];
    const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
    const lat2y = (lat, z) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z); };
    for (const z of zooms) {
      for (let x = lon2x(w, z); x <= lon2x(e, z); x++) {
        for (let y = lat2y(n, z); y <= lat2y(s, z); y++) {
          urls.push(tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y).replace('{s}', 'abc'[(x + y) % 3]));
        }
      }
    }
    return urls;
  }

  async function openOfflineSheet() {
    const tpl = S.boot.map?.tiles || '';
    const osm = /tile\.openstreetmap\.org/.test(tpl);
    let count = 0;
    try { count = (await (await caches.open('park-pulse-tiles-v2')).keys()).length; } catch { /* no cache API */ }
    const dlg = $('#sheet');
    const urls = tileUrlsForBox(tpl, OFFLINE_BOX, [15, 16, 17, 18]);
    dlg.replaceChildren(h('form', { method: 'dialog', onsubmit: (e) => { e.preventDefault(); closeSheet(); } },
      h('h2', null, '⬇ Offline map'),
      h('p', null, `${count} map tiles saved on this phone. Every tile you look at is kept automatically, so the map keeps working in queues with no signal.`),
      osm
        ? h('p', { class: 'notice' }, 'OpenStreetMap’s tile servers don’t allow bulk downloads, so there’s no “download all” here. Tip: on Wi-Fi before the trip, open the Map and zoom around both parks and the Village once — that’s it.')
        : h('div', { class: 'actions' }, h('button', {
          type: 'button', class: 'btn primary',
          onclick: async () => {
            const reg = await navigator.serviceWorker?.ready;
            if (!reg?.active) { toast('Offline support isn’t ready yet — reload and try again'); return; }
            reg.active.postMessage({ type: 'prefetch-tiles', urls });
            toast(`Saving ${urls.length} tiles…`);
            closeSheet();
          },
        }, `Save the whole resort (${urls.length} tiles)`)),
      h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'btn' }, 'Close'))));
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  }

  // ------------------------------------------------------------ wrapped

  /** `trip` is the visit these rides belong to, or null for every visit together. */
  function wrappedCard(log, watched, trip, places = [], characters = []) {
    if (!log.length) return null;
    const count = (arr) => arr.reduce((m, k) => m.set(k, (m.get(k) || 0) + 1), new Map());
    const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    const queued = log.reduce((n, l) => n + (l.wait || 0), 0);
    const waits = log.filter((l) => l.wait != null);
    const longest = waits.slice().sort((a, b) => b.wait - a.wait)[0];
    const most = top(count(log.map((l) => l.name)));
    const days = count(log.map((l) => l.day));
    const bestDay = top(days);
    const people = count(log.filter((l) => l.by).map((l) => l.by));
    const unique = new Set(log.map((l) => l.entityId)).size;
    const hours = log.map((l) => parkHour(l.riddenAt * 1000) * 60 + new Date(l.riddenAt * 1000).getMinutes());
    const fmtMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const sr = log.filter((l) => l.queueType === 'SINGLE_RIDER').length;
    const pa = log.filter((l) => l.queueType === 'PREMIER_ACCESS').length;
    const topShow = showTally(watched)[0];
    const timed = waits.filter((l) => l.posted != null);
    const { met, seen } = characterTally(characters);
    const placeLine = (kind, icon, word, suffix = '') => {
      const tally = showTally(places.filter((p) => p.kind === kind));
      return tally.length ? h('li', null, `${icon} ${plural(tally.length, word)}${suffix} · top: `, h('b', null, tally[0][0]), tally[0][1] > 1 ? ` ×${tally[0][1]}` : '') : null;
    };
    const tile = (big, label) => h('div', { class: 'wr-tile' }, h('b', null, big), h('span', null, label));
    const card = h('section', { class: 'card wrapped' },
      h('h2', null, !trip ? '✨ All visits' : today() > trip.end ? '🎉 Trip Wrapped' : '✨ Trip so far'),
      h('div', { class: 'wr-grid' },
        tile(String(log.length), `rides (${unique} different)`),
        tile(queued >= 60 ? `${Math.floor(queued / 60)}h ${queued % 60}m` : `${queued}m`, 'spent queuing'),
        tile(waits.length ? `${Math.round(queued / waits.length)}m` : '–', 'average wait'),
        tile(bestDay ? String(bestDay[1]) : '–', bestDay ? `rides on ${dayLabel(bestDay[0])}` : 'best day')),
      h('ul', { class: 'wr-list' },
        most ? h('li', null, `🔁 Most ridden: `, h('b', null, most[0]), ` ×${most[1]}`) : null,
        longest ? h('li', null, `⏳ Longest queue: `, h('b', null, `${longest.wait} min`), ` for ${longest.name}`) : null,
        hours.length ? h('li', null, `🌅 Earliest ride ${fmtMin(Math.min(...hours))} · 🌙 latest ${fmtMin(Math.max(...hours))}`) : null,
        timed.length ? h('li', null, `⏱ Timed queues: `, h('b', null, `${Math.round(timed.reduce((n, l) => n + l.wait, 0) / timed.length)} min`), ` on average, the sign said ${Math.round(timed.reduce((n, l) => n + l.posted, 0) / timed.length)} (${plural(timed.length, 'queue')})`) : null,
        sr || pa ? h('li', null, [sr ? `🧍 ${sr} single-rider` : null, pa ? `⚡ ${pa} Premier Access` : null].filter(Boolean).join(' · ')) : null,
        topShow ? h('li', null, `🎭 ${plural(watched.length, 'show')} watched · top: `, h('b', null, topShow[0]), topShow[1] > 1 ? ` ×${topShow[1]}` : '') : null,
        placeLine('food', '🍽', 'place'),
        placeLine('shop', '🛍', 'shop'),
        placeLine('browse', '👀', 'shop', ' perused'),
        met.length || seen.length ? h('li', null, `🤝 ${[met.length ? `${plural(met.length, 'character')} met` : null, seen.length ? `${met.length ? seen.length : plural(seen.length, 'character')} seen` : null].filter(Boolean).join(', ')}`,
          met[0]?.[1] > 1 ? [' · top: ', h('b', null, met[0][0]), ` ×${met[0][1]}`] : null) : null,
        people.size > 1 ? h('li', null, '🏆 ', [...people.entries()].sort((a, b) => b[1] - a[1]).map(([n, c], i) => `${['🥇', '🥈', '🥉'][i] || ''}${n} ${c}`).join(' · ')) : null));
    return card;
  }

  // Badges: every rule runs on what the app holds (ride log + /api/wrapped). A rule returns
  // evidence text when earned, null when not. `needs` names data that may be missing, so a
  // badge can say "not enough data" rather than pretend it wasn't earned.

  const haversine = (a, b) => {
    const r = (d) => (d * Math.PI) / 180;
    const x = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(x)); // km
  };
  const minuteOfDay = (ms) => parkHour(ms) * 60 + Number(fmt({ minute: 'numeric' }).format(new Date(ms)));
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  /** A person's rides, oldest first, each with its ride facts, land and sign/stoppage data. */
  function wrappedPerson(rows, ctx, { others = [], earlier = [], meets = [] } = {}) {
    const cat = new Map();
    for (const c of ctx?.catalog || []) { cat.set(c.id, c); cat.set(c.name, c); }
    const rides = rows.slice().sort((a, b) => a.riddenAt - b.riddenAt).map((l) => {
      const c = cat.get(l.entityId) || cat.get(l.name) || null;
      const info = c?.info || null;
      const mins = info?.mins ?? 5;
      return {
        ...l,
        cat: c,
        info,
        land: c?.land || null,
        spent: (l.wait || 0) + mins,
        at: l.riddenAt * 1000,
        posted: l.posted ?? ctx?.rides?.[l.id]?.posted ?? null, // the queue timer read the sign itself
        stopped: !!ctx?.rides?.[l.id]?.stopped,
        paIn: ctx?.rides?.[l.id]?.paIn ?? null,
        nearby: ctx?.rides?.[l.id]?.nearby ?? null,
      };
    });
    const byDay = new Map();
    for (const r of rides) {
      if (!byDay.has(r.day)) byDay.set(r.day, []);
      byDay.get(r.day).push(r);
    }
    const counts = new Map();
    for (const r of rides) counts.set(r.name, (counts.get(r.name) || 0) + 1);

    const legs = [];
    for (const list of byDay.values()) {
      for (let i = 1; i < list.length; i++) {
        const a = list[i - 1].cat;
        const b = list[i].cat;
        if (a?.lat != null && b?.lat != null) legs.push({ km: haversine(a, b), park: b.park, same: a.park === b.park });
      }
    }
    const walkedKm = legs.reduce((n, l) => n + l.km, 0) * 1.3; // paths aren't straight lines

    const landTime = new Map();
    for (const r of rides) if (r.land) landTime.set(r.land, (landTime.get(r.land) || 0) + r.spent);
    const landTotal = [...landTime.values()].reduce((a, b) => a + b, 0);
    const lands = [...landTime.entries()].map(([land, m]) => ({ land, pct: Math.round((m / landTotal) * 100) })).sort((a, b) => b.pct - a.pct);

    const metNames = new Map();
    for (const m of meets) {
      const key = normName(m.name);
      metNames.set(key, { name: m.name, n: (metNames.get(key)?.n || 0) + 1 });
    }

    return { rides, byDay, counts, legs, walkedKm, lands, others, earlier, meets, metNames, top: [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || null };
  }

  /** 0–100 for one ride: drops, speed and inversions, or its intensity rating if the stats aren't known. */
  function rideThrill(info) {
    if (!info) return null;
    const raw = (info.drop || 0) + (info.speed || 0) * 0.6 + (info.inversions || 0) * 15;
    const floor = { 1: 5, 2: 20, 3: 45 }[info.thrill] ?? 5;
    return Math.min(100, Math.round(Math.max(raw, floor)));
  }

  const THRILL_LABELS = [
    [15, 'Gentle Boat Enjoyer'],
    [28, 'Teacup Tourist'],
    [42, 'Scenic Route Regular'],
    [56, 'Coaster Curious'],
    [72, 'Loop Seeker'],
    [101, 'Adrenaline Goblin'],
  ];

  function thrillScore(person) {
    const scored = person.rides.map((r) => ({ r, t: rideThrill(r.info) })).filter((x) => x.t != null);
    if (!scored.length) return null;
    const score = Math.round(scored.reduce((n, x) => n + x.t, 0) / scored.length);
    const peak = scored.slice().sort((a, b) => b.t - a.t)[0].r;
    return { score, label: THRILL_LABELS.find(([max]) => score < max)[1], peak };
  }

  function darkestDay(person) {
    let best = null;
    for (const [day, list] of person.byDay) {
      if (list.length < 2) continue;
      const all = list.reduce((n, r) => n + r.spent, 0);
      const dark = list.filter((r) => r.info?.dark).reduce((n, r) => n + r.spent, 0);
      if (dark && (!best || dark / all > best.share)) best = { day, share: dark / all };
    }
    return best;
  }

  const BADGE_CATS = [
    ['timing', 'Timing'], ['queues', 'Queues'], ['habits', 'Ride habits'], ['thrill', 'Thrill level'],
    ['weather', 'Weather & conditions'], ['planning', 'Planning'], ['movement', 'Movement'], ['characters', 'Characters'],
  ];

  function dayHoursFor(ctx, r) {
    const hrs = ctx?.hours?.[r.park]?.[r.day];
    return hrs ? { open: Date.parse(hrs.open), close: Date.parse(hrs.close) } : null;
  }

  /** The person's progress on the saved plan, when they rode anything that day. */
  function planProgress(person, ctx) {
    const plan = ctx?.plan;
    if (!plan) return null;
    const planned = (plan.items || []).filter((i) => i.kind === 'ride' && i.id);
    const onDay = person.byDay.get(plan.date);
    if (planned.length < 3 || !onDay) return null;
    const done = planned.filter((i) => onDay.some((r) => r.entityId === i.id));
    const missed = planned.filter((i) => !onDay.some((r) => r.entityId === i.id));
    return { plan, planned, done, missed, onDay, share: done.length / planned.length };
  }

  const BADGES = [
    // ---- timing
    { id: 'rope-drop', cat: 'timing', icon: '🌅', name: 'Rope Drop Warrior', how: 'First ride within 10 min of park opening.', needs: 'hours', test: (p, ctx) => {
      for (const list of p.byDay.values()) {
        const r = list[0];
        const hrs = dayHoursFor(ctx, r);
        if (hrs && r.at <= hrs.open + (10 + (r.info?.mins ?? 5)) * 60000) return `${r.name} at ${fmtClock(minuteOfDay(r.at))}, ${dayLabel(r.day)}`;
      }
      return null;
    } },
    { id: 'night-owl', cat: 'timing', icon: '🦉', name: 'Night Owl', how: 'A ride in the final 15 min before close.', needs: 'hours', test: (p, ctx) => {
      for (const r of p.rides) {
        const hrs = dayHoursFor(ctx, r);
        if (hrs && r.at >= hrs.close - 15 * 60000 && r.at <= hrs.close + 30 * 60000) return `${r.name} at ${fmtClock(minuteOfDay(r.at))}, ${dayLabel(r.day)}`;
      }
      return null;
    } },
    { id: 'open-close', cat: 'timing', icon: '🏰', name: 'Open to Close', how: 'Rides within an hour of both opening and closing on one day.', needs: 'hours', test: (p, ctx) => {
      for (const [day, list] of p.byDay) {
        const first = dayHoursFor(ctx, list[0]);
        const last = dayHoursFor(ctx, list[list.length - 1]);
        if (first && last && list[0].at <= first.open + 3600000 && list[list.length - 1].at >= last.close - 3600000) return `${fmtClock(minuteOfDay(list[0].at))}–${fmtClock(minuteOfDay(list[list.length - 1].at))}, ${dayLabel(day)}`;
      }
      return null;
    } },
    { id: 'early-exit', cat: 'timing', icon: '🛌', name: 'Early Exit', how: 'Last ride of the day before 14:00. Naps are valid.', test: (p) => {
      for (const [day, list] of p.byDay) {
        const end = minuteOfDay(list[list.length - 1].at);
        if (end < 840) return `Done by ${fmtClock(end)} on ${dayLabel(day)}. Well rested.`;
      }
      return null;
    } },
    { id: 'golden-hour', cat: 'timing', icon: '🌇', name: 'Golden Hour', how: 'A ride logged around sunset.', needs: 'weather', test: (p, ctx) => {
      for (const r of p.rides) {
        const m = /T(\d\d):(\d\d)/.exec(ctx.weather.days?.[r.day]?.sunset || '');
        if (!m) continue;
        const sunset = Number(m[1]) * 60 + Number(m[2]);
        const at = minuteOfDay(r.at);
        if (at >= sunset - 30 && at <= sunset + 15) return `${r.name}, sunset at ${m[1]}:${m[2]} on ${dayLabel(r.day)}`;
      }
      return null;
    } },
    // ---- queues
    { id: 'walk-on', cat: 'queues', icon: '🪄', name: 'Walk-On Wizard', how: 'A queue of under 5 min.', test: (p) => {
      const r = p.rides.find((x) => x.wait != null && x.wait < 5 && x.queueType !== 'PREMIER_ACCESS');
      return r ? `${r.wait} min for ${r.name}` : null;
    } },
    { id: 'patience', cat: 'queues', icon: '😇', name: 'Patience of a Saint', how: 'A single wait of 90+ min.', test: (p) => {
      const r = p.rides.filter((x) => x.wait >= 90).sort((a, b) => b.wait - a.wait)[0];
      return r ? `${r.wait} min for ${r.name}` : null;
    } },
    { id: 'sign-lied', cat: 'queues', icon: '🪧', name: 'The Sign Lied', how: 'Queued 15+ min less than the sign said.', needs: 'posted', test: (p) => {
      const r = p.rides.filter((x) => x.queueType === 'STANDBY' && x.wait != null && x.posted != null && x.posted - x.wait >= 15).sort((a, b) => (b.posted - b.wait) - (a.posted - a.wait))[0];
      return r ? `${r.name}: sign said ${r.posted}, took ${r.wait}` : null;
    } },
    { id: 'betrayed', cat: 'queues', icon: '🗡️', name: 'Betrayed by the Sign', how: 'Queued 15+ min longer than the sign said.', needs: 'posted', test: (p) => {
      const r = p.rides.filter((x) => x.queueType === 'STANDBY' && x.wait != null && x.posted != null && x.wait - x.posted >= 15).sort((a, b) => (b.wait - b.posted) - (a.wait - a.posted))[0];
      return r ? `${r.name}: sign said ${r.posted}, took ${r.wait}` : null;
    } },
    { id: 'queue-dodger', cat: 'queues', icon: '💨', name: 'Queue Dodger', how: 'Queued for under 25% of your time in the park (first ride to last).', test: (p) => {
      let queued = 0;
      let span = 0;
      for (const list of p.byDay.values()) {
        if (list.length < 3) continue;
        queued += list.reduce((n, r) => n + (r.wait || 0), 0);
        span += (list[list.length - 1].at - list[0].at) / 60000 + (list[0].wait || 0);
      }
      return span >= 120 && queued / span < 0.25 ? `Only ${Math.round((queued / span) * 100)}% of park time in a queue` : null;
    } },
    { id: 'line-skipper', cat: 'queues', icon: '⚡', name: 'Line Skipper', how: 'Used 3+ Premier Access passes.', test: (p) => {
      const n = p.rides.filter((r) => r.queueType === 'PREMIER_ACCESS').length;
      return n >= 3 ? `${n} Premier Access rides` : null;
    } },
    // ---- ride habits
    { id: 'same-again', cat: 'habits', icon: '🔂', name: 'Same Again', how: 'Rode one attraction 3+ times.', test: (p) => (p.top?.[1] >= 3 ? `${p.top[0]} ×${p.top[1]}` : null) },
    { id: 'cant-stop', cat: 'habits', icon: '🎰', name: 'Can’t Stop, Won’t Stop', how: 'Rode one attraction 5+ times.', test: (p) => (p.top?.[1] >= 5 ? `${p.top[0]} ×${p.top[1]}` : null) },
    { id: 'back-to-back', cat: 'habits', icon: '⏮️', name: 'Back-to-Back', how: 'Re-rode straight after getting off.', test: (p) => {
      for (const list of p.byDay.values()) {
        for (let i = 1; i < list.length; i++) if (list[i].entityId === list[i - 1].entityId) return `${list[i].name}, ${dayLabel(list[i].day)}`;
      }
      return null;
    } },
    { id: 'completionist', cat: 'habits', icon: '✅', name: 'Completionist', how: 'Every open ride in one land.', needs: 'catalog', test: (p, ctx) => {
      const done = new Set(p.rides.map((r) => r.entityId));
      const lands = new Map();
      for (const c of ctx.catalog) {
        if (c.land && c.ran) {
          if (!lands.has(c.land)) lands.set(c.land, []);
          lands.get(c.land).push(c.id);
        }
      }
      for (const [land, ids] of lands) if (ids.length >= 2 && ids.every((id) => done.has(id))) return `All ${ids.length} rides in ${land}`;
      return null;
    } },
    { id: 'park-sweep', cat: 'habits', icon: '👑', rare: true, name: 'Full Park Sweep', how: 'Every open ride in a whole park.', needs: 'catalog', test: (p, ctx) => {
      const done = new Set(p.rides.map((r) => r.entityId));
      for (const park of S.boot.parks) {
        const ids = ctx.catalog.filter((c) => c.park === park.key && c.ran).map((c) => c.id);
        if (ids.length && ids.every((id) => done.has(id))) return `All ${ids.length} rides in ${park.name}`;
      }
      return null;
    } },
    { id: 'variety', cat: 'habits', icon: '🎁', name: 'Variety Pack', how: '10+ different rides.', test: (p) => (p.counts.size >= 10 ? `${p.counts.size} different rides` : null) },
    { id: 'front-row', cat: 'habits', icon: '🎢', name: 'Front Row', how: 'Tick “Front row” when logging a ride.', test: (p) => {
      const r = p.rides.find((x) => /front[\s-]*row/i.test(x.note || ''));
      return r ? `${r.name}, ${dayLabel(r.day)}` : null;
    } },
    // ---- thrill
    { id: 'gentle-soul', cat: 'thrill', icon: '🕊️', name: 'Gentle Soul', how: 'Only low-intensity rides all day (3+ rides).', needs: 'catalog', test: (p) => {
      for (const [day, list] of p.byDay) {
        if (list.length >= 3 && list.every((r) => r.info?.thrill === 1)) return `${list.length} gentle rides on ${dayLabel(day)}`;
      }
      return null;
    } },
    { id: 'goblin', cat: 'thrill', icon: '👹', name: 'Adrenaline Goblin', how: '5+ high-thrill rides.', needs: 'catalog', test: (p) => {
      const n = p.rides.filter((r) => r.info?.thrill === 3).length;
      return n >= 5 ? `${n} high-thrill rides` : null;
    } },
    { id: 'upside-down', cat: 'thrill', icon: '🙃', name: 'Upside Down', how: 'Rode something with an inversion.', needs: 'catalog', test: (p) => {
      const r = p.rides.find((x) => x.info?.inversions > 0);
      return r ? `${r.name}, ${plural(r.info.inversions, 'inversion')}` : null;
    } },
    { id: 'brave-face', cat: 'thrill', icon: '😬', name: 'Brave Face', how: 'First high-thrill ride on record in the app.', needs: 'catalog', test: (p) => {
      const r = p.rides.find((x) => x.info?.thrill === 3);
      return r ? `${r.name}, ${dayLabel(r.day)}` : null;
    } },
    // ---- weather
    { id: 'rain', cat: 'weather', icon: '☔', name: 'Rain Survivor', how: 'Rode while it was raining.', needs: 'weather', test: (p, ctx) => {
      const wet = new Set(ctx.weather.rainHours || []);
      const r = p.rides.find((x) => wet.has(`${x.day}T${String(parkHour(x.at)).padStart(2, '0')}:00`));
      return r ? `${r.name} in the rain, ${dayLabel(r.day)}` : null;
    } },
    { id: 'drenched', cat: 'weather', icon: '🌊', name: 'Drenched', how: '3+ water rides.', needs: 'catalog', test: (p) => {
      const n = p.rides.filter((r) => r.info?.wet).length;
      return n >= 3 ? `${n} water rides` : null;
    } },
    { id: 'heatwave', cat: 'weather', icon: '🥵', name: 'Heatwave Hero', how: 'A park day over 30°C.', needs: 'weather', test: (p, ctx) => {
      for (const day of p.byDay.keys()) {
        const t = ctx.weather.days?.[day]?.max;
        if (t > 30) return `${Math.round(t)}°C on ${dayLabel(day)}`;
      }
      return null;
    } },
    { id: 'breakdown', cat: 'weather', icon: '🛠️', name: 'Breakdown Veteran', how: 'A ride went down while you were queuing for it or on it.', needs: 'posted', test: (p) => {
      const r = p.rides.find((x) => x.stopped);
      return r ? `${r.name} stopped, ${dayLabel(r.day)}` : null;
    } },
    // ---- planning
    { id: 'plan-done', cat: 'planning', icon: '📋', name: 'Plan Executed', how: '90%+ of the rides on the saved plan.', needs: 'plan', test: (p, ctx) => {
      const prog = planProgress(p, ctx);
      return prog && prog.share >= 0.9 ? `${prog.done.length} of ${prog.planned.length} planned rides` : null;
    } },
    { id: 'chaos', cat: 'planning', icon: '🌪️', name: 'Chaos Agent', how: 'Under 50% of the rides on the saved plan.', needs: 'plan', test: (p, ctx) => {
      const prog = planProgress(p, ctx);
      return prog && prog.share < 0.5 ? `${prog.done.length} of ${prog.planned.length} planned rides. Plans are for other people.` : null;
    } },
    { id: 'pivot', cat: 'planning', icon: '🔀', name: 'Pivot Master', how: 'Rode the plan in a different order and queued 30+ min less than it predicted.', needs: 'plan', test: (p, ctx) => {
      const prog = planProgress(p, ctx);
      if (!prog) return null;
      const order = new Map(prog.planned.map((i, n) => [i.id, n]));
      const seen = prog.onDay.filter((r) => order.has(r.entityId));
      const reordered = seen.some((r, n) => n > 0 && order.get(r.entityId) < order.get(seen[n - 1].entityId));
      const predicted = prog.done.reduce((n, i) => n + (i.wait || 0), 0);
      const actual = seen.reduce((n, r) => n + (r.wait || 0), 0);
      return reordered && predicted - actual >= 30 ? `Saved about ${predicted - actual} min against the plan` : null;
    } },
    { id: 'backtracker', cat: 'planning', icon: '↩️', name: 'Backtracker', how: 'Crossed a park end to end 3+ times between rides.', needs: 'catalog', test: (p, ctx) => {
      const span = new Map();
      for (const park of S.boot.parks) {
        const pts = ctx.catalog.filter((c) => c.park === park.key && c.lat != null);
        let max = 0;
        for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) max = Math.max(max, haversine(pts[i], pts[j]));
        span.set(park.key, max);
      }
      const n = p.legs.filter((l) => l.same && span.get(l.park) && l.km >= span.get(l.park) * 0.65).length;
      return n >= 3 ? `${n} trips across the park` : null;
    } },
    // ---- movement (estimated: the app has no step counter)
    { id: 'marathoner', cat: 'movement', icon: '👟', name: 'Marathoner', how: '20,000+ steps, estimated from the walks between your rides.', needs: 'catalog', test: (p) => {
      const steps = Math.round(p.walkedKm * 1312);
      return steps >= 20000 ? `About ${steps.toLocaleString('en-GB')} steps (estimated)` : null;
    } },
    { id: 'half-marathon', cat: 'movement', icon: '🏅', name: 'Half Marathon', how: '21 km, estimated from the walks between your rides.', needs: 'catalog', test: (p) => (p.walkedKm >= 21 ? `About ${Math.round(p.walkedKm)} km (estimated)` : null) },
    { id: 'homebody', cat: 'movement', icon: '🏡', name: 'Homebody', how: '60%+ of your ride time in one land.', needs: 'catalog', test: (p) => (p.rides.length >= 4 && p.lands[0]?.pct >= 60 ? `${p.lands[0].pct}% in ${p.lands[0].land}` : null) },
    // ---- characters
    { id: 'first-hello', cat: 'characters', icon: '👋', name: 'First Hello', how: 'Met your first character.', test: (p) => (p.meets.length ? `${p.meets[p.meets.length - 1].name}, ${dayLabel(p.meets[p.meets.length - 1].day)}` : null) },
    { id: 'autograph-hunter', cat: 'characters', icon: '✍️', name: 'Autograph Hunter', how: 'Met 5 different characters.', test: (p) => (p.metNames.size >= 5 ? `${p.metNames.size} different characters` : null) },
    { id: 'superfan', cat: 'characters', icon: '🌟', rare: true, name: 'Superfan', how: 'Met 15 different characters.', test: (p) => (p.metNames.size >= 15 ? `${p.metNames.size} different characters` : null) },
    { id: 'fab-five', cat: 'characters', icon: '🐭', name: 'The Fab Five', how: 'Met Mickey, Minnie, Donald, Goofy and Pluto.', test: (p) => (['mickey mouse', 'minnie mouse', 'donald duck', 'goofy', 'pluto'].every((n) => p.metNames.has(n)) ? 'The whole gang' : null) },
    { id: 'besties', cat: 'characters', icon: '💞', name: 'Besties', how: 'Met the same character 3 times.', test: (p) => {
      const best = [...p.metNames.values()].sort((a, b) => b.n - a.n)[0];
      return best?.n >= 3 ? `${best.name} ×${best.n}` : null;
    } },
    { id: 'say-cheese', cat: 'characters', icon: '📸', name: 'Say Cheese', how: 'Saved 3 photos with characters.', test: (p) => {
      const n = p.meets.filter((m) => m.photo).length;
      return n >= 3 ? plural(n, 'photo') : null;
    } },
  ];

  // Roast badges: played after the positive ones, opt-out per person. `quip` is the card's punchline.
  // `untracked` = the app never recorded this, so it can't be earned on this trip.

  const ROAST_CATS = [
    ['r-queue', 'Queue shame'], ['r-plan', 'Planning disasters'], ['r-commit', 'Commitment issues'], ['r-time', 'Timing crimes'],
    ['r-snack', 'Snack sins'], ['r-weather', 'Weather fails'], ['r-ride', 'Ride obsession'], ['r-group', 'Group roasts'],
  ];

  /** Minutes with nothing logged before each ride of a day, after allowing for its queue and ride time. */
  function dayGaps(list) {
    const out = [];
    for (let i = 1; i < list.length; i++) {
      const start = list[i].at - ((list[i].wait || 0) + (list[i].info?.mins ?? 5)) * 60000;
      out.push({ from: list[i - 1], to: list[i], start, mins: Math.round((start - list[i - 1].at) / 60000) });
    }
    return out;
  }

  function parkCrossings(p, ctx) {
    const span = new Map();
    for (const park of S.boot.parks) {
      const pts = ctx.catalog.filter((c) => c.park === park.key && c.lat != null);
      let max = 0;
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) max = Math.max(max, haversine(pts[i], pts[j]));
      span.set(park.key, max);
    }
    return p.legs.filter((l) => l.same && span.get(l.park) && l.km >= span.get(l.park) * 0.65).length;
  }

  const ROASTS = [
    // ---- queue shame
    { id: 'pro-queuer', cat: 'r-queue', icon: '🧍', name: 'Professional Queuer', how: 'At least 10× more time queuing than riding.', quip: 'You came for the rides. You stayed for the railings.', test: (p) => {
      const queued = p.rides.reduce((n, r) => n + (r.wait || 0), 0);
      const riding = p.rides.reduce((n, r) => n + (r.info?.mins ?? 5), 0);
      return queued >= 60 && queued >= riding * 10 ? `${queued} min queuing, ${riding} min riding` : null;
    } },
    { id: 'fell-for-it', cat: 'r-queue', icon: '🎣', name: 'Fell for It', how: 'Waited 60+ min for a ride under 3 min long.', needs: 'catalog', quip: 'All that for under 3 minutes. Iconic.', test: (p) => {
      const r = p.rides.filter((x) => x.wait >= 60 && x.info && x.info.mins < 3).sort((a, b) => b.wait - a.wait)[0];
      return r ? `${r.wait} min for ${r.name}` : null;
    } },
    { id: 'sunk-cost', cat: 'r-queue', icon: '⚓', name: 'Sunk Cost Champion', how: 'Stayed in a queue that ran 30+ min over the posted time.', needs: 'posted', quip: 'You’d come this far. Sadly, so had everyone else.', test: (p) => {
      const r = p.rides.filter((x) => x.queueType === 'STANDBY' && x.wait != null && x.posted != null && x.wait - x.posted >= 30).sort((a, b) => (b.wait - b.posted) - (a.wait - a.posted))[0];
      return r ? `${r.name}: posted ${r.posted}, took ${r.wait}` : null;
    } },
    { id: 'wrong-line', cat: 'r-queue', icon: '🚧', name: 'Wrong Line Energy', how: 'Joined standby when a Premier Access return was 10 min away.', needs: 'posted', quip: 'Technically, that was also a line.', test: (p) => {
      const r = p.rides.find((x) => x.queueType === 'STANDBY' && x.paIn != null && x.paIn >= 0 && x.paIn <= 10 && x.wait >= 15);
      return r ? `${r.name}: ${r.wait} min standby, Premier Access return in ${r.paIn} min` : null;
    } },
    { id: 'sign-right', cat: 'r-queue', icon: '🤦', name: 'The Sign Was Right, You Were Wrong', how: 'Picked a long queue when one next to it was 30+ min shorter.', needs: 'posted', quip: 'It was right there. It was on the sign.', test: (p) => {
      const r = p.rides.find((x) => x.nearby);
      return r ? `${r.name} at ${r.posted} min, next to ${r.nearby.name} at ${r.nearby.posted}` : null;
    } },
    // ---- planning disasters
    { id: 'what-plan', cat: 'r-plan', icon: '🗑️', name: 'Plan? What Plan?', how: 'Under 25% of the rides on the saved plan.', needs: 'plan', quip: 'It was more of a mood board.', test: (p, ctx) => {
      const prog = planProgress(p, ctx);
      return prog && prog.share < 0.25 ? `${prog.done.length} of ${prog.planned.length} planned rides` : null;
    } },
    { id: 'ping-pong', cat: 'r-plan', icon: '🏓', name: 'Ping Pong Champion', how: 'Crossed a park end to end 5+ times between rides.', needs: 'catalog', quip: 'The map is free. Just saying.', test: (p, ctx) => {
      const n = parkCrossings(p, ctx);
      return n >= 5 ? `${n} trips across the park` : null;
    } },
    { id: 'toilets', cat: 'r-plan', icon: '🚽', name: 'Tour of the Toilets', how: 'Over 90 min between rides with nothing logged.', quip: 'We’re not asking. We’re just noting it.', test: (p) => {
      const g = [...p.byDay.values()].flatMap(dayGaps).sort((a, b) => b.mins - a.mins)[0];
      return g && g.mins > 90 ? `${g.mins} unexplained minutes, ${dayLabel(g.to.day)}` : null;
    } },
    { id: 'lost-again', cat: 'r-plan', icon: '🧭', name: 'Lost Again', how: 'Took 25+ min to get between rides under 200 m apart. Roughly a 2 km walk’s worth.', needs: 'catalog', quip: 'The scenic route, allegedly.', test: (p) => {
      for (const list of p.byDay.values()) {
        for (const g of dayGaps(list)) {
          const a = g.from.cat;
          const b = g.to.cat;
          if (a && b && a.id !== b.id && a.lat != null && b.lat != null && haversine(a, b) <= 0.2 && g.mins >= 25) {
            return `${g.mins} min from ${g.from.name} to ${g.to.name}, ${Math.round(haversine(a, b) * 1000)} m away`;
          }
        }
      }
      return null;
    } },
    { id: 'spreadsheet', cat: 'r-plan', icon: '📊', name: 'Ambitious Little Spreadsheet', how: 'Planned 25+ rides, did fewer than 8.', needs: 'plan', quip: 'Beautiful plan, though. Lovely columns.', test: (p, ctx) => {
      const prog = planProgress(p, ctx);
      return prog && prog.planned.length >= 25 && prog.done.length < 8 ? `${prog.planned.length} planned, ${prog.done.length} done` : null;
    } },
    // ---- commitment issues
    { id: 'chickened', cat: 'r-commit', icon: '🐔', name: 'Chickened Out', how: 'A thrill ride on the saved plan that you skipped.', needs: 'plan', quip: 'We saw nothing.', test: (p, ctx) => {
      const prog = planProgress(p, ctx);
      if (!prog) return null;
      const byId = new Map(ctx.catalog.map((c) => [c.id, c]));
      const i = prog.missed.find((x) => byId.get(x.id)?.info?.thrill === 3);
      return i ? `${i.name} was on the plan` : null;
    } },
    { id: 'chickened-twice', cat: 'r-commit', icon: '🐓', name: 'Chickened Out Twice', how: 'Queued for it, then left the queue.', untracked: 'The app has no way to log leaving a queue.', quip: 'A bold retreat.', test: () => null },
    { id: 'teacup', cat: 'r-commit', icon: '🫖', name: 'Teacup Tactician', how: 'Only gentle rides on the day you’d planned coasters.', needs: 'plan', quip: 'The coasters will understand.', test: (p, ctx) => {
      const prog = planProgress(p, ctx);
      if (!prog || prog.onDay.length < 2 || !prog.onDay.every((r) => r.info?.thrill === 1)) return null;
      const byId = new Map(ctx.catalog.map((c) => [c.id, c]));
      const planned = prog.planned.filter((x) => byId.get(x.id)?.info?.thrill === 3).length;
      return planned ? `${plural(planned, 'thrill ride')} planned, ${prog.onDay.length} gentle rides ridden` : null;
    } },
    { id: 'big-talk', cat: 'r-commit', icon: '🗣️', name: 'Big Talk', how: 'Rated a ride 1 star, then rode it again anyway.', untracked: 'The app only takes star ratings for restaurants, not rides.', quip: 'One star. Twice.', test: () => null },
    // ---- timing crimes
    { id: 'fashionably-late', cat: 'r-time', icon: '🕶️', name: 'Fashionably Late', how: 'First ride 3+ hours after opening.', needs: 'hours', quip: 'The park opens when you arrive.', test: (p, ctx) => {
      for (const [day, list] of p.byDay) {
        const hrs = dayHoursFor(ctx, list[0]);
        if (hrs && list[0].at >= hrs.open + 3 * 3600000) return `First ride at ${fmtClock(minuteOfDay(list[0].at))}, ${dayLabel(day)}`;
      }
      return null;
    } },
    { id: 'rope-fraud', cat: 'r-time', icon: '⏰', name: 'Rope Drop Fraud', how: 'The saved plan started at opening, but your first ride was after 11:00.', needs: 'plan', quip: 'The alarm did its best.', test: (p, ctx) => {
      const prog = planProgress(p, ctx);
      if (!prog) return null;
      const firstPlanned = Math.min(...prog.planned.map((i) => i.start || Infinity));
      const hrs = dayHoursFor(ctx, prog.onDay[0]);
      const firstRide = minuteOfDay(prog.onDay[0].at);
      return hrs && firstPlanned <= hrs.open + 30 * 60000 && firstRide >= 660 ? `Planned for opening, first ride at ${fmtClock(firstRide)}` : null;
    } },
    { id: 'nap', cat: 'r-time', icon: '😴', name: 'Nap Required', how: 'No rides logged for 2+ hours mid-afternoon.', quip: 'Rest is a valid ride.', test: (p) => {
      for (const list of p.byDay.values()) {
        for (const g of dayGaps(list)) {
          if (g.mins >= 120 && minuteOfDay(g.from.at) >= 720 && minuteOfDay(g.start) <= 1080) return `${fmtClock(minuteOfDay(g.from.at))}–${fmtClock(minuteOfDay(g.start))}, ${dayLabel(g.to.day)}`;
        }
      }
      return null;
    } },
    { id: 'gone-by-lunch', cat: 'r-time', icon: '🥪', name: 'Gone by Lunch', how: 'Last ride of a day before 13:00.', quip: 'A full-day ticket, used with restraint.', test: (p) => {
      for (const [day, list] of p.byDay) {
        const end = minuteOfDay(list[list.length - 1].at);
        if (end < 780) return `Last ride at ${fmtClock(end)}, ${dayLabel(day)}`;
      }
      return null;
    } },
    // ---- snack sins
    { id: 'snack-itinerary', cat: 'r-snack', icon: '🍿', name: 'Snack-Based Itinerary', how: 'More snacks logged than rides.', untracked: 'The app doesn’t log snacks.', quip: 'The rides were just the bit between snacks.', test: () => null },
    { id: 'financially-unwell', cat: 'r-snack', icon: '💸', name: 'Financially Unwell', how: 'Spent more on snacks than the ticket cost.', untracked: 'The app doesn’t log spending.', quip: 'Your bank has questions.', test: () => null },
    { id: 'churro', cat: 'r-snack', icon: '🥖', name: 'Churro Commitment', how: 'Bought the same snack 3+ times.', untracked: 'The app doesn’t log snacks.', quip: 'A loyal customer.', test: () => null },
    // ---- weather fails
    { id: 'soaked', cat: 'r-weather', icon: '🥶', name: 'Soaked and Surprised', how: 'Rode a water ride when it was under 12°C.', needs: 'weather', quip: 'Refreshing, you told everyone.', test: (p, ctx) => {
      for (const r of p.rides) {
        const t = ctx.weather.temps?.[`${r.day}T${String(parkHour(r.at)).padStart(2, '0')}:00`];
        if (r.info?.wet && t != null && t < 12) return `${r.name} at ${Math.round(t)}°C`;
      }
      return null;
    } },
    { id: 'poncho', cat: 'r-weather', icon: '🧥', name: 'Poncho Purchase', how: 'Bought a poncho on a forecast-rain day.', untracked: 'The app doesn’t log purchases.', quip: 'It was in the forecast. It was in the app.', test: () => null },
    { id: 'sunburn', cat: 'r-weather', icon: '🌞', name: 'Sunburn Speedrun', how: '6+ hours between outdoor-only rides on a high-UV day.', needs: 'weather', quip: 'Factor 50 exists.', test: (p, ctx) => {
      for (const [day, list] of p.byDay) {
        const uv = ctx.weather.days?.[day]?.uv;
        const hours = (list[list.length - 1].at - list[0].at) / 3600000;
        if (uv >= 6 && hours >= 6 && list.every((r) => r.info && r.info.where !== 'indoor')) return `${Math.round(hours)} hours outdoors at UV ${Math.round(uv)}, ${dayLabel(day)}`;
      }
      return null;
    } },
    // ---- ride obsession
    { id: 'seek-help', cat: 'r-ride', icon: '🛋️', name: 'Seek Help', how: 'The same ride 8+ times in one day.', quip: 'It’s fine. You can stop whenever you like.', test: (p) => {
      for (const [day, list] of p.byDay) {
        const c = new Map();
        for (const r of list) c.set(r.name, (c.get(r.name) || 0) + 1);
        const top = [...c.entries()].sort((a, b) => b[1] - a[1])[0];
        if (top[1] >= 8) return `${top[0]} ×${top[1]} on ${dayLabel(day)}`;
      }
      return null;
    } },
    { id: 'one-trick', cat: 'r-ride', icon: '🐴', name: 'One-Trick Pony', how: 'Half of all your rides were one attraction.', quip: 'There are other rides. We checked.', test: (p) => (p.rides.length >= 4 && p.top[1] / p.rides.length >= 0.5 ? `${p.top[0]}: ${p.top[1]} of ${p.rides.length} rides` : null) },
    { id: 'collector', cat: 'r-ride', icon: '📦', name: 'Collector of Nothing', how: 'Only rode things you’d already logged on a previous trip.', needs: 'earlier', quip: 'New experiences are overrated.', test: (p) => {
      const seen = new Set(p.earlier.map((l) => l.entityId));
      return p.rides.every((r) => seen.has(r.entityId)) ? `All ${plural(p.counts.size, 'ride')} seen before` : null;
    } },
    // ---- group roasts
    { id: 'bag-holder', cat: 'r-group', icon: '🎒', name: 'Bag Holder', how: 'Sat out 3+ rides at least two others did together while you were in the park.', quip: 'Someone had to guard the churros.', test: (p) => {
      const missed = new Set();
      for (const [day, list] of p.byDay) {
        const mine = new Set(list.map((r) => r.entityId));
        const from = list[0].at;
        const to = list[list.length - 1].at;
        const theirs = p.others.filter((o) => o.day === day && !mine.has(o.entityId) && o.riddenAt * 1000 >= from && o.riddenAt * 1000 <= to);
        for (const o of theirs) {
          if (theirs.some((x) => x.by !== o.by && x.entityId === o.entityId && Math.abs(x.riddenAt - o.riddenAt) <= 1800)) missed.add(`${day}:${o.entityId}`);
        }
      }
      return missed.size >= 3 ? `Held the bags for ${missed.size} rides` : null;
    } },
    { id: 'slowest', cat: 'r-group', icon: '🐌', name: 'The Slowest Walker', how: 'The group waited for you the most.', untracked: 'Location sharing only keeps where people are now, not how they got there.', quip: 'Taking in the atmosphere.', test: () => null },
    { id: 'group-chat', cat: 'r-group', icon: '📵', name: 'Group Chat Ignorer', how: 'Missed the regroup time by 20+ min.', untracked: 'The app doesn’t record regroup times.', quip: 'Seen at 14:02.', test: () => null },
  ];

  /** Is the data this badge depends on available at all? */
  function badgeDataOk(b, ctx, person) {
    if (b.untracked) return false;
    if (b.needs === 'earlier') return (person?.earlier || []).length > 0;
    if (!b.needs) return true;
    if (!ctx) return false;
    if (b.needs === 'hours') return Object.keys(ctx.hours || {}).length > 0;
    if (b.needs === 'weather') return !!ctx.weather;
    if (b.needs === 'plan') return !!ctx.plan && (ctx.catalog || []).length > 0;
    if (b.needs === 'catalog') return (ctx.catalog || []).length > 0;
    return true; // 'posted': snapshots are optional per ride
  }

  function computeBadges(person, ctx, list = BADGES) {
    return list.map((b) => {
      const ok = badgeDataOk(b, ctx, person);
      let evidence = null;
      if (ok) {
        try { evidence = b.test(person, ctx); } catch { evidence = null; }
      }
      return { ...b, earned: !!evidence, evidence, noData: !ok };
    });
  }

  // ---- badge images (drawn on a canvas, so they can be saved as PNGs)

  /** Roasts only show if this person (and whoever's watching) hasn't opted out. Unknown setting means off. */
  function roastsAllowed(ctx, name) {
    if (!Array.isArray(ctx?.noRoast)) return false;
    const viewer = S.me?.user?.name;
    return !ctx.noRoast.includes(name) && !(viewer && ctx.noRoast.includes(viewer));
  }

  const BADGE_STYLE = {
    'r-queue': { a: '#ffd43b', b: '#7a4b00', sides: 6 },
    'r-plan': { a: '#ced4da', b: '#343a40', sides: 8 },
    'r-commit': { a: '#ffc9de', b: '#7d1d4f', sides: 0 },
    'r-time': { a: '#d0bfff', b: '#3b1e8f', sides: 0 },
    'r-snack': { a: '#ffc078', b: '#8a3c00', sides: 12, burst: true },
    'r-weather': { a: '#a5d8ff', b: '#123a63', sides: 4 },
    'r-ride': { a: '#ff8787', b: '#7a0f0f', sides: 5 },
    'r-group': { a: '#b2f2bb', b: '#14502c', sides: 3 },
    timing: { a: '#ffb347', b: '#d9480f', sides: 0 },
    queues: { a: '#5ee7df', b: '#0b6e99', sides: 6 },
    habits: { a: '#f78fb3', b: '#a61e6e', sides: 8 },
    thrill: { a: '#ff6b6b', b: '#7b1fa2', sides: 12, burst: true },
    weather: { a: '#74c0fc', b: '#1c3faa', sides: 4 },
    planning: { a: '#b2f2bb', b: '#1b6f43', sides: 5 },
    movement: { a: '#ffe066', b: '#b35c00', sides: 3 },
    characters: { a: '#ffc9f0', b: '#8e2fa8', sides: 8 },
    rare: { a: '#fff3b0', b: '#b8860b', sides: 12, burst: true },
  };
  const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  const CARD_FONT = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';

  function badgeShape(ctx, cx, cy, r, st) {
    ctx.beginPath();
    if (!st.sides) { ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath(); return; }
    const n = st.burst ? st.sides * 2 : st.sides;
    // Rotate so triangles and pentagons point up and squares stand on a corner.
    const start = -Math.PI / 2;
    for (let i = 0; i < n; i++) {
      const rr = st.burst && i % 2 ? r * 0.84 : r;
      const t = start + (i * Math.PI * 2) / n;
      ctx.lineTo(cx + Math.cos(t) * rr, cy + Math.sin(t) * rr);
    }
    ctx.closePath();
  }

  /** The emblem: category shape, rim and the badge's symbol, in full colour or locked grey. */
  function drawEmblem(ctx, cx, cy, size, badge) {
    const st = badge.rare ? BADGE_STYLE.rare : BADGE_STYLE[badge.cat];
    // Triangles and diamonds have less room inside, so they're drawn larger.
    const r = (size / 2) * (st.sides === 3 ? 1 : 0.96);
    const oy = st.sides === 3 ? cy + r * 0.14 : cy;
    const locked = !badge.earned;
    const a = locked ? '#8d8d9c' : st.a;
    const b = locked ? '#4b4b5a' : st.b;
    ctx.save();
    badgeShape(ctx, cx, oy, r, st);
    const rim = ctx.createLinearGradient(cx - r, oy - r, cx + r, oy + r);
    rim.addColorStop(0, '#fff');
    rim.addColorStop(0.5, a);
    rim.addColorStop(1, b);
    ctx.fillStyle = rim;
    ctx.fill();
    badgeShape(ctx, cx, oy, r * 0.86, st);
    const face = ctx.createRadialGradient(cx - r * 0.3, oy - r * 0.35, r * 0.1, cx, oy, r);
    face.addColorStop(0, a);
    face.addColorStop(1, b);
    ctx.fillStyle = face;
    ctx.fill();
    ctx.restore();

    ctx.save();
    if (locked) ctx.globalAlpha = 0.35;
    const glyph = st.sides === 3 ? r * 0.62 : r * 0.92;
    ctx.font = `${glyph}px ${EMOJI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badge.icon, cx, st.sides === 3 ? oy + r * 0.18 : oy + r * 0.05);
    ctx.restore();
    if (locked) {
      ctx.font = `${r * 0.42}px ${EMOJI_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🔒', cx + r * 0.58, cy + r * 0.58);
    }
  }

  function wrapText(ctx, text, maxWidth) {
    const lines = [];
    let line = '';
    for (const word of String(text).split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxWidth) { lines.push(line); line = word; } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  }

  /** Set a bold font, shrunk until the text fits the width (long names, long dates). */
  function fitFont(ctx, text, weight, px, maxWidth) {
    let size = px;
    do {
      ctx.font = `${weight} ${size}px ${CARD_FONT}`;
      size -= 2;
    } while (size > 14 && ctx.measureText(text).width > maxWidth);
  }

  function newCanvas(w, h2) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h2;
    return c;
  }

  const emblemCache = new Map();
  function emblemUrl(badge, px = 192) {
    const key = `${badge.id}:${badge.earned ? 1 : 0}:${px}`;
    if (!emblemCache.has(key)) {
      const c = newCanvas(px, px);
      drawEmblem(c.getContext('2d'), px / 2, px / 2, px * 0.96, badge);
      emblemCache.set(key, c.toDataURL('image/png'));
    }
    return emblemCache.get(key);
  }

  /** A 1080×1350 card for one earned badge: the emblem, the person and what they did. */
  function badgeCardCanvas(badge, name) {
    const W = 1080;
    const H = 1350;
    const c = newCanvas(W, H);
    const ctx = c.getContext('2d');
    const st = badge.rare ? BADGE_STYLE.rare : BADGE_STYLE[badge.cat];
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, st.b);
    bg.addColorStop(1, '#12101f');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = st.a;
    ctx.beginPath(); ctx.arc(W * 0.85, H * 0.12, 420, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(W * 0.1, H * 0.9, 300, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#fff';
    ctx.font = `800 38px ${CARD_FONT}`;
    const roast = ROAST_CATS.find(([k]) => k === badge.cat);
    ctx.fillText(roast ? `ROAST · ${roast[1].toUpperCase()}` : badge.rare ? '★ RARE BADGE ★' : BADGE_CATS.find(([k]) => k === badge.cat)[1].toUpperCase(), W / 2, 110);

    drawEmblem(ctx, W / 2, roast ? 380 : 440, roast ? 440 : 560, badge);

    let y = roast ? 700 : 830;
    ctx.fillStyle = st.a;
    let namePx = 92;
    ctx.font = `900 ${namePx}px ${CARD_FONT}`;
    if (wrapText(ctx, badge.name, W - 120).length > 2) { namePx = 72; ctx.font = `900 ${namePx}px ${CARD_FONT}`; }
    for (const line of wrapText(ctx, badge.name, W - 120).slice(0, 3)) { ctx.fillText(line, W / 2, y); y += namePx + 8; }
    ctx.fillStyle = '#fff';
    ctx.font = `600 46px ${CARD_FONT}`;
    y += 10;
    for (const line of wrapText(ctx, badge.evidence || badge.how, W - 160).slice(0, roast ? 2 : 3)) { ctx.fillText(line, W / 2, y); y += 60; }
    if (badge.quip) {
      y += 14;
      ctx.fillStyle = st.a;
      ctx.font = `italic 700 50px ${CARD_FONT}`;
      for (const line of wrapText(ctx, `“${badge.quip}”`, W - 160).slice(0, 2)) { ctx.fillText(line, W / 2, y); y += 62; }
    }

    ctx.fillStyle = '#fff';
    fitFont(ctx, name, 800, 44, W - 120);
    ctx.fillText(name, W / 2, H - 120);
    ctx.font = `500 32px ${CARD_FONT}`;
    ctx.fillText(`Disneyland Paris · ${tripRange()}`, W / 2, H - 66);
    return c;
  }

  /** One image with all of someone's earned badges. */
  function badgeSheetCanvas(earned, name, label = 'badges') {
    const W = 1080;
    const cols = earned.length <= 4 ? 2 : earned.length <= 9 ? 3 : 4;
    const cell = W / cols;
    const rows = Math.ceil(earned.length / cols);
    const head = 230;
    const cellH = cell + 70;
    const H = head + rows * cellH + 90;
    const c = newCanvas(W, H);
    const ctx = c.getContext('2d');
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#1c0f5c');
    bg.addColorStop(1, '#12101f');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#d6ff3f';
    fitFont(ctx, `${name}’s ${label}`, 900, 72, W - 100);
    ctx.fillText(`${name}’s ${label}`, W / 2, 110);
    ctx.fillStyle = '#fff';
    const sheetSub = `${plural(earned.length, label.replace(/s$/, ''))} · Disneyland Paris · ${tripRange()}`;
    fitFont(ctx, sheetSub, 600, 36, W - 100);
    ctx.fillText(sheetSub, W / 2, 170);
    earned.forEach((b, i) => {
      const x = (i % cols) * cell + cell / 2;
      const y = head + Math.floor(i / cols) * cellH;
      drawEmblem(ctx, x, y + cell * 0.46, cell * 0.8, b);
      ctx.fillStyle = '#fff';
      ctx.font = `700 ${cols === 4 ? 24 : 30}px ${CARD_FONT}`;
      wrapText(ctx, b.name, cell - 24).slice(0, 2).forEach((line, n) => ctx.fillText(line, x, y + cell * 0.97 + n * (cols === 4 ? 28 : 34)));
    });
    return c;
  }

  const SOCIAL_SIZES = {
    story: { w: 1080, h: 1920, top: 270, bottom: 300, rides: 3, medals: 6 }, // Stories cover the top and bottom with their own buttons
    post: { w: 1080, h: 1350, top: 60, bottom: 130, rides: 3, medals: 6 },
  };

  /**
   * A shareable picture of someone's Wrapped. Built as blocks so it can measure itself: optional
   * blocks are dropped if a long-named ride or a big badge haul would overflow the safe area.
   * First name only, since these go on public feeds.
   */
  function wrappedSocialCanvas(who, size) {
    const cfg = SOCIAL_SIZES[size];
    const W = cfg.w;
    const H = cfg.h;
    const PAD = 80;
    const c = newCanvas(W, H);
    const ctx = c.getContext('2d');
    const { st, card } = who;
    const earned = who.badges.filter((b) => b.earned);
    const first = String(who.name).split(/[\s@]/)[0] || who.name;

    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#1c0f5c');
    bg.addColorStop(0.55, '#4a1a9e');
    bg.addColorStop(1, '#b3125f');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = '#d6ff3f';
    ctx.beginPath(); ctx.arc(W * 0.92, H * 0.1, 430, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(W * 0.04, H * 0.9, 330, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;

    const WHITE = '#fff';
    const POP = '#d6ff3f';
    const left = (font, color) => {
      ctx.font = font;
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    };
    const blocks = [];

    blocks.push({ h: 66, draw: (y) => {
      left(`800 40px ${CARD_FONT}`, WHITE);
      ctx.fillText('MY DISNEYLAND PARIS WRAPPED', PAD, y + 42, W - PAD * 2);
    } });

    left(`900 88px ${CARD_FONT}`, POP);
    const titleLines = wrapText(ctx, card.persona[1], W - PAD * 2).slice(0, 2);
    blocks.push({ h: 130 + titleLines.length * 98, draw: (y) => {
      ctx.font = `120px ${EMOJI_FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = WHITE;
      ctx.fillText(card.persona[0], PAD, y + 108);
      left(`900 88px ${CARD_FONT}`, POP);
      titleLines.forEach((line, i) => ctx.fillText(line, PAD, y + 206 + i * 98));
    } });

    const tiles = [
      [String(st.n), ridesLabel(st, who.shows)],
      [fmtQueued(st.queued), 'queuing'],
      [String(earned.length), earned.length === 1 ? 'badge' : 'badges'],
      card.thrill ? [String(card.thrill.score), 'thrill score'] : [String(st.unique), st.unique === 1 ? 'different ride' : 'different rides'],
    ];
    blocks.push({ h: 2 * 172 + 40, draw: (y) => {
      const tw = (W - PAD * 2 - 24) / 2;
      tiles.forEach(([big, small], i) => {
        const x = PAD + (i % 2) * (tw + 24);
        const ty = y + Math.floor(i / 2) * 196;
        ctx.fillStyle = 'rgba(255,255,255,.14)';
        ctx.beginPath();
        ctx.roundRect(x, ty, tw, 172, 28);
        ctx.fill();
        ctx.fillStyle = POP;
        ctx.textAlign = 'left';
        fitFont(ctx, big, 900, 80, tw - 56);
        ctx.fillText(big, x + 28, ty + 92);
        left(`600 36px ${CARD_FONT}`, WHITE);
        ctx.fillText(small, x + 28, ty + 142);
      });
    } });

    // Optional from here on, most important first.
    const optional = [];
    const rideRows = st.rides.slice(0, cfg.rides).map(([name, count], i) => {
      left(`800 44px ${CARD_FONT}`, WHITE);
      return { i, count, lines: wrapText(ctx, name, W - PAD * 2 - 170).slice(0, 2) };
    });
    optional.push({ h: 66 + rideRows.reduce((n, r) => n + r.lines.length * 54 + 16, 0), draw: (y) => {
      left(`800 36px ${CARD_FONT}`, POP);
      ctx.fillText(st.rides.length > 1 ? 'TOP RIDES' : 'TOP RIDE', PAD, y + 36);
      let ry = y + 66;
      for (const r of rideRows) {
        left(`900 44px ${CARD_FONT}`, POP);
        ctx.fillText(String(r.i + 1), PAD, ry + 42);
        left(`800 44px ${CARD_FONT}`, WHITE);
        r.lines.forEach((line, n) => ctx.fillText(line, PAD + 64, ry + 42 + n * 54));
        ctx.textAlign = 'right';
        ctx.font = `600 44px ${CARD_FONT}`;
        ctx.fillText(`×${r.count}`, W - PAD, ry + 42);
        ry += r.lines.length * 54 + 16;
      }
    } });

    if (earned.length) {
      // Rare ones first: they're the ones worth showing off.
      const shown = earned.slice().sort((a, b) => (b.rare ? 1 : 0) - (a.rare ? 1 : 0)).slice(0, cfg.medals);
      const extra = earned.length - shown.length;
      optional.push({ h: 150, draw: (y) => {
        const slots = shown.length + (extra ? 1 : 0);
        const gap = Math.min(150, (W - PAD * 2) / slots);
        shown.forEach((b, i) => drawEmblem(ctx, PAD + gap * i + 65, y + 70, 130, b));
        if (extra) {
          left(`900 44px ${CARD_FONT}`, WHITE);
          ctx.textAlign = 'center';
          ctx.fillText(`+${extra}`, PAD + gap * shown.length + 65, y + 86);
        }
      } });
    }

    const extras = wrappedExtras(who).join(' · ');
    if (extras) {
      optional.push({ h: 58, draw: (y) => {
        ctx.fillStyle = WHITE;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        fitFont(ctx, extras, 600, 38, W - PAD * 2);
        ctx.fillText(extras, PAD, y + 42);
      } });
    }

    const facts = [
      card.thrill ? ['Thrill level', card.thrill.label] : null,
      who.person.lands[0] ? ['Home turf', who.person.lands[0].land] : null,
    ].filter(Boolean);
    if (facts.length) {
      optional.push({ h: facts.length * 58 + 16, draw: (y) => {
        facts.forEach(([k, v], i) => {
          left(`600 38px ${CARD_FONT}`, WHITE);
          const label = `${k}: `;
          ctx.fillText(label, PAD, y + 40 + i * 58);
          const lw = ctx.measureText(label).width;
          ctx.fillStyle = POP;
          fitFont(ctx, v, 800, 38, W - PAD * 2 - lw);
          ctx.fillText(v, PAD + lw, y + 40 + i * 58);
        });
      } });
    }

    // Keep whatever fits, then centre it in the safe area.
    const GAP = size === 'story' ? 20 : 12;
    const room = H - cfg.top - cfg.bottom;
    const heightOf = (list) => list.reduce((n, b) => n + b.h, 0) + GAP * Math.max(0, list.length - 1);
    const kept = blocks.slice();
    for (const b of optional) if (heightOf([...kept, b]) <= room) kept.push(b);
    let y = cfg.top + Math.max(0, (room - heightOf(kept)) / 2);
    for (const b of kept) {
      b.draw(y);
      y += b.h + GAP;
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = WHITE;
    const foot = H - cfg.bottom + 56;
    fitFont(ctx, first, 800, 44, W - PAD * 2);
    ctx.fillText(first, W / 2, foot);
    ctx.font = `500 32px ${CARD_FONT}`;
    ctx.fillText(`${tripRange()} · ${S.boot.appName}`, W / 2, foot + 48);
    return c;
  }

  const fileSafe = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  /** Save a canvas as a PNG. iPhone home-screen apps can't download, so they get the share sheet ("Save Image"). */
  async function saveCanvas(canvas, filename, { share = false } = {}) {
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    if (!blob) throw new Error('Couldn’t create the image');
    const file = new File([blob], filename, { type: 'image/png' });
    const canShare = !!navigator.canShare?.({ files: [file] });
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if ((share || ios) && canShare) {
      try { await navigator.share({ files: [file] }); } catch (e) { if (e?.name !== 'AbortError') throw e; }
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: filename, hidden: true });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // Map history: each person's trip as numbered stops, built from the ride log and each ride's
  // position. The app doesn't keep GPS tracks, so the lines join rides rather than trace a walk.

  let mapHistoryOpen = false;

  async function openMapHistory({ person = null, visit = null } = {}) {
    if (mapHistoryOpen) return;
    mapHistoryOpen = true;
    setWrapView(visit);

    const closeBtn = h('button', { type: 'button', class: 'mh-close', 'aria-label': 'Close map history', onclick: () => dlg.close() }, '✕');
    const chipsBox = h('div', { class: 'mh-chips' });
    const mapEl = h('div', { class: 'mh-map' });
    const listBox = h('div', { class: 'mh-list', tabindex: '0', 'aria-label': 'Stops' }, h('p', { class: 'empty' }, 'Loading…'));
    const dlg = h('dialog', { class: 'mh', 'aria-label': 'Map history' },
      h('header', { class: 'mh-head' }, h('h2', null, '🗺️ Map history'), closeBtn),
      chipsBox, mapEl, listBox);
    document.body.append(dlg);
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');

    let timer = null;
    let closed = false;
    const stopReplay = () => { clearTimeout(timer); timer = null; };
    const cfg = S.boot.map || {};
    const map = new PPMap(mapEl, {
      tiles: cfg.tiles || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: cfg.attribution || '© OpenStreetMap contributors',
      center: RESORT,
      zoom: 15,
      locateTitle: 'Fit everything on the map',
      onLocate: () => fit(current.points),
      onMarker: (id) => selectStop(id),
    });
    dlg.addEventListener('close', () => {
      closed = true;
      stopReplay();
      map.ro.disconnect();
      mapHistoryOpen = false;
      dlg.remove();
    });

    // Latest log and ride positions; live data fills in if /api/wrapped isn't available.
    await Promise.all([
      api('me').then((me) => { S.me = me; store.set('me', me); renderUser(); }).catch(() => {}),
      Array.isArray(S.wrappedCtx?.catalog) && S.wrappedCtx.catalog.length ? null : api('wrapped').then((d) => { S.wrappedCtx = d; store.set('wrappedCtx', d); }).catch(() => {}),
    ]);
    if (closed) return;

    const places = new Map();
    const addPlace = (id, name, lat, lng) => {
      if (lat == null || lng == null) return;
      const p = { lat: Number(lat), lng: Number(lng) };
      places.set(id, p);
      if (name) places.set(`name:${name}`, p);
    };
    for (const k of Object.keys(S.live || {})) for (const it of S.live[k]?.items || []) if (it.type === 'ATTRACTION') addPlace(it.id, it.name, it.location?.lat, it.location?.lng);
    for (const c of (S.wrappedCtx?.catalog || store.get('wrappedCtx', null)?.catalog || [])) addPlace(c.id, c.name, c.lat, c.lng);
    const placeOf = (l) => places.get(l.entityId) || places.get(`name:${l.name}`) || null;

    const log = wrappedLog().slice().sort((a, b) => a.riddenAt - b.riddenAt);
    if (!log.length) {
      fill(listBox, h('p', { class: 'empty' }, 'Nobody logged a ride on this trip, so there’s nothing to map.'));
      return;
    }
    const names = [...new Set(log.filter((l) => l.by).map((l) => l.by))].sort((a, b) => a.localeCompare(b));
    const myRow = log.find((l) => l.mine);
    const state = {
      who: person && names.includes(person) ? person : myRow?.by || null, // null = everyone
      day: null,
    };
    let current = { points: [], stops: [], kind: 'all' };

    function fit(points) {
      if (!points.length) { map.setView(RESORT.lat, RESORT.lng, 15); return; }
      const lats = points.map((p) => p.lat);
      const lngs = points.map((p) => p.lng);
      const c = { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lng: (Math.min(...lngs) + Math.max(...lngs)) / 2 };
      const tall = PPMap.metres({ lat: Math.min(...lats), lng: c.lng }, { lat: Math.max(...lats), lng: c.lng });
      const wide = PPMap.metres({ lat: c.lat, lng: Math.min(...lngs) }, { lat: c.lat, lng: Math.max(...lngs) });
      const { w, h: ht } = map.size();
      let z = 18;
      while (z > 14) {
        const mpp = (156543.03392 * Math.cos((c.lat * Math.PI) / 180)) / 2 ** z;
        if (wide / mpp <= w - 90 && tall / mpp <= ht - 90) break;
        z--;
      }
      map.setView(c.lat, c.lng, z);
    }

    /** Markers for the first `upTo` stops of a day, or one per ride with a count for a summary view. */
    function drawMarkers(upTo = Infinity) {
      const groups = new Map();
      for (const s of current.stops) {
        if (!s.place || s.n > upTo) continue;
        const key = s.l.entityId;
        if (!groups.has(key)) groups.set(key, { ...s, ns: [], count: 0 });
        const g = groups.get(key);
        g.ns.push(s.n);
        g.count += s.count || 1;
      }
      map.setMarkers([...groups.entries()].map(([id, g]) => ({
        id,
        lat: g.place.lat,
        lng: g.place.lng,
        label: current.kind === 'day' ? (g.ns.length > 2 ? `${g.ns[0]},${g.ns[1]}+` : g.ns.join(',')) : String(g.count),
        cls: 'mh-stop',
        title: current.kind === 'day' ? `${g.l.name}: stop ${g.ns.join(', ')}` : `${g.l.name}: ${plural(g.count, 'ride')}`,
      })));
    }

    /** Highlight a ride on the map and in the list; `n` picks one visit when a ride was done twice. */
    function selectStop(id, centre = false, n = null) {
      map.select(id);
      for (const row of listBox.querySelectorAll('.mh-row')) {
        const on = row.dataset.id === id && (n == null || row.dataset.n === String(n));
        row.classList.toggle('sel', on);
        if (on && !centre) row.scrollIntoView({ block: 'nearest' });
      }
      const place = current.stops.find((s) => s.l.entityId === id)?.place;
      if (centre && place) map.setView(place.lat, place.lng);
    }

    function replay(btn) {
      if (timer) {
        stopReplay();
        btn.textContent = '▶ Replay';
        drawMarkers();
        map.setRoute(current.points, 0);
        return;
      }
      btn.textContent = '■ Stop';
      const mapped = current.stops.filter((s) => s.place);
      let i = 0;
      const step = () => {
        if (closed) return;
        i += 1;
        drawMarkers(mapped[i - 1].n);
        map.setRoute(mapped.slice(0, i).map((s) => s.place), 0);
        selectStop(mapped[i - 1].l.entityId, false, mapped[i - 1].n);
        if (i < mapped.length) timer = setTimeout(step, 1100);
        else { timer = null; btn.textContent = '▶ Replay'; }
      };
      step();
    }

    function draw() {
      stopReplay();
      const rows = state.who ? log.filter((l) => l.by === state.who) : log;
      const days = [...new Set(rows.map((l) => l.day))];
      if (state.day && !days.includes(state.day)) state.day = null;
      const day = state.day;

      fill(chipsBox,
        h('div', { class: 'mh-row-chips' },
          chip('Everyone', state.who === null, () => { state.who = null; state.day = null; draw(); }),
          names.map((n) => chip(myRow?.by === n ? `${n} (you)` : n, state.who === n, () => { state.who = n; state.day = null; draw(); }))),
        h('div', { class: 'mh-row-chips' },
          chip('All days', !day, () => { state.day = null; draw(); }),
          days.map((d) => chip(dayLabel(d), day === d, () => { state.day = d; draw(); }))));

      map.select(null);
      if (day) {
        const stops = rows.filter((l) => l.day === day).map((l, i) => ({ n: i + 1, l, place: placeOf(l) }));
        const points = stops.filter((s) => s.place).map((s) => s.place);
        current = { kind: 'day', stops, points };
        let metres = 0;
        for (let i = 1; i < points.length; i++) metres += PPMap.metres(points[i - 1], points[i]);
        const missing = stops.length - points.length;
        const replayBtn = points.length > 1 ? h('button', { type: 'button', class: 'btn small primary', onclick: (e) => replay(e.currentTarget) }, '▶ Replay') : null;
        fill(listBox,
          h('div', { class: 'mh-sum' },
            h('p', null, h('b', null, plural(stops.length, 'stop')),
              points.length > 1 ? ` · about ${((metres * 1.3) / 1000).toFixed(1)} km between rides (estimated)` : ''),
            replayBtn),
          h('ol', { class: 'mh-stops' }, stops.map((s) => h('li', null, h('button', {
            type: 'button',
            class: 'mh-row',
            dataset: { id: s.l.entityId, n: String(s.n) },
            disabled: !s.place,
            onclick: () => selectStop(s.l.entityId, true, s.n),
          },
          h('span', { class: 'mh-n' }, String(s.n)),
          h('span', { class: 'mh-t' }, h('b', null, s.l.name), h('small', null, [
            fmtClock(minuteOfDay(s.l.riddenAt * 1000)),
            s.l.wait != null ? `${s.l.wait} min queue` : null,
            s.place ? null : 'position unknown',
            state.who ? null : s.l.by,
          ].filter(Boolean).join(' · '))))))),
          missing ? h('p', { class: 'mh-note' }, `${plural(missing, 'ride')} couldn’t be placed on the map.`) : null,
          h('p', { class: 'mh-note' }, 'Lines join rides in the order they were logged. They aren’t GPS tracks, so the real walk will have been different.'));
      } else {
        const counts = new Map();
        for (const l of rows) {
          if (!counts.has(l.entityId)) counts.set(l.entityId, { n: counts.size + 1, l, place: placeOf(l), count: 0 });
          counts.get(l.entityId).count += 1;
        }
        const stops = [...counts.values()].sort((a, b) => b.count - a.count || a.l.name.localeCompare(b.l.name));
        current = { kind: 'all', stops, points: stops.filter((s) => s.place).map((s) => s.place) };
        const missing = stops.length - current.points.length;
        fill(listBox,
          h('div', { class: 'mh-sum' }, h('p', null, h('b', null, plural(rows.length, 'ride')), ` at ${plural(stops.length, 'attraction')}`)),
          days.length ? h('p', { class: 'mh-note' }, 'Numbers show rides at each attraction. Pick a day to see the order.') : null,
          h('ol', { class: 'mh-stops' }, stops.map((s) => h('li', null, h('button', {
            type: 'button',
            class: 'mh-row',
            dataset: { id: s.l.entityId },
            disabled: !s.place,
            onclick: () => selectStop(s.l.entityId, true),
          },
          h('span', { class: 'mh-n' }, String(s.count)),
          h('span', { class: 'mh-t' }, h('b', null, s.l.name), s.place ? null : h('small', null, 'position unknown')))))),
          missing ? h('p', { class: 'mh-note' }, `${plural(missing, 'attraction')} couldn’t be placed on the map.`) : null);
      }
      drawMarkers();
      map.setRoute(current.kind === 'day' ? current.points : null, 0);
      fit(current.points);
    }

    draw();
  }

  // Full-screen story version of Trip Wrapped: the first thing anyone sees once the trip is over.

  const tripEnded = () => today() > S.boot.trip.end;

  // Which visit Wrapped and map history are showing: null = the current one. Set each time one opens.
  let wrapView = null;
  const setWrapView = (visit) => { wrapView = visit && visit.id !== S.boot.trip.id ? visit : null; };
  const wrapTrip = () => wrapView || S.boot.trip;
  const thisYear = () => today().slice(0, 4);
  const tripRange = (v = wrapTrip()) => `${dayLabel(v.start)} – ${dayLabel(v.end)}${v.end.slice(0, 4) === thisYear() ? '' : ` ${v.end.slice(0, 4)}`}`;
  const dayLabelY = (d) => (d.slice(0, 4) === thisYear() ? dayLabel(d) : `${dayLabel(d)} ${d.slice(0, 4)}`);
  const visitName = (v) => v.name || new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'short', year: 'numeric' }).format(new Date(v.start + 'T12:00:00Z'));
  const fmtQueued = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);
  const fmtClock = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

  /** Only rides inside the trip window count, so pre-trip test entries stay out of it. */
  function wrappedLog({ start, end } = wrapTrip()) {
    return (S.me?.log || []).filter((l) => l.day >= start && l.day <= end);
  }

  /** Characters met in the trip window. */
  function wrappedCharacters({ start, end } = wrapTrip()) {
    return (S.me?.characters || []).filter((m) => m.day >= start && m.day <= end);
  }

  /** Shows watched in the trip window. Kept apart from wrappedLog so they never count as rides. */
  function wrappedShows({ start, end } = wrapTrip()) {
    return (S.me?.shows || []).filter((w) => w.day >= start && w.day <= end);
  }

  /** [[name, times watched]], most watched first. */
  function showTally(rows) {
    const m = new Map();
    for (const w of rows) m.set(w.name, (m.get(w.name) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }

  /** The label under a ride count: shows go alongside it, never into it. */
  const ridesLabel = (st, shows) => `${st.n === 1 ? 'ride' : 'rides'}${shows.length ? ` · ${plural(shows.length, 'show')}` : ''}`;

  function wrappedShowRank(tally, max = 5) {
    const more = tally.length - max;
    return [
      h('ol', { class: 'wx-rank small' }, tally.slice(0, max).map(([show, c], i) => h('li', null,
        h('span', { class: 'wx-rank-n' }, String(i + 1)), h('span', { class: 'wx-rank-name' }, show), h('span', { class: 'wx-rank-c' }, `×${c}`)))),
      more > 0 ? h('p', { class: 'wx-sub' }, `Plus ${more} more.`) : null,
    ];
  }

  /** Meals and shops in the trip window. Like shows, they never count as rides. */
  function wrappedPlaces({ start, end } = wrapTrip()) {
    return (S.me?.places || []).filter((p) => p.day >= start && p.day <= end);
  }

  /** Who was met and who was only seen. Someone who was both counts as met. */
  function characterTally(rows) {
    const tally = (list) => {
      const m = new Map();
      for (const c of list) {
        const key = normName(c.name);
        m.set(key, { name: m.get(key)?.name || c.name, n: (m.get(key)?.n || 0) + 1 });
      }
      return m;
    };
    const met = tally(rows.filter((c) => c.kind !== 'seen'));
    const seen = tally(rows.filter((c) => c.kind === 'seen' && !met.has(normName(c.name))));
    const ranked = (m) => [...m.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).map((x) => [x.name, x.n]);
    return { met: ranked(met), seen: ranked(seen) };
  }

  const WRAP_PLACE = {
    food: { c: 'c5', you: 'ate at', party: 'Fed and watered', one: 'place', many: 'places' },
    shop: { c: 'c3', you: 'shopped at', party: 'Retail therapy', one: 'shop', many: 'shops' },
    browse: { c: 'c6', you: 'perused', party: 'Just looking', one: 'shop', many: 'shops' },
  };

  const partyByline = (rows) => {
    const counts = showTally(rows.filter((r) => r.by).map((r) => ({ name: r.by })));
    return counts.length > 1 ? counts.map(([n, c]) => `${n} ${c}`).join(' · ') : null;
  };

  /** One person's meals or shops (`you` is who to name), or the party's when it's left out. */
  function wrappedPlaceSlide(kind, rows, you = null) {
    const cfg = WRAP_PLACE[kind];
    const tally = showTally(rows);
    const spent = sumCents(rows);
    const visits = rows.length > tally.length ? plural(rows.length, 'visit') : null;
    return { c: cfg.c, body: () => [
      you ? h('p', { class: 'wx-lead' }, `${you} ${cfg.you}`) : h('p', { class: 'wx-kicker' }, cfg.party),
      h('p', { class: 'wx-big' }, wrappedCount(tally.length)),
      h('p', { class: 'wx-lead' }, `${tally.length === 1 ? cfg.one : cfg.many}.`),
      ...wrappedShowRank(tally),
      visits || spent ? h('p', { class: 'wx-sub' }, [visits, spent ? `${money(spent)} spent` : null].filter(Boolean).join(' · ')) : null,
      you ? null : (partyByline(rows) ? h('p', { class: 'wx-sub' }, partyByline(rows)) : null),
    ] };
  }

  function wrappedCharacterSlide(rows, you = null) {
    const { met, seen } = characterTally(rows);
    const main = met.length ? met : seen;
    const verb = met.length ? 'met' : 'spotted';
    const photos = rows.filter((c) => c.photo).slice(0, 4);
    const also = met.length && seen.length
      ? `Also spotted: ${seen.slice(0, 4).map(([n]) => n).join(', ')}${seen.length > 4 ? ` and ${seen.length - 4} more` : ''}.`
      : null;
    return { c: 'c2', body: () => [
      you ? h('p', { class: 'wx-lead' }, `${you} ${verb}`) : h('p', { class: 'wx-kicker' }, 'Character count'),
      h('p', { class: 'wx-big' }, wrappedCount(main.length)),
      h('p', { class: 'wx-lead' }, `${main.length === 1 ? 'character' : 'characters'}${you ? '' : ` ${verb}`}.`),
      photos.length ? h('div', { class: 'wx-photos' }, photos.map((c) => h('img', {
        src: characterPhotoUrl(c.id), alt: c.name, onerror: (e) => e.currentTarget.remove(),
      }))) : null,
      ...wrappedShowRank(main, photos.length ? 3 : 5),
      also ? h('p', { class: 'wx-sub' }, also) : null,
      you ? null : (partyByline(rows) ? h('p', { class: 'wx-sub' }, partyByline(rows)) : null),
    ] };
  }

  /** "3 places to eat, 2 shops, 4 characters met" for the summary and share image. Never includes money. */
  function wrappedExtras(who) {
    const count = (kind) => new Set(who.places.filter((p) => p.kind === kind).map((p) => p.name)).size;
    const food = count('food');
    const shops = count('shop');
    const perused = count('browse');
    const { met, seen } = characterTally(who.characters);
    const people = met.length
      ? `${plural(met.length, 'character')} met${seen.length ? `, ${seen.length} seen` : ''}`
      : seen.length ? `${plural(seen.length, 'character')} seen` : null;
    return [food ? `${food} ${food === 1 ? 'place' : 'places'} to eat` : null, shops ? plural(shops, 'shop') : null, perused ? `${plural(perused, 'shop')} perused` : null, people].filter(Boolean);
  }

  function wrappedStats(log) {
    const tally = (keys) => {
      const m = new Map();
      for (const k of keys) m.set(k, (m.get(k) || 0) + 1);
      return m;
    };
    const minuteOf = (l) => {
      const ms = l.riddenAt * 1000;
      return parkHour(ms) * 60 + Number(fmt({ minute: 'numeric' }).format(new Date(ms)));
    };
    const rides = [...tally(log.map((l) => l.name)).entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const days = [...tally(log.map((l) => l.day)).entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const waits = log.filter((l) => l.wait != null && l.wait > 0);
    const queued = waits.reduce((n, l) => n + l.wait, 0);
    const minutes = log.map(minuteOf);
    const hourCounts = [...tally(minutes.map((m) => Math.floor(m / 60))).entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    return {
      n: log.length,
      unique: new Set(log.map((l) => l.entityId)).size,
      queued,
      avg: waits.length ? Math.round(queued / waits.length) : 0,
      longest: waits.slice().sort((a, b) => b.wait - a.wait)[0] || null,
      rides,
      days,
      bestDay: days.slice().sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || null,
      earliest: minutes.length ? Math.min(...minutes) : null,
      latest: minutes.length ? Math.max(...minutes) : null,
      peakHour: hourCounts[0]?.[1] > 1 ? hourCounts[0][0] : null, // one ride doesn't make a busy hour
      early: minutes.filter((m) => m < 660).length,
      late: minutes.filter((m) => m >= 1080).length,
      single: log.filter((l) => l.queueType === 'SINGLE_RIDER').length,
      premier: log.filter((l) => l.queueType === 'PREMIER_ACCESS').length,
    };
  }

  /** A rider type, backed by something the person actually did. */
  function wrappedPersona(st) {
    const share = (x) => x / st.n;
    const top = st.rides[0];
    if (share(st.single + st.premier) >= 0.4) return ['⚡', 'The Line Skipper', `${st.single + st.premier} of ${st.n} rides by single rider or Premier Access.`];
    if (share(st.early) >= 0.4) return ['🌅', 'The Rope Dropper', `${st.early} rides before 11:00, while everyone else was finding the coffee.`];
    if (share(st.late) >= 0.4) return ['🌙', 'The Night Owl', `${st.late} rides after 18:00. The parks are better in the dark.`];
    if (st.avg >= 40) return ['⏳', 'The Queue Veteran', `An average wait of ${st.avg} minutes, and still came back for more.`];
    if (top && top[1] >= 3 && share(top[1]) >= 0.25) return ['🔁', 'The Repeat Rider', `${top[1]} times on ${top[0]}. Why ride anything else?`];
    if (st.unique >= 12) return ['🗺️', 'The Completionist', `${st.unique} different rides ticked off.`];
    return ['🎢', 'The Park Explorer', `${st.unique} different ${st.unique === 1 ? 'ride' : 'rides'}, with no rush at all.`];
  }

  /** Everyone gets one award, and it's always true: the fallback covers anyone who won nothing. */
  function wrappedAwards(people) {
    const metrics = [
      ['🏆', 'Ride Machine', (p) => p.st.n, (p) => `${p.st.n} ${p.st.n === 1 ? 'ride' : 'rides'}`],
      ['⏳', 'Queue Champion', (p) => p.st.queued, (p) => `${fmtQueued(p.st.queued)} in line`],
      ['🌅', 'First Through the Gates', (p) => (p.st.earliest == null ? 0 : 1440 - p.st.earliest), (p) => `first ride at ${fmtClock(p.st.earliest)}`],
      ['🌙', 'Last One Out', (p) => (p.st.latest ?? 0), (p) => `last ride at ${fmtClock(p.st.latest)}`],
      ['🗺️', 'The Explorer', (p) => p.st.unique, (p) => `${p.st.unique} different ${p.st.unique === 1 ? 'ride' : 'rides'}`],
      ['🔁', 'Repeat Rider', (p) => p.st.rides[0]?.[1] || 0, (p) => `${p.st.rides[0][0]} ×${p.st.rides[0][1]}`],
      ['🧍', 'Solo Mission', (p) => p.st.single, (p) => `${p.st.single} single-rider`],
      ['⚡', 'Fast Tracker', (p) => p.st.premier, (p) => `${p.st.premier} Premier Access`],
    ];
    const out = new Map();
    for (const [icon, title, score, why] of metrics) {
      // Only a real winner of the category (or a tied one) can take the award.
      const top = Math.max(...people.map(score));
      const winner = top > 0 && people.find((p) => !out.has(p.name) && score(p) === top);
      if (winner) out.set(winner.name, { icon, title, why: why(winner) });
    }
    for (const p of people) {
      if (!out.has(p.name)) out.set(p.name, { icon: '🎠', title: 'Along for the Ride', why: `${p.st.n} ${p.st.n === 1 ? 'ride' : 'rides'}` });
    }
    return out;
  }

  function wrappedCount(value, suffix = '') {
    return h('span', { class: 'wx-count', role: 'img', 'aria-label': `${value}${suffix}`, dataset: { to: String(value), suffix } }, `${value}${suffix}`);
  }

  /** The slides about one person. `who` = { name, isMe, st }. */
  function wrappedPersonSlides(who) {
    const { st, isMe, name } = who;
    const You = isMe ? 'You' : name;
    const Your = isMe ? 'Your' : `${name}’s`;
    const slides = [];
    const persona = wrappedPersona(st);

    slides.push({ c: 'c1', body: () => [
      h('p', { class: 'wx-kicker' }, 'Disneyland Paris'),
      h('h2', { class: 'wx-title' }, isMe ? 'Your trip, wrapped.' : `${name}’s trip, wrapped.`),
      h('p', { class: 'wx-sub' }, tripRange()),
    ] });

    slides.push({ c: 'c2', body: () => [
      h('p', { class: 'wx-lead' }, `${You} rode`),
      h('p', { class: 'wx-big' }, wrappedCount(st.n)),
      h('p', { class: 'wx-lead' }, st.n === 1 ? 'ride.' : 'rides.'),
      h('p', { class: 'wx-sub' }, st.unique === st.n ? 'Every single one different.' : `${st.unique} different ${st.unique === 1 ? 'attraction' : 'attractions'}.`),
    ] });

    slides.push({ c: 'c3', body: () => (st.rides.length > 1 ? [
      h('p', { class: 'wx-kicker' }, `${Your} top rides`),
      h('ol', { class: 'wx-rank' }, st.rides.slice(0, 5).map(([ride, c], i) => h('li', null,
        h('span', { class: 'wx-rank-n' }, String(i + 1)),
        h('span', { class: 'wx-rank-name' }, ride),
        h('span', { class: 'wx-rank-c' }, `×${c}`)))),
    ] : [
      h('p', { class: 'wx-kicker' }, `${Your} No. 1`),
      h('h2', { class: 'wx-title' }, st.rides[0][0]),
      h('p', { class: 'wx-sub' }, `×${st.rides[0][1]}`),
    ]) });

    if (st.queued > 0) {
      const films = Math.floor(st.queued / 120);
      slides.push({ c: 'c4', body: () => [
        h('p', { class: 'wx-lead' }, `${You} spent`),
        h('p', { class: 'wx-big' }, wrappedCount(st.queued)),
        h('p', { class: 'wx-lead' }, st.queued === 1 ? 'minute queuing.' : 'minutes queuing.'),
        h('p', { class: 'wx-sub' }, films >= 1 ? `That’s ${films} ${films === 1 ? 'film' : 'films'} back to back. Average wait: ${st.avg} min.` : `Average wait: ${st.avg} min.`),
      ] });
    }

    if (st.longest) {
      slides.push({ c: 'c5', body: () => [
        h('p', { class: 'wx-kicker' }, 'Longest queue'),
        h('p', { class: 'wx-big' }, wrappedCount(st.longest.wait, 'm')),
        h('h2', { class: 'wx-title sm' }, st.longest.name),
        h('p', { class: 'wx-sub' }, `${dayLabel(st.longest.day)}. Worth it? Only ${isMe ? 'you' : name} can say.`),
      ] });
    }

    if (st.days.length > 1) {
      const max = Math.max(...st.days.map((d) => d[1]));
      const tied = st.days.filter((d) => d[1] === max && d[0] !== st.bestDay[0]);
      slides.push({ c: 'c6', body: () => [
        h('p', { class: 'wx-kicker' }, `${Your} biggest day`),
        h('h2', { class: 'wx-title sm' }, dayLabel(st.bestDay[0])),
        tied.length ? h('p', { class: 'wx-sub' }, `Level with ${tied.map((d) => dayLabel(d[0])).join(' and ')}.`) : null,
        h('div', { class: 'wx-bars' }, st.days.map(([d, c]) => {
          const fillBar = h('i');
          fillBar.style.setProperty('--w', `${Math.round((c / max) * 100)}%`);
          return h('div', { class: 'wx-bar' + (c === max ? ' on' : '') },
            h('span', { class: 'wx-bar-d' }, dayLabel(d)), h('span', { class: 'wx-bar-t' }, fillBar), h('b', null, String(c)));
        })),
      ] });
    }

    slides.push({ c: 'c7', body: () => [
      h('p', { class: 'wx-kicker' }, 'Around the clock'),
      h('dl', { class: 'wx-facts' },
        h('div', null, h('dt', null, '🌅 First ride'), h('dd', null, fmtClock(st.earliest))),
        h('div', null, h('dt', null, '🌙 Last ride'), h('dd', null, fmtClock(st.latest))),
        st.peakHour == null ? null : h('div', null, h('dt', null, '🔥 Busiest hour'), h('dd', null, `${String(st.peakHour).padStart(2, '0')}:00`))),
    ] });

    slides.push({ c: 'c2', body: () => [
      h('p', { class: 'wx-kicker' }, `${Your} rider type`),
      h('p', { class: 'wx-emoji', 'aria-hidden': 'true' }, persona[0]),
      h('h2', { class: 'wx-title' }, persona[1]),
      h('p', { class: 'wx-sub' }, persona[2]),
    ] });

    const person = who.person;
    const thrill = thrillScore(person);
    const dark = darkestDay(person);
    const wet = person.rides.filter((r) => r.info?.wet);

    if (st.rides[0][1] >= 2) {
      slides.push({ c: 'c7', body: () => [
        h('p', { class: 'wx-kicker' }, `${Your} obsession`),
        h('h2', { class: 'wx-title' }, st.rides[0][0]),
        h('p', { class: 'wx-big' }, wrappedCount(st.rides[0][1], '×')),
        h('p', { class: 'wx-sub' }, st.rides[0][1] >= 5 ? 'At this point it should be paying rent.' : 'One more go. Just one more.'),
      ] });
    }

    if (thrill) {
      const bar = h('i');
      bar.style.setProperty('--w', `${thrill.score}%`);
      slides.push({ c: 'c5', body: () => [
        h('p', { class: 'wx-kicker' }, `${Your} thrill score`),
        h('p', { class: 'wx-big' }, wrappedCount(thrill.score)),
        h('div', { class: 'wx-meter', role: 'img', 'aria-label': `${thrill.score} out of 100` }, bar),
        h('h2', { class: 'wx-title sm' }, thrill.label),
        h('p', { class: 'wx-sub' }, `Out of 100, from drops, speed and inversions. Wildest ride: ${thrill.peak.name}.`),
      ] });
    }

    if (wet.length) {
      const names = [...new Set(wet.map((r) => r.name))];
      slides.push({ c: 'c3', body: () => [
        h('p', { class: 'wx-kicker' }, 'Wettest ride count'),
        h('p', { class: 'wx-big' }, wrappedCount(wet.length)),
        h('p', { class: 'wx-lead' }, `${wet.length === 1 ? 'trip' : 'trips'} on the water.`),
        h('p', { class: 'wx-sub' }, names.slice(0, 3).join(', ') + '.'),
      ] });
    }

    if (dark) {
      slides.push({ c: 'c7', body: () => [
        h('p', { class: 'wx-kicker' }, `${Your} darkest day`),
        h('p', { class: 'wx-big' }, wrappedCount(Math.round(dark.share * 100), '%')),
        h('h2', { class: 'wx-title sm' }, dayLabel(dark.day)),
        h('p', { class: 'wx-sub' }, 'Share of that day’s queue and ride time spent on indoor dark rides. Daylight is overrated.'),
      ] });
    }

    if (person.lands.length) {
      slides.push({ c: 'c6', body: () => [
        h('p', { class: 'wx-kicker' }, 'Land loyalty'),
        h('h2', { class: 'wx-title sm' }, person.lands[0].land),
        h('p', { class: 'wx-sub' }, `${isMe ? 'Your' : `${name}’s`} home turf: ${person.lands[0].pct}% of queue and ride time.`),
        h('div', { class: 'wx-bars' }, person.lands.slice(0, 6).map((l, i) => {
          const fillBar = h('i');
          fillBar.style.setProperty('--w', `${l.pct}%`);
          return h('div', { class: 'wx-bar' + (i === 0 ? ' on' : '') }, h('span', { class: 'wx-bar-d' }, l.land), h('span', { class: 'wx-bar-t' }, fillBar), h('b', null, `${l.pct}%`));
        })),
      ] });
    }

    if (who.shows.length) {
      slides.push({ c: 'c4', body: () => [
        h('p', { class: 'wx-lead' }, `${You} also watched`),
        h('p', { class: 'wx-big' }, wrappedCount(who.shows.length)),
        h('p', { class: 'wx-lead' }, who.shows.length === 1 ? 'show.' : 'shows.'),
        ...wrappedShowRank(showTally(who.shows)),
      ] });
    }

    for (const kind of ['food', 'shop', 'browse']) {
      const rows = who.places.filter((p) => p.kind === kind);
      if (rows.length) slides.push(wrappedPlaceSlide(kind, rows, You));
    }
    if (who.characters.length) slides.push(wrappedCharacterSlide(who.characters, You));

    who.card = { persona, thrill };
    const earned = who.badges.filter((b) => b.earned);
    slides.push({ c: 'c1', hold: true, badges: true, body: () => [
      h('p', { class: 'wx-kicker' }, `${Your} badges`),
      h('p', { class: 'wx-big' }, wrappedCount(earned.length)),
      h('p', { class: 'wx-lead' }, `of ${BADGES.length} earned.`),
      earned.length ? h('div', { class: 'wx-medals' }, earned.slice(0, 8).map((b) => h('img', { src: emblemUrl(b), alt: b.name, width: '64', height: '64' }))) : null,
      h('div', { class: 'wx-actions' }, h('button', { type: 'button', class: 'wx-btn primary', onclick: () => who.openBadges() }, 'See all badges')),
    ] });

    who.summary = () => [
      h('p', { class: 'wx-kicker' }, `${isMe ? 'My' : `${name}’s`} Disneyland Paris wrapped`),
      h('h2', { class: 'wx-title sm' }, `${persona[0]} ${persona[1]}`),
      h('dl', { class: 'wx-tiles' },
        h('div', null, h('dd', null, String(st.n)), h('dt', null, ridesLabel(st, who.shows))),
        h('div', null, h('dd', null, fmtQueued(st.queued)), h('dt', null, 'queuing')),
        h('div', null, h('dd', null, String(who.badges.filter((b) => b.earned).length)), h('dt', null, 'badges')),
        thrill ? h('div', null, h('dd', null, String(thrill.score)), h('dt', null, 'thrill score')) : null),
      h('ol', { class: 'wx-rank small' }, st.rides.slice(0, 3).map(([ride, c], i) => h('li', null,
        h('span', { class: 'wx-rank-n' }, String(i + 1)), h('span', { class: 'wx-rank-name' }, ride), h('span', { class: 'wx-rank-c' }, `×${c}`)))),
      wrappedExtras(who).length ? h('p', { class: 'wx-sub' }, wrappedExtras(who).join(' · ')) : null,
    ];
    who.shareText = () => `${isMe ? 'My' : `${name}’s`} Disneyland Paris wrapped: ${persona[1]} ${persona[0]}\n`
      + `${st.n} ${st.n === 1 ? 'ride' : 'rides'}, ${who.shows.length ? `${plural(who.shows.length, 'show')}, ` : ''}${fmtQueued(st.queued)} queuing, ${plural(who.badges.filter((b) => b.earned).length, 'badge')}. No. 1: ${st.rides[0][0]}.${wrappedExtras(who).length ? ` Also ${wrappedExtras(who).join(', ')}.` : ''}`;
    return slides;
  }

  async function loadWrappedCtx() {
    if (S.wrappedCtxLoading) return;
    S.wrappedCtxLoading = true;
    try {
      S.wrappedCtx = await api('wrapped');
      store.set('wrappedCtx', S.wrappedCtx);
      if (S.tab === 'mine') renderView();
    } catch { /* the toggle stays disabled */ }
    S.wrappedCtxLoading = false;
  }

  /** "Roast me" on Mine. Off hides your roasts from everyone, and everyone's roasts from you. */
  function roastToggle() {
    const name = S.me?.user?.name;
    if (!name) return null;
    if (!Array.isArray(S.wrappedCtx?.noRoast)) {
      S.wrappedCtx = store.get('wrappedCtx', null);
      if (!Array.isArray(S.wrappedCtx?.noRoast)) loadWrappedCtx();
    }
    const known = Array.isArray(S.wrappedCtx?.noRoast);
    const box = h('input', {
      type: 'checkbox',
      checked: known && !S.wrappedCtx.noRoast.includes(name),
      disabled: !known,
      onchange: async () => {
        box.disabled = true;
        try {
          const { noRoast } = await api('wrapped/roasts', { method: 'POST', body: { on: box.checked } });
          S.wrappedCtx.noRoast = noRoast;
          store.set('wrappedCtx', S.wrappedCtx);
          toast(box.checked ? 'Roasts on. Brave.' : 'Roasts off, for you and for anyone viewing yours');
        } catch (e) {
          box.checked = !box.checked;
          toast(e.message);
        }
        box.disabled = false;
      },
    });
    return h('label', { class: 'check-row' }, box, ' Include roast badges');
  }

  /** The closer: earned roasts with their punchlines, or a suspiciously clean record. */
  function wrappedRoastSlide(who) {
    const earned = who.roasts.filter((b) => b.earned);
    const Your = who.isMe ? 'Your' : `${who.name}’s`;
    return { c: 'c5', hold: true, scroll: true, roast: true, body: () => [
      h('p', { class: 'wx-kicker' }, 'And now, the roasts'),
      earned.length ? h('h2', { class: 'wx-title sm' }, `${Your} ${plural(earned.length, 'roast')}`) : h('h2', { class: 'wx-title sm' }, 'A clean record. Suspicious.'),
      earned.length ? h('ul', { class: 'wx-roasts' }, earned.slice(0, 3).map((b) => h('li', null,
        h('img', { src: emblemUrl(b), alt: '', width: '56', height: '56' }),
        h('span', null, h('b', null, b.name), h('small', null, `“${b.quip}”`))))) : null,
      h('div', { class: 'wx-actions' }, h('button', { type: 'button', class: 'wx-btn primary', onclick: () => who.openRoasts() }, 'See all roasts')),
    ] };
  }

  let wrappedOpen = false;

  async function openWrapped({ badges = false, summary = false, visit = null } = {}) {
    if (wrappedOpen) return;
    wrappedOpen = true;
    setWrapView(visit);
    const past = wrapView; // the app's saved copy is for the current visit only

    const dlg = h('dialog', { class: 'wx', 'aria-label': 'Trip Wrapped', tabindex: '-1' });
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const bars = h('div', { class: 'wx-progress', 'aria-hidden': 'true' });
    const stage = h('div', { class: 'wx-stage' });
    const pauseBtn = h('button', { type: 'button', class: 'wx-ctl' });
    const closeBtn = h('button', { type: 'button', class: 'wx-ctl', 'aria-label': 'Close Wrapped and open the app', onclick: () => dlg.close() }, '✕');
    const frame = h('div', { class: 'wx-frame c1' }, bars, h('div', { class: 'wx-controls' }, pauseBtn, closeBtn), stage);
    dlg.append(frame);
    document.body.append(dlg);
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    dlg.focus();
    stage.append(h('div', { class: 'wx-slide' }, h('p', { class: 'wx-lead' }, 'Wrapping up your trip…')));

    const DURATION = 7000;
    let slides = [];
    let idx = 0;
    let elapsed = 0;
    let paused = reduced;
    let holding = false;
    let closed = false;
    let last = performance.now();

    const renderPause = () => {
      pauseBtn.textContent = paused ? '▶' : '⏸';
      pauseBtn.setAttribute('aria-label', paused ? 'Play' : 'Pause');
    };
    pauseBtn.addEventListener('click', () => { paused = !paused; renderPause(); });
    renderPause();

    const setFill = (i, frac) => bars.children[i]?.firstChild?.style.setProperty('--p', String(frac));

    function countUp(el) {
      const to = Number(el.dataset.to);
      const suffix = el.dataset.suffix || '';
      if (reduced || !to) return;
      const t0 = performance.now();
      const tick = (t) => {
        if (closed || !el.isConnected) return;
        const k = Math.min(1, (t - t0) / 1100);
        el.textContent = `${Math.round(to * (1 - (1 - k) ** 3))}${suffix}`;
        if (k < 1) requestAnimationFrame(tick);
      };
      el.textContent = `0${suffix}`;
      requestAnimationFrame(tick);
    }

    function show(i) {
      idx = Math.max(0, Math.min(slides.length - 1, i));
      elapsed = 0;
      const s = slides[idx];
      frame.className = `wx-frame ${s.c}`;
      const slide = h('section', { class: 'wx-slide' + (reduced ? ' still' : '') + (s.scroll ? ' scroll' : '') }, s.body());
      stage.replaceChildren(slide);
      if (!dlg.contains(document.activeElement)) dlg.focus(); // the focused button may have just gone
      slides.forEach((_, n) => setFill(n, n < idx ? 1 : 0));
      if (s.hold || reduced) setFill(idx, 1);
      slide.querySelectorAll('.wx-count').forEach(countUp);
    }

    function play(list, at = 0) {
      slides = list;
      fill(bars, list.map(() => h('span', null, h('i'))));
      show(at);
    }

    const frameLoop = (t) => {
      if (closed) return;
      const dt = Math.min(100, t - last); // a backgrounded tab mustn't skip slides
      last = t;
      const s = slides[idx];
      if (s && !paused && !holding && !s.hold) {
        elapsed += dt;
        setFill(idx, Math.min(1, elapsed / DURATION));
        if (elapsed >= DURATION) show(idx + 1);
      }
      requestAnimationFrame(frameLoop);
    };

    // Tap the left third to go back, anywhere else to go on; press and hold to pause.
    let press = null;
    stage.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button, a')) return;
      press = { x: e.clientX, y: e.clientY, t: performance.now() };
      holding = true;
    });
    stage.addEventListener('pointerup', (e) => {
      holding = false;
      const p = press;
      press = null;
      if (!p || e.target.closest('button, a')) return;
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 12 || performance.now() - p.t > 350) return;
      const box = stage.getBoundingClientRect();
      show(idx + ((e.clientX - box.left) < box.width * 0.3 ? -1 : 1));
    });
    stage.addEventListener('pointercancel', () => { holding = false; press = null; });

    // On the document: saving disables its button, which drops focus out of the dialog.
    const onKey = (e) => {
      if (e.key === 'ArrowRight') show(idx + 1);
      else if (e.key === 'ArrowLeft') show(idx - 1);
      else if (e.key === ' ' && !e.target.closest('button, a')) {
        e.preventDefault();
        paused = !paused;
        renderPause();
      }
    };
    document.addEventListener('keydown', onKey);
    dlg.addEventListener('close', () => {
      document.removeEventListener('keydown', onKey);
      closed = true;
      wrappedOpen = false;
      dlg.remove();
    });

    // Always tell the story from the latest log; the cached copy is the offline fallback.
    let ctx = past ? null : store.get('wrappedCtx', null);
    await Promise.all([
      api('me').then((me) => { S.me = me; store.set('me', me); renderUser(); }).catch(() => {}),
      api(past ? `wrapped?visit=${past.id}` : 'wrapped').then((d) => {
        ctx = d;
        if (!past) { S.wrappedCtx = d; store.set('wrappedCtx', d); }
      }).catch(() => {}),
    ]);
    if (closed) return;

    const log = wrappedLog();
    const shows = wrappedShows();
    const places = wrappedPlaces();
    const characters = wrappedCharacters();
    const enterBtn = () => h('button', { type: 'button', class: 'wx-btn primary', onclick: () => dlg.close() }, `Open ${S.boot.appName}`);
    const everyone = wrappedStats(log);
    const byName = new Map();
    for (const l of log) {
      if (!l.by) continue;
      if (!byName.has(l.by)) byName.set(l.by, []);
      byName.get(l.by).push(l);
    }
    const people = [...byName.entries()]
      .map(([name, rows]) => {
        const earlier = (S.me?.log || []).filter((l) => l.by === name && l.day < wrapTrip().start);
        const person = wrappedPerson(rows, ctx, { others: log.filter((l) => l.by && l.by !== name), earlier, meets: wrappedCharacters().filter((m) => m.by === name && m.kind !== 'seen') });
        return {
          name,
          rows,
          st: wrappedStats(rows),
          shows: shows.filter((w) => w.by === name),
          places: places.filter((p) => p.by === name),
          characters: characters.filter((m) => m.by === name),
          isMe: rows.some((r) => r.mine),
          person,
          badges: computeBadges(person, ctx),
          roasts: roastsAllowed(ctx, name) ? computeBadges(person, ctx, ROASTS) : [],
        };
      })
      .sort((a, b) => b.st.n - a.st.n || a.name.localeCompare(b.name));
    const awards = wrappedAwards(people);

    /** Everyone's shows, including anyone who watched but never logged a ride. */
    const partyShowSlide = () => {
      const viewers = showTally(shows.filter((w) => w.by).map((w) => ({ name: w.by })));
      return { c: 'c4', body: () => [
        h('p', { class: 'wx-kicker' }, 'Showtime'),
        h('p', { class: 'wx-big' }, wrappedCount(shows.length)),
        h('p', { class: 'wx-lead' }, shows.length === 1 ? 'show watched.' : 'shows watched.'),
        ...wrappedShowRank(showTally(shows)),
        viewers.length > 1 ? h('p', { class: 'wx-sub' }, viewers.map(([n, c]) => `${n} ${c}`).join(' · ')) : null,
      ] };
    };

    /** Everything beyond rides, including anyone who did these but never logged a ride. */
    const partyExtraSlides = () => {
      const food = places.filter((p) => p.kind === 'food');
      const shops = places.filter((p) => p.kind === 'shop');
      const perused = places.filter((p) => p.kind === 'browse');
      return [
        shows.length ? partyShowSlide() : null,
        food.length ? wrappedPlaceSlide('food', food) : null,
        shops.length ? wrappedPlaceSlide('shop', shops) : null,
        perused.length ? wrappedPlaceSlide('browse', perused) : null,
        characters.length ? wrappedCharacterSlide(characters) : null,
      ].filter(Boolean);
    };

    if (!log.length) {
      play([...partyExtraSlides(), { c: 'c1', hold: true, body: () => [
        h('p', { class: 'wx-kicker' }, 'Disneyland Paris'),
        h('h2', { class: 'wx-title' }, 'That’s a wrap.'),
        h('p', { class: 'wx-sub' }, `Nobody logged a ride between ${dayLabel(wrapTrip().start)} and ${dayLabel(wrapTrip().end)}, so the memories will have to do.`),
        h('div', { class: 'wx-actions' }, enterBtn()),
      ] }]);
      requestAnimationFrame(frameLoop);
      return;
    }

    const partySlides = () => {
      const out = [];
      const peakDay = everyone.bestDay;
      out.push({ c: 'c6', body: () => [
        h('p', { class: 'wx-kicker' }, people.length > 1 ? `${people.length} riders, one trip` : 'The whole trip'),
        h('p', { class: 'wx-big' }, wrappedCount(everyone.n)),
        h('p', { class: 'wx-lead' }, everyone.n === 1 ? 'ride.' : 'rides.'),
        h('p', { class: 'wx-sub' }, [
          everyone.queued ? `${fmtQueued(everyone.queued)} of queuing in total.` : null,
          everyone.rides[0] ? `Party favourite: ${everyone.rides[0][0]} (×${everyone.rides[0][1]}).` : null,
          peakDay ? `Biggest day: ${dayLabel(peakDay[0])}.` : null,
        ].filter(Boolean).join(' ')),
      ] });
      out.push(...partyExtraSlides());
      if (people.length) {
        out.push({ c: 'c1', hold: true, scroll: true, leaderboard: true, body: () => [
          h('p', { class: 'wx-kicker' }, 'The awards'),
          h('p', { class: 'wx-hint' }, 'Tap anyone to watch their Wrapped.'),
          h('ul', { class: 'wx-awards' }, people.map((p) => {
            const a = awards.get(p.name);
            return h('li', null, h('button', { type: 'button', class: 'wx-award', onclick: () => playPerson(p) },
              h('span', { class: 'wx-award-i', 'aria-hidden': 'true' }, a.icon),
              h('span', { class: 'wx-award-t' }, h('b', null, p.isMe ? `${p.name} (you)` : p.name), h('span', null, a.title), h('small', null, `${a.why} · ${plural(p.badges.filter((b) => b.earned).length, 'badge')}`)),
              h('span', { class: 'wx-award-n' }, String(p.st.n))));
          })),
        ] });
      }
      return out;
    };

    function summarySlide(who, actions) {
      const save = (size, label) => h('button', {
        type: 'button',
        class: 'wx-btn',
        onclick: (e) => saveWith(e.currentTarget, () => saveCanvas(wrappedSocialCanvas(who, size), `${fileSafe(who.name)}-wrapped-${size}.png`)),
      }, label);
      return { c: 'c3', hold: true, summary: true, body: () => [
        ...who.summary(),
        h('div', { class: 'wx-actions' }, save('story', 'Save for Stories'), save('post', 'Save for posts')),
        h('div', { class: 'wx-actions tight' }, actions()),
        h('div', { class: 'wx-actions tight' }, h('button', {
          type: 'button',
          class: 'wx-btn',
          onclick: () => { dlg.close(); openMapHistory({ person: who.name, visit: past }); },
        }, '🗺️ See it on a map')),
      ] };
    }

    function shareBtn(who) {
      const btn = h('button', {
        type: 'button',
        class: 'wx-btn',
        onclick: async () => {
          const text = who.shareText();
          try {
            const canvas = wrappedSocialCanvas(who, 'story');
            const probe = new File([''], 'wrapped.png', { type: 'image/png' });
            if (navigator.canShare?.({ files: [probe] })) {
              await saveCanvas(canvas, `${fileSafe(who.name)}-wrapped-story.png`, { share: true });
              return;
            }
            if (navigator.share) { await navigator.share({ text }); return; }
            await navigator.clipboard.writeText(text);
            btn.textContent = 'Copied ✓';
          } catch (err) {
            if (err?.name !== 'AbortError') btn.textContent = 'Couldn’t share';
          }
        },
      }, 'Share');
      return btn;
    }

    let mainSlides = [];
    const backToEveryone = () => play(mainSlides, mainSlides.findIndex((s) => s.leaderboard));

    /** The badge wall and detail pages play as one-slide stories, then hand back to where they came from. */
    function openBadgeWall(who, list, at, roasts = false) {
      const items = roasts ? who.roasts : who.badges;
      const cats = roasts ? ROAST_CATS : BADGE_CATS;
      const label = roasts ? 'roasts' : 'badges';
      const earned = items.filter((b) => b.earned);
      const earnable = items.filter((b) => !b.untracked).length;
      // Your own roasts are yours to post. Nobody saves a picture of someone else's.
      const canSave = !roasts || who.isMe;
      const back = () => play(list, at);
      const possessive = who.isMe ? 'Your' : `${who.name}’s`;
      const wall = () => play([{ c: roasts ? 'c5' : 'c1', hold: true, scroll: true, body: () => [
        h('div', { class: 'wx-wall-head' },
          h('button', { type: 'button', class: 'wx-btn', onclick: back }, '← Back'),
          earned.length && canSave ? h('button', { type: 'button', class: 'wx-btn primary', onclick: (e) => saveWith(e.currentTarget, () => saveCanvas(badgeSheetCanvas(earned, who.name, label), `${fileSafe(who.name)}-${label}.png`)) }, 'Save all') : null),
        h('h2', { class: 'wx-title sm' }, `${possessive} ${label}`),
        h('p', { class: 'wx-sub' }, `${earned.length} of ${earnable} earned. Tap any ${label.replace(/s$/, '')}.`),
        cats.map(([cat, name]) => h('section', { class: 'wx-group' },
          h('h3', null, name),
          h('div', { class: 'wx-badges' }, items.filter((b) => b.cat === cat).map((b) => h('button', {
            type: 'button',
            class: 'wx-badge' + (b.earned ? ' on' : ''),
            'aria-label': `${b.name}: ${b.earned ? 'earned' : b.untracked ? 'not tracked' : 'not earned'}`,
            onclick: () => detail(b),
          }, h('img', { src: emblemUrl(b), alt: '', width: '72', height: '72' }), h('span', null, b.name)))))),
      ] }]);
      const detail = (b) => play([{ c: roasts ? 'c5' : 'c1', hold: true, scroll: true, body: () => [
        h('div', { class: 'wx-wall-head' }, h('button', { type: 'button', class: 'wx-btn', onclick: wall }, `← All ${label}`)),
        h('img', { class: 'wx-badge-big', src: emblemUrl(b, 384), alt: '', width: '192', height: '192' }),
        b.rare ? h('p', { class: 'wx-kicker' }, '★ Rare') : null,
        h('h2', { class: 'wx-title sm' }, b.name),
        h('p', { class: 'wx-lead small' }, b.earned ? b.evidence : b.untracked ? 'Not tracked on this trip.' : b.noData ? 'Not enough data held to check this one.' : 'Not earned this time.'),
        b.quip && b.earned ? h('p', { class: 'wx-quip' }, `“${b.quip}”`) : null,
        h('p', { class: 'wx-sub' }, b.untracked ? `${b.how} ${b.untracked}` : b.how),
        b.earned && canSave ? h('div', { class: 'wx-actions' },
          h('button', { type: 'button', class: 'wx-btn primary', onclick: (e) => saveWith(e.currentTarget, () => saveCanvas(badgeCardCanvas(b, who.name), `${fileSafe(who.name)}-${b.id}.png`)) }, 'Save image'),
          navigator.canShare ? h('button', { type: 'button', class: 'wx-btn', onclick: (e) => saveWith(e.currentTarget, () => saveCanvas(badgeCardCanvas(b, who.name), `${fileSafe(who.name)}-${b.id}.png`, { share: true })) }, 'Share') : null) : null,
      ] }]);
      wall();
    }

    async function saveWith(btn, task) {
      const label = btn.textContent;
      btn.disabled = true;
      try {
        await task();
        btn.textContent = 'Saved ✓';
      } catch {
        btn.textContent = 'Couldn’t save';
      }
      btn.disabled = false;
      setTimeout(() => { if (btn.isConnected) btn.textContent = label; }, 2500);
    }

    /** Wire a person's story to the badge wall, returning to the badges slide. */
    function whoFor(p, isMe) {
      const who = { name: p.name, isMe, st: p.st, shows: p.shows, places: p.places, characters: p.characters, person: p.person, badges: p.badges, roasts: p.roasts };
      who.openBadges = () => openBadgeWall(who, slides, idx);
      who.openRoasts = () => openBadgeWall(who, slides, idx, true);
      return who;
    }

    function playPerson(p) {
      const who = whoFor(p, p.isMe);
      const list = wrappedPersonSlides(who);
      if (who.roasts.length) list.push(wrappedRoastSlide(who));
      list.push(summarySlide(who, () => [
        h('button', { type: 'button', class: 'wx-btn primary', onclick: backToEveryone }, 'Back to everyone'),
        shareBtn(who),
      ]));
      play(list);
    }

    const me = people.find((p) => p.isMe);
    if (me) {
      const who = whoFor(me, true);
      mainSlides = wrappedPersonSlides(who);
      if (people.length > 1 || everyone.n > me.st.n || shows.length > me.shows.length || places.length > me.places.length || characters.length > me.characters.length) mainSlides.push(...partySlides());
      if (who.roasts.length) mainSlides.push(wrappedRoastSlide(who)); // last before the summary: end on a laugh
      mainSlides.push(summarySlide(who, () => [enterBtn(), shareBtn(who)]));
    } else {
      // No rides of their own (or no sign-in): the party's story still plays.
      const name = S.me?.user?.name;
      mainSlides = [{ c: 'c1', body: () => [
        h('p', { class: 'wx-kicker' }, 'Disneyland Paris'),
        h('h2', { class: 'wx-title' }, name ? `${name}, here’s the trip, wrapped.` : 'The trip, wrapped.'),
        h('p', { class: 'wx-sub' }, tripRange()),
      ] }, ...partySlides(), { c: 'c3', hold: true, body: () => [
        h('p', { class: 'wx-kicker' }, 'That’s a wrap'),
        h('h2', { class: 'wx-title' }, 'See you next time.'),
        h('div', { class: 'wx-actions' }, enterBtn()),
      ] }];
    }
    const badgesAt = mainSlides.findIndex((x) => x.badges);
    const summaryAt = mainSlides.findIndex((x) => x.summary);
    play(mainSlides, summary && summaryAt >= 0 ? summaryAt : badges && badgesAt >= 0 ? badgesAt : 0);
    last = performance.now();
    requestAnimationFrame(frameLoop);
  }

  // ----------------------------------------------------------- deep links

  function handleHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    if (!p.toString()) return;
    history.replaceState(null, '', location.pathname + location.search);
    const ride = p.get('ride');
    const tab = p.get('tab');
    if (p.get('replan')) setTimeout(() => replanFromNow(), 500);
    if (ride) {
      const park = Object.keys(S.live).find((k) => S.live[k]?.items?.some((x) => x.id === ride)) || S.park;
      S.park = park; store.set('park', park);
      S.filter = 'all';
      switchTab('now');
      S.expanded = ride;
      loadHistory(ride);
      renderView();
      requestAnimationFrame(() => document.getElementById('r-' + ride)?.scrollIntoView({ block: 'center' }));
    } else if (tab && ['now', 'shows', 'food', 'map', 'trip', 'mine', 'guide', 'about', 'features', 'docs'].includes(tab)) {
      if (tab === 'features') loadFeatures();
      if (tab === 'docs') loadDocs();
      switchTab(tab);
    }
  }

  // ================================================================
  //  Crowd calendar · touring plans · rope drop · re-optimisation · later
  // ================================================================

  S.crowd = store.get('crowd', null);
  S.pins = store.get('pins', []);
  S.crowdSel = null;
  S.crowdOpen = store.get('crowdOpen', false);
  S.tp = store.get('tp', null);
  S.ropePark = null;
  S.laterMode = false;
  let lastAutoReplan = 0;

  async function loadCrowd() {
    if (S.crowd && Date.now() - (S.crowd._at || 0) < 3600 * 1000 && S.crowd.today === today()) return;
    try {
      const d = await api('crowd-calendar');
      d._at = Date.now();
      S.crowd = d;
      store.set('crowd', d);
      if (S.tab === 'trip') renderView();
    } catch { /* keep cached */ }
  }

  async function loadTouringPlans() {
    if (S.tp && Date.now() - (S.tp._at || 0) < 6 * 3600 * 1000) return;
    try {
      const d = await api('touring-plans');
      d._at = Date.now();
      S.tp = d;
      store.set('tp', d);
      if (S.tab === 'trip') renderView();
    } catch { /* optional */ }
  }

  const seqLevel = (lv) => Math.max(1, Math.min(7, Math.ceil(lv * 0.7)));

  function crowdCalendar() {
    // The page redraws as data loads and when a day is tapped, so the state lives here. It changes on
    // the tap itself: the toggle event comes later, and a redraw in between would undo the tap.
    const card = h('details', { class: 'card day crowdcal', open: S.crowdOpen || null },
      h('summary', {
        onclick: (e) => {
          e.preventDefault();
          S.crowdOpen = !S.crowdOpen;
          store.set('crowdOpen', S.crowdOpen);
          card.open = S.crowdOpen;
        },
      }, '📆 Crowd calendar'));
    const c = S.crowd;
    if (!c) {
      add(card, h('p', { class: 'spark-lbl' }, 'Loading…'));
      return card;
    }
    const trip = new Set(tripDates());
    const pins = new Set(S.pins);
    const days = c.days;
    // Align to Monday.
    const firstDow = (new Date(days[0].date + 'T12:00:00Z').getUTCDay() + 6) % 7;
    const cells = [];
    for (let i = 0; i < firstDow; i++) cells.push(h('span', { class: 'cc-pad' }));
    for (const d of days) {
      const lv = Math.round(Object.values(d.parks).reduce((n, p) => n + p.level, 0) / Math.max(1, Object.keys(d.parks).length));
      const measured = Object.values(d.parks).some((p) => p.measured);
      const dayNum = Number(d.date.slice(8));
      cells.push(h('button', {
        type: 'button',
        class: `cc-day lv${seqLevel(lv)}` + (trip.has(d.date) ? ' trip' : '') + (d.date === c.today ? ' today' : '')
          + (S.crowdSel === d.date ? ' sel' : '') + (d.date < c.today ? ' past' : ''),
        'aria-label': `${dayLabel(d.date)}: crowd ${lv} of 10${pins.has(d.date) ? ', pinned' : ''}${trip.has(d.date) ? ', trip day' : ''}`,
        onclick: () => { S.crowdSel = S.crowdSel === d.date ? null : d.date; renderView(); },
      }, h('small', null, dayNum === 1 ? dayLabel(d.date).split(' ').slice(1).join(' ') : String(dayNum)), h('b', null, String(lv)),
      pins.has(d.date) ? h('i', { class: 'pin' }, '📌') : null, measured ? h('i', { class: 'ms' }, '✓') : null));
    }
    add(card, 
      h('div', { class: 'cc-head', 'aria-hidden': 'true' }, ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => h('span', null, x))),
      h('div', { class: 'cc-grid' }, cells),
      h('div', { class: 'bt-legend', 'aria-hidden': 'true' }, h('span', null, 'quiet'), [1, 2, 3, 4, 5, 6, 7].map((l) => h('i', { class: 'bt-cell lv' + l })), h('span', null, 'busy'),
        h('span', null, '· outlined = trip · ✓ = measured')));

    const sel = days.find((d) => d.date === S.crowdSel);
    if (sel) {
      const pinned = pins.has(sel.date);
      add(card, h('div', { class: 'cc-detail' },
        h('div', { class: 'mc-h' }, h('b', null, dayLabel(sel.date)),
          h('button', {
            type: 'button', class: 'btn small',
            onclick: () => { S.pins = pinned ? S.pins.filter((x) => x !== sel.date) : [...S.pins, sel.date].sort(); store.set('pins', S.pins); renderView(); },
          }, pinned ? '📌 Unpin' : '📌 Pin date')),
        S.boot.parks.map((p) => {
          const x = sel.parks[p.key];
          if (!x) return null;
          return h('div', { class: 'day-park' }, h('span', null, p.short),
            h('span', { class: 'hrs' },
              h('b', null, `${x.level}/10 ${x.label}`),
              x.measured ? h('div', null, `measured: ${x.measured.label} (avg ${x.measured.avgWait} min)`) : null,
              x.open ? h('div', null, `${time(x.open)}–${time(x.close)}${x.emh ? ` · EMH ${time(x.emh)}` : ''}`) : h('div', null, 'hours not published'),
              x.why.length ? h('div', null, h('small', null, x.why.join(', '))) : null));
        }),
        sel.events.length ? h('div', { class: 'spark-lbl' }, '🎉 ', sel.events.join(' · ')) : null,
        sel.reasons.length ? h('div', { class: 'spark-lbl' }, 'Why: ', sel.reasons.join(' · ')) : h('div', { class: 'spark-lbl' }, 'Why: ordinary day for the season')));
    }
    if (S.pins.length) {
      add(card, h('div', { class: 'spark-lbl' }, '📌 Pinned: ', S.pins.map((p) => {
        const d = days.find((x) => x.date === p);
        const lv = d ? Math.round(Object.values(d.parks).reduce((n, q) => n + q.level, 0) / Object.keys(d.parks).length) : null;
        return `${dayLabel(p)}${lv ? ` (${lv})` : ''}`;
      }).join(' · ')));
    }
    add(card, h('p', { class: 'foot' }, 'Predicted from school & public holidays, events, weekday, season and park hours (crowd-calendar.php); “measured” uses Park Pulse’s own wait history.'));
    return card;
  }

  function ropeDropCard() {
    const tp = S.tp;
    const card = h('section', { class: 'card day' }, h('h2', null, '🌅 Rope drop'));
    if (!tp?.ropeDrop) {
      add(card, h('p', { class: 'spark-lbl' }, 'Loading…'));
      return card;
    }
    const park = S.ropePark || S.park;
    const r = tp.ropeDrop[park];
    add(card, h('div', { class: 'qtypes' }, S.boot.parks.map((p) => chip(p.short, park === p.key, () => { S.ropePark = p.key; renderView(); }))));
    if (!r) {
      add(card, h('p', { class: 'spark-lbl' }, 'No strategy for this park yet.'));
      return card;
    }
    const live = (id) => S.live[park]?.items?.find((x) => x.id === id);
    add(card, 
      h('div', { class: 'group-h' }, 'Do these first, in order'),
      h('ol', { class: 'rd-list' }, r.first.map((x) => h('li', null, x.name, live(x.id)?.info?.height ? h('small', null, ` · ${live(x.id).info.height} cm`) : null))),
      r.fastest?.length ? h('div', { class: 'group-h' }, 'Queues that build fastest (your data)') : null,
      r.fastest?.length ? h('ul', { class: 'rd-list' }, r.fastest.map((f) => h('li', null, live(f.id)?.name || f.id, h('small', null, ` · +${f.growth} min in the first 2 h (${f.days} day${f.days === 1 ? '' : 's'})`)))) : null,
      h('div', { class: 'group-h' }, 'Open during Extra Magic Time (usually)'),
      h('p', { class: 'spark-lbl' }, r.emt.map((x) => x.name).join(' · ')),
      h('ul', { class: 'rd-tips' }, r.tips.map((t) => h('li', null, t))),
      h('p', { class: 'foot' }, 'Sources: ', (tp.sources || []).map(([label, url], i) => [i ? ' · ' : '', h('a', { href: url, target: '_blank', rel: 'noopener' }, label)])));
    return card;
  }

  /** Before opening: a nudge on Waits pointing at the rope-drop plan. */
  function ropeDropBanner() {
    const d = S.live[S.park];
    const op = d?.hours?.find((x) => x.type === 'OPERATING');
    const emh = d?.hours?.find((x) => x.type === 'EXTRA_HOURS');
    const first = Date.parse((emh || op)?.open || '');
    if (!first || Date.now() > first + 30 * 60000 || Date.now() < first - 3 * 3600000) return null;
    const r = S.tp?.ropeDrop?.[S.park];
    return h('div', { class: 'card nextup' },
      h('div', null, h('small', null, `🌅 Rope drop · ${emh ? 'EMT ' + time(emh.open) + ' · ' : ''}opens ${time(op?.open)}`),
        h('b', null, r ? r.first.slice(0, 3).map((x) => x.name).join(' → ') : 'See the rope-drop plan')),
      h('button', { type: 'button', class: 'btn small', onclick: () => { S.ropePark = S.park; switchTab('trip'); } }, 'Plan'));
  }

  /** Apply a touring-plan template to the planner's selections. */
  function applyTemplate(group) {
    const p = S.planner;
    const plan = S.tp?.plans?.[p.park]?.[group];
    if (!plan) { toast('No template for this park'); return; }
    const liveIds = new Set((S.live[p.park]?.items || []).map((x) => x.id));
    p.rides = new Set(plan.rides.map((r) => r.id).filter((id) => liveIds.has(id)));
    p.shows = new Set(plan.shows.map((s) => s.id));
    p.group = group;
    p.result = null;
    renderView();
  }

  function templateChips() {
    const groups = S.tp?.groups;
    if (!groups) return null;
    const p = S.planner;
    const tips = p.group ? S.tp.plans?.[p.park]?.[p.group]?.tips : null;
    return h('div', null,
      h('div', { class: 'group-h' }, 'Start from a touring plan'),
      h('div', { class: 'qtypes' }, Object.entries(groups).map(([k, g]) => chip(`${g.icon} ${g.label}`, p.group === k, () => applyTemplate(k), g.about))),
      p.group ? h('p', { class: 'spark-lbl' }, groups[p.group].about) : null,
      tips?.length ? h('ul', { class: 'rd-tips' }, tips.map((t) => h('li', null, t))) : null);
  }

  // ------------------------------------------------- real-time re-planning

  /** Push today's plan to the server so the whole party sees it, not just this phone. */
  function syncPlan() {
    (S.plan ? api('plan', { method: 'POST', body: { plan: S.plan } }) : api('plan', { method: 'DELETE' })).catch(() => {});
  }

  /** After each live refresh: re-optimise today's plan if reality drifted. */
  function autoReplanCheck(park) {
    const plan = S.plan;
    if (!plan || plan.date !== today() || plan.park !== park || Date.now() - lastAutoReplan < 10 * 60000) return;
    const done = new Set((S.me?.log || []).filter((l) => l.day === today()).map((l) => l.entityId));
    const next = plan.items.filter((x) => x.kind === 'ride' && x.end > Date.now() && !done.has(x.id)).slice(0, 2);
    if (!next.length) return;
    let reason = null;
    for (const x of next) {
      const it = S.live[park]?.items?.find((i) => i.id === x.id);
      if (!it) continue;
      if (it.status === 'DOWN' || it.status === 'CLOSED') { reason = `${it.name} isn’t running`; break; }
      if (it.wait != null && it.wait - x.wait >= 20) { reason = `${it.name} is ${it.wait - x.wait} min longer than planned`; break; }
    }
    if (!reason && Date.now() > next[0].start + 25 * 60000) reason = 'you’re running behind schedule';
    if (!reason) return;
    lastAutoReplan = Date.now();
    replanFromNow(true);
    toast(`Plan re-optimised — ${reason}`);
  }

  // ------------------------------------------------------- "later" view

  function laterLine(it) {
    if (it.status !== 'OPERATING' && it.status !== 'DOWN') return null;
    const close = S.live[S.park]?.hours?.find((x) => x.type === 'OPERATING')?.close;
    const end = close ? Date.parse(close) : Date.now() + 4 * 3600000;
    const base = new Date();
    base.setMinutes(0, 0, 0);
    const cells = [];
    for (let i = 1; i <= 4; i++) {
      const ms = base.getTime() + i * 3600000;
      if (ms > end) break;
      const w = predictWait(it, ms, true);
      const better = it.wait != null && w <= it.wait - 10;
      cells.push(h('span', { class: 'lt' + (better ? ' better' : '') }, h('small', null, hhmm(ms)), String(w)));
    }
    return cells.length ? h('div', { class: 'later' }, h('span', { class: 'lt now' }, h('small', null, 'now'), it.wait != null ? String(it.wait) : '–'), cells) : null;
  }

  // ================================================================
  //  Guide: hotels · dining · park info · access · transport · events
  // ================================================================

  S.guide = store.get('guide', null);
  S.guideSec = store.get('guideSec', 'hotels');
  S.ratings = store.get('ratings', {});
  S.hotelF = { budget: 0, pool: false, walk: false, noCar: false, big: false, kids: false };
  S.roomReq = new Set(['high', 'quiet']);
  S.kidHeight = store.get('kidHeight', '');

  S.menus = store.get('menus', null);
  async function loadMenus() {
    if (S.menus && Date.now() - (S.menus._at || 0) < 24 * 3600 * 1000) return;
    try {
      const d = await api('menus');
      d._at = Date.now();
      S.menus = d;
      store.set('menus', d);
      if (S.tab === 'food' || S.tab === 'guide') renderView();
    } catch { /* optional */ }
  }

  /** "Menu" button for a restaurant card: official PDF when found, else a menu directory. */
  function menuButton(it) {
    const url = S.menus?.menus?.[it.id];
    if (url) return h('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener' }, '📄 Menu');
    if (it.type === 'RESTAURANT' && S.menus?.fallback?.[0]) {
      return h('a', { class: 'btn', href: S.menus.fallback[0][1], target: '_blank', rel: 'noopener' }, '📄 Menus');
    }
    return null;
  }

  async function loadGuide() {
    if (S.guide && Date.now() - (S.guide._at || 0) < 6 * 3600 * 1000) return;
    try {
      const g = await api('guide');
      g._at = Date.now();
      S.guide = g;
      store.set('guide', g);
      if (S.tab === 'guide') renderView();
    } catch { /* keep cached */ }
  }

  async function loadRatings() {
    try {
      S.ratings = (await api('ratings?device=' + deviceId())).ratings || {};
      store.set('ratings', S.ratings);
      if (S.tab === 'food' || S.tab === 'guide') renderView();
    } catch { /* optional */ }
  }

  async function rate(it, area, stars, note) {
    try {
      S.ratings = (await api('ratings', { method: 'POST', body: { id: it.id, name: it.name, stars, note, device: deviceId(), by: myName() } })).ratings || {};
      store.set('ratings', S.ratings);
      toast(stars ? 'Thanks — rating saved for the party' : 'Rating removed');
      renderView();
    } catch (e) { toast(e.message); }
  }

  const ratingBadge = (id) => {
    const r = S.ratings?.[id];
    return r ? h('span', { class: 'rating' }, `★${r.avg} (${r.count})`) : null;
  };

  /** Rating control + party notes for an expanded restaurant card. */
  function ratingBlock(it, area) {
    const r = S.ratings?.[it.id];
    let stars = r?.mine || 0;
    const note = h('input', { type: 'text', maxlength: '300', placeholder: 'Optional note (what to order, value…)', value: r?.myNote || '' });
    const row = h('div', { class: 'stars', role: 'radiogroup', 'aria-label': 'Your rating' });
    const draw = () => row.replaceChildren(...[1, 2, 3, 4, 5].map((n) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(n === stars), 'aria-label': `${n} star${n > 1 ? 's' : ''}`,
      class: n <= stars ? 'on' : '', onclick: () => { stars = n; draw(); },
    }, '★')));
    draw();
    return h('div', { class: 'rate-box' },
      h('div', { class: 'group-h' }, r ? `Party rating ★${r.avg} from ${r.count}` : 'Rate it for the party'),
      (r?.notes || []).slice(0, 4).map((n) => h('div', { class: 'spark-lbl' }, `★${n.stars} “${n.note}”${n.by ? ' — ' + n.by : ''}`)),
      row, note,
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn small primary', onclick: () => rate(it, area, stars, note.value) }, 'Save rating'),
        r?.mine ? h('button', { type: 'button', class: 'btn small', onclick: () => rate(it, area, 0, '') }, 'Remove') : null));
  }

  // -------------------------------------------------------------- helpers

  const looseMatch = (a, b) => {
    const x = normName(a);
    const y = normName(b);
    return x === y || (x.length >= 5 && y.startsWith(x + ' ')) || (y.length >= 5 && x.startsWith(y + ' '));
  };
  const euro = (n) => '€'.repeat(n) + '·'.repeat(Math.max(0, 5 - n));
  const sec = (title, ...kids) => h('section', { class: 'card day guide-sec' }, h('h2', null, title), kids);
  const bullets = (list) => h('ul', { class: 'rd-tips' }, (list || []).map((t) => h('li', null, t)));
  const inTrip = (from, to) => (!to || to >= S.boot.trip.start) && (!from || from <= S.boot.trip.end);

  /** All restaurants we know (parks live + Village/hotels) with their area. */
  function allRestaurants() {
    const out = [];
    for (const [park, d] of Object.entries(S.live)) for (const it of d?.items || []) if (it.type === 'RESTAURANT') out.push({ it, area: park });
    for (const it of S.village?.items || []) if (it.section !== 'Shops') out.push({ it, area: 'village' });
    return out;
  }

  // --------------------------------------------------------------- views

  function viewGuide() {
    const frag = document.createDocumentFragment();
    const g = S.guide;
    if (!g) {
      add(frag, h('p', { class: 'empty' }, 'Loading the guide…'));
      return frag;
    }
    const v = { hotels: guideHotels, dining: guideDining, skip: guideSkip, park: guidePark, access: guideAccess, transport: guideTransport, events: guideEvents }[S.guideSec] || guideHotels;
    add(frag, v(g));
    add(frag, h('details', { class: 'card day sources' },
      h('summary', null, `Sources (checked ${dayLabel(g.checked)})`),
      h('ul', { class: 'rd-tips' }, (g.sources || []).map(([l, u]) => h('li', null, h('a', { href: u, target: '_blank', rel: 'noopener' }, l))))));
    return frag;
  }

  function guideHotels(g) {
    const f = S.hotelF;
    const score = (ht) => {
      if (f.budget && ht.price > f.budget) return -1;
      if (f.pool && !ht.pool) return -1;
      if (f.walk && !(ht.walk && ht.walk <= 15)) return -1;
      if (f.noCar && ht.car) return -1;
      let s = 0;
      if (f.big && ht.goodFor.includes('big-groups')) s += 3;
      if (f.kids && (ht.goodFor.includes('little-kids') || ht.goodFor.includes('families'))) s += 2;
      return s + (6 - ht.price) * 0.1;
    };
    const tog = (k) => () => { S.hotelF = { ...f, [k]: !f[k] }; renderView(); };
    const list = g.hotels.map((ht) => ({ ht, s: score(ht) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s);
    const frag = document.createDocumentFragment();
    add(frag, sec('🏨 Room finder',
      h('div', { class: 'qtypes' },
        [[0, 'Any budget'], [1, '€'], [2, '€€'], [3, '€€€'], [4, '€€€€']].map(([n, l]) => chip(l, f.budget === n, () => { S.hotelF = { ...f, budget: n }; renderView(); }))),
      h('div', { class: 'qtypes' },
        chip('🏊 Pool', f.pool, tog('pool')), chip('🚶 Walk ≤15 min', f.walk, tog('walk')), chip('🚫🚗 No car', f.noCar, tog('noCar')),
        chip('👪 5+ people', f.big, tog('big')), chip('🧸 Small kids', f.kids, tog('kids'))),
      f.big ? h('p', { class: 'spark-lbl' }, 'Groups of 5+: Davy Crockett Ranch cabins (up to 6) or an aparthotel partner (Staycity, Adagio, All Suites); otherwise book two rooms.') : null,
      list.length ? null : h('p', { class: 'empty' }, 'No Disney hotel matches all of that — loosen a filter.'),
      list.map(({ ht }) => h('div', { class: 'hotel' },
        h('div', { class: 'mc-h' }, h('b', null, ht.name), h('span', { class: 'price', 'aria-label': `price level ${ht.price} of 5` }, euro(ht.price))),
        h('div', { class: 'ride-meta' }, h('span', null, '★'.repeat(ht.stars)), h('span', null, ht.theme)),
        h('div', { class: 'facts' },
          h('div', null, `🚶 ${ht.transport}`),
          h('div', null, ht.pool ? `🏊 ${ht.pool}` : '🏊 No pool'),
          h('div', null, `🍽 Meal plan level: ${ht.mealPlan}${ht.emt ? ' · ✨ Extra Magic Time' : ''}`),
          h('div', null, ht.notes)))),
      h('div', { class: 'actions' }, h('a', { class: 'btn', href: g.hotelsUrl, target: '_blank', rel: 'noopener' }, 'Rooms & photos (official site)'))));

    add(frag, sec('🤝 Partner hotels',
      g.partners.map((p) => h('div', { class: 'day-park' }, h('span', null, h('b', null, p.name), h('small', { class: 'src' }, ` ${p.stars ? '★'.repeat(p.stars) : ''} · ${p.where}`)),
        h('span', { class: 'hrs' }, p.shuttle, h('div', null, h('small', null, p.notes))))),
      h('p', { class: 'spark-lbl' }, g.partnersNote),
      h('p', { class: 'spark-lbl' }, 'Partner hotels don’t include Extra Magic Time (Villages Nature excepted).')));

    add(frag, sec('🎁 Disney hotel benefits', bullets(g.benefits)));
    add(frag, sec('✨ Extra Magic Time', bullets(g.emt),
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn small', onclick: () => switchTab('trip') }, 'Rope-drop plan →'))));

    // Room request builder
    const hotelSel = h('select', null, g.hotels.map((ht) => h('option', { value: ht.name }, ht.name)));
    const name = h('input', { type: 'text', placeholder: 'Name on the booking', maxlength: '80' });
    const ref = h('input', { type: 'text', placeholder: 'Booking reference', maxlength: '40' });
    const extra = h('input', { type: 'text', placeholder: 'Anything else (optional)', maxlength: '200' });
    const out = h('textarea', { rows: '8', readonly: true, class: 'req-out' });
    const build = () => {
      const wants = [...S.roomReq].map((k) => g.roomRequests[k]).filter(Boolean);
      const list = wants.length ? wants.join(', ').replace(/, ([^,]*)$/, ' and $1') : 'any room you can offer';
      out.value = `Dear ${hotelSel.value} team,\n\nWe are arriving on ${dayLabel(S.boot.trip.start)} and leaving on ${dayLabel(S.boot.trip.end)}`
        + `${ref.value ? ` (booking reference ${ref.value})` : ''}. If possible, we would love ${list}.`
        + `${extra.value ? ` ${extra.value.trim()}` : ''}\n\nWe understand requests can’t be guaranteed — thank you for anything you can do!\n\nKind regards,\n${name.value || '[your name]'}`
        + `\n\n— Bonjour ! Nous arrivons le ${S.boot.trip.start}. Si possible : ${list}. Merci beaucoup !`;
    };
    for (const el of [hotelSel, name, ref, extra]) el.addEventListener('input', build);
    const chipsBox = h('div', { class: 'qtypes' });
    const drawChips = () => chipsBox.replaceChildren(...Object.entries(g.roomRequests).map(([k, label]) =>
      chip(label.replace(/^an? /, ''), S.roomReq.has(k), () => { S.roomReq.has(k) ? S.roomReq.delete(k) : S.roomReq.add(k); drawChips(); build(); })));
    drawChips();
    build();
    add(frag, sec('✉️ Room request',
      h('p', { class: 'spark-lbl' }, 'Build a polite request to send through the Disneyland Paris app chat, email or at check-in. Requests are never guaranteed.'),
      chipsBox,
      h('div', { class: 'plan-row' }, hotelSel), h('div', { class: 'plan-row' }, name, ref), extra, out,
      h('div', { class: 'actions' }, h('button', {
        type: 'button', class: 'btn primary',
        onclick: async () => { try { await navigator.clipboard.writeText(out.value); toast('Copied — paste it into your message'); } catch { out.select(); toast('Select-all and copy the text'); } },
      }, 'Copy message'))));
    return frag;
  }

  function guideDining(g) {
    const d = g.dining;
    const frag = document.createDocumentFragment();
    const rest = allRestaurants();
    const bookable = d.bookable.map((n) => rest.find((r) => looseMatch(n, r.it.name)) || { it: { id: null, name: n }, area: null });
    const tripDays = tripDates();
    const opens = (date) => { const x = new Date(date + 'T00:00:00Z'); x.setUTCMonth(x.getUTCMonth() - 2); return x.toISOString().slice(0, 10); };
    const allOpen = tripDays.every((dd) => opens(dd) <= today());
    add(frag, sec('📅 Reservation finder',
      h('p', { class: 'spark-lbl' }, allOpen
        ? 'Bookings for all your trip days are open now (2-month window).'
        : `Booking windows: ${tripDays.map((dd) => `${dayLabel(dd)} opens ${dayLabel(opens(dd))}`).join(' · ')}`),
      h('p', { class: 'spark-lbl' }, 'Live table availability isn’t public — use the official booking page/app, then add your table here so it lands in your plan and reminders.'),
      h('ul', { class: 'list' }, bookable.map(({ it, area }) => {
        const st = it.id ? foodState(it) : null;
        return h('li', { class: 'card log-item' },
          h('span', { class: 'what' }, it.name, ratingBadge(it.id),
            h('small', null, [area ? parkShort(area) : null, st ? st.text : null].filter(Boolean).join(' · '))),
          h('button', { type: 'button', class: 'btn small', onclick: () => openBookingSheet(it.name) }, '+ Add'));
      })),
      h('div', { class: 'actions' },
        h('a', { class: 'btn primary', href: d.bookingUrl, target: '_blank', rel: 'noopener' }, 'Book on disneylandparis.com'),
        h('a', { class: 'btn', href: 'tel:' + d.phone.replace(/\s/g, '') }, `📞 ${d.phone}`)),
      bullets(d.rules)));

    const rated = rest.filter((r) => S.ratings?.[r.it.id]).sort((a, b) => S.ratings[b.it.id].avg - S.ratings[a.it.id].avg);
    add(frag, sec('⭐ Party ratings',
      rated.length
        ? h('ul', { class: 'list' }, rated.map(({ it, area }) => h('li', { class: 'card log-item' },
          h('span', { class: 'what' }, it.name, h('small', null, `${parkShort(area)} · ${S.ratings[it.id].count} rating(s)`)),
          h('b', null, `★${S.ratings[it.id].avg}`))))
        : h('p', { class: 'spark-lbl' }, 'No ratings yet. Open any restaurant on Eat & shop and rate it — everyone in your party sees the average and notes.')));
    const menuCount = S.menus ? Object.values(S.menus.menus || {}).filter(Boolean).length : 0;
    const withMenu = rest.filter((r) => S.menus?.menus?.[r.it.id]).sort((a, b) => a.it.name.localeCompare(b.it.name));
    add(frag, sec('📄 Menus',
      h('p', { class: 'spark-lbl' }, S.menus
        ? `Official Disney menu PDFs found for ${menuCount} park restaurants (checked weekly). Also on each restaurant card in Eat & shop.`
        : 'Looking up official menus…'),
      withMenu.length ? h('ul', { class: 'list' }, withMenu.map(({ it, area }) => h('li', { class: 'card log-item' },
        h('span', { class: 'what' }, it.name, h('small', null, parkShort(area))),
        h('a', { class: 'btn small', href: S.menus.menus[it.id], target: '_blank', rel: 'noopener' }, '📄 PDF')))) : null,
      h('p', { class: 'spark-lbl' }, 'Not listed (Disney Village, hotels, and a few park restaurants): ',
        (S.menus?.fallback || []).map(([l, u], i) => [i ? ' · ' : '', h('a', { href: u, target: '_blank', rel: 'noopener' }, l)]))));
    add(frag, sec('🍽 Dining plans & meal vouchers', bullets(d.plans)));
    return frag;
  }

  function guidePark(g) {
    const frag = document.createDocumentFragment();
    const kh = Number(S.kidHeight) || 0;
    const input = h('input', { type: 'number', inputmode: 'numeric', min: '50', max: '200', placeholder: 'cm', value: S.kidHeight, class: 'kid-h' });
    input.addEventListener('change', () => { S.kidHeight = input.value; store.set('kidHeight', input.value); renderView(); });

    const dir = [];
    for (const p of S.boot.parks) {
      const items = (S.live[p.key]?.items || []).filter((it) => it.type === 'ATTRACTION');
      if (!items.length) continue;
      const lands = new Map();
      for (const it of items.sort((a, b) => a.name.localeCompare(b.name))) {
        const k = it.land || 'Other';
        if (!lands.has(k)) lands.set(k, []);
        lands.get(k).push(it);
      }
      const ok = kh ? items.filter((it) => !it.info?.height || it.info.height <= kh).length : null;
      dir.push(h('details', { class: 'land-dir', open: S.park === p.key || null },
        h('summary', null, `${p.short} · ${items.length} rides${ok != null ? ` · ${ok} OK at ${kh} cm` : ''}`),
        [...lands.entries()].sort((a, b) => (a[0] === 'Other') - (b[0] === 'Other') || a[0].localeCompare(b[0])).map(([land, list]) => [
          h('div', { class: 'group-h' }, land),
          list.map((it) => {
            const tooShort = kh && it.info?.height && it.info.height > kh;
            return h('div', { class: 'dir-row' + (tooShort ? ' no' : '') },
              h('span', { class: 'what' }, it.name, h('small', null, [it.info ? RIDE_WHERE[it.info.where] : null, it.info ? ['', 'gentle', 'moderate', 'intense'][it.info.thrill] : null].filter(Boolean).join(' · '))),
              it.info?.height ? h('span', { class: 'hbadge' + (tooShort ? ' no' : '') }, `${it.info.height} cm`) : h('span', { class: 'hbadge any' }, 'any'),
              h('span', { class: 'dir-st' }, it.status === 'OPERATING' ? (it.wait != null ? `${it.wait}′` : 'open') : it.status === 'REFURBISHMENT' ? 'refurb' : it.status.toLowerCase()));
          }),
        ])));
    }
    add(frag, sec('🎢 Attractions, lands & heights',
      h('div', { class: 'plan-row' }, h('label', null, 'Child’s height ', input), kh ? h('small', { class: 'src' }, 'Rides above this height are greyed out') : null),
      dir.length ? dir : h('p', { class: 'spark-lbl' }, 'Loading live ride data…'),
      h('p', { class: 'foot' }, 'Heights & indoor/outdoor: ride-info.php · lands estimated via Queue-Times · status live.')));

    // Refurbishments
    const liveRefurb = [];
    for (const [park, d] of Object.entries(S.live)) for (const it of d?.items || []) if (it.status === 'REFURBISHMENT') liveRefurb.push(`${it.name} (${parkShort(park)})`);
    add(frag, sec('🛠 Refurbishments & closures',
      liveRefurb.length ? h('p', null, h('b', null, 'Closed right now: '), liveRefurb.join(' · ')) : null,
      h('ul', { class: 'list' }, g.refurbs.map(([name, from, to, what]) => h('li', { class: 'card log-item' + (inTrip(from, to) ? ' trip-hit' : '') },
        h('span', { class: 'what' }, name, h('small', null, what)),
        h('span', { class: 'when wide' }, from ? `${dayLabel(from)}${to ? ' – ' + dayLabel(to) : ' →'}` : 'TBA',
          inTrip(from, to) ? h('small', { class: 'up' }, 'during your trip') : null))))));

    // Shows, parades, character meets (today, live)
    const shows = [];
    for (const [park, d] of Object.entries(S.live)) {
      for (const it of d?.items || []) {
        if (it.type !== 'SHOW' || it.reserved || !showOnToday(it)) continue; // not running today: leave it out, not "done today"
        const next = (it.showtimes || []).map((x) => x.start).filter((x) => Date.parse(x) > Date.now() && parkDate(new Date(x)) === today()).sort();
        shows.push({ it, park, next });
      }
    }
    const isBig = (n) => /parade|tales of magic|cascade|illuminat|dream|firework|light|celebration/i.test(n);
    const showList = (list) => list.length
      ? h('ul', { class: 'list' }, list.map(({ it, park, next }) => h('li', { class: 'card log-item' },
        h('span', { class: 'what' }, it.name, h('small', null, parkShort(park))),
        h('span', { class: 'when wide' }, next.length ? next.slice(0, 3).map((x) => time(x)).join(', ') : 'done today'))))
      : h('p', { class: 'spark-lbl' }, 'Nothing scheduled for the rest of today.');
    add(frag, sec('🎆 Parades, night shows & fireworks (today)', showList(shows.filter((s) => isBig(s.it.name))),
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn small', onclick: () => switchTab('shows') }, 'All shows →'), h('button', { type: 'button', class: 'btn small', onclick: () => switchTab('trip') }, 'Trip-day schedules →'))));
    add(frag, sec('🐭 Character meets (today)', showList(shows.filter((s) => isMeet(s.it.name)))));
    add(frag, sec('🔁 Rider Switch', bullets(g.riderSwitch)));
    return frag;
  }

  function guideAccess(g) {
    return sec('♿ Accessibility (Priority & Easy Access cards)', bullets(g.access),
      h('div', { class: 'actions' }, h('a', { class: 'btn', href: g.accessUrl, target: '_blank', rel: 'noopener' }, 'Official accessibility guide (PDF)')));
  }

  function guideTransport(g) {
    const frag = document.createDocumentFragment();
    for (const t of g.transport) add(frag, sec(`${t.icon} ${t.title}`, bullets(t.lines)));
    if (S.boot.transit) add(frag, transitCard());
    return frag;
  }

  function guideEvents(g) {
    return sec('🎉 Seasonal events', h('ul', { class: 'list' }, g.events.map(([name, from, to, about]) => {
      const now = from && to && today() >= from && today() <= to;
      return h('li', { class: 'card log-item' + (from && inTrip(from, to) ? ' trip-hit' : '') },
        h('span', { class: 'what' }, name, h('small', null, about)),
        h('span', { class: 'when wide' }, from ? (from === to ? dayLabel(from) : `${dayLabel(from)} – ${dayLabel(to)}`) : 'TBA',
          now ? h('small', { class: 'down' }, 'on now') : (from && inTrip(from, to) ? h('small', { class: 'up' }, 'during your trip') : null)));
    })));
  }

  // ================================================================
  //  Skip the line: Premier Access "is it worth it?", single rider, VQ
  // ================================================================

  S.timeValue = store.get('timeValue', 15); // € per hour of queuing you'd pay to avoid
  S.ultPrice = store.get('ultPrice', '');
  S.skipPark = null;
  const PA_QUEUE_MIN = 10; // typical Premier Access line once you scan in

  const paPrice = (p) => (p?.amount != null ? p.amount : (parseFloat(String(p?.price || '').replace(/[^\d,.]/g, '').replace(',', '.')) || null));

  /**
   * Verdict for buying Premier Access One on this ride right now:
   * minutes saved at your return time vs price, single rider, and waiting for a quieter hour.
   */
  function worthIt(it, park) {
    const p = it.paid;
    if (!p) return null;
    const price = paPrice(p);
    if (it.status !== 'OPERATING') return { v: 'na', label: 'Ride not running', reason: 'Premier Access can’t be used while the ride is down or closed.', price };
    if (p.state !== 'AVAILABLE') {
      const st = { FINISHED: 'Sold out today', TEMP_FULL: 'Temporarily full', NOT_STARTED: 'Not on sale yet' };
      return { v: 'na', label: st[p.state] || 'Unavailable', reason: 'Check back later in the app.', price };
    }
    const now = Date.now();
    const rideAt = p.returnStart ? Math.max(now, Date.parse(p.returnStart)) : now;
    const standbyThen = rideAt - now < 15 * 60000 && it.wait != null ? it.wait : predictWait(it, rideAt, true);
    const saved = Math.max(0, standbyThen - PA_QUEUE_MIN);
    const close = Date.parse(S.live[park]?.hours?.find((x) => x.type === 'OPERATING')?.close || '') || now + 6 * 3600000;
    let best = { w: it.wait ?? standbyThen, t: now };
    const base = new Date(); base.setMinutes(0, 0, 0);
    for (let ms = base.getTime() + 3600000; ms < close - 30 * 60000; ms += 3600000) {
      const w = predictWait(it, ms, true);
      if (w < best.w) best = { w, t: ms };
    }
    const perMin = saved > 0 && price ? price / saved : Infinity;
    const limit = S.timeValue / 60;
    const ret = p.returnStart ? ` · return ${time(p.returnStart)}` : '';
    const money = price != null ? `€${price % 1 ? price.toFixed(2) : price}` : 'the price';
    if (it.singleRider != null && it.wait != null && it.singleRider <= 15 && it.wait - it.singleRider >= 15) {
      return { v: 'sr', label: 'Use single rider', reason: `Single rider ${it.singleRider} min vs standby ${it.wait} — free, if your group can ride apart.`, price };
    }
    if (saved < 15) return { v: 'no', label: 'Not worth it', reason: `Standby ~${standbyThen} min${p.returnStart ? ' at your return time' : ''} — saves only ~${saved} min${ret}.`, price };
    if (best.w <= 15 && best.t > now + 30 * 60000) return { v: 'wait', label: 'Wait instead', reason: `Usually ~${best.w} min around ${hhmm(best.t)} — free.`, price };
    const why = `Saves ~${saved} min for ${money} (≈€${perMin.toFixed(2)}/min)${ret}.`;
    if (perMin <= limit) return { v: 'yes', label: 'Worth it', reason: why, price };
    if (perMin <= limit * 2) return { v: 'maybe', label: 'Maybe', reason: why, price };
    return { v: 'no', label: 'Probably not', reason: why, price };
  }

  const verdictBadge = (w) => h('span', { class: 'verdict v-' + w.v }, w.label);

  function guideSkip(g) {
    const sk = g.skip || {};
    const frag = document.createDocumentFragment();
    const park = S.skipPark || S.park;
    const items = (S.live[park]?.items || []).filter((it) => it.type === 'ATTRACTION');
    const pa = items.filter((it) => it.paid).map((it) => ({ it, w: worthIt(it, park) }));
    const order = { yes: 0, sr: 1, maybe: 2, wait: 3, no: 4, na: 5 };
    pa.sort((a, b) => order[a.w.v] - order[b.w.v] || (b.it.wait ?? 0) - (a.it.wait ?? 0));

    const tv = h('input', { type: 'number', min: '0', max: '200', step: '5', value: S.timeValue, class: 'kid-h', inputmode: 'numeric' });
    tv.addEventListener('change', () => { S.timeValue = Math.max(0, Number(tv.value) || 0); store.set('timeValue', S.timeValue); renderView(); });
    add(frag, sec('⚡ Is Premier Access worth it right now?',
      h('div', { class: 'qtypes' }, S.boot.parks.map((p) => chip(p.short, park === p.key, () => { S.skipPark = p.key; renderView(); }))),
      h('div', { class: 'plan-row' }, h('label', null, 'An hour of queuing is worth €', tv, ' to me')),
      pa.length ? h('ul', { class: 'list' }, pa.map(({ it, w }) => h('li', { class: 'card worth' },
        h('div', { class: 'mc-h' }, h('b', null, it.name), verdictBadge(w)),
        h('div', { class: 'ride-meta' },
          h('span', null, it.status === 'OPERATING' ? `Standby ${it.wait ?? '–'} min` : it.status.toLowerCase()),
          it.singleRider != null ? h('span', null, `Single rider ${it.singleRider}`) : null,
          h('span', null, `PA ${it.paid.price || '–'}${it.paid.returnStart ? ' · ' + time(it.paid.returnStart) : ''}`),
          it.paTrend?.sellsOutAt ? h('span', { class: 'up' }, `likely gone ~${time(it.paTrend.sellsOutAt)}`) : null),
        h('div', { class: 'spark-lbl' }, w.reason)))) : h('p', { class: 'spark-lbl' }, S.live[park] ? 'No Premier Access data for this park right now (often outside park hours).' : 'Loading live data…'),
      h('p', { class: 'foot' }, `Assumes ~${PA_QUEUE_MIN} min in the Premier Access line; predictions use your wait history (or a typical-day curve). Prices & return times are live.`)));

    // Ultimate break-even
    const favs = new Set((S.me?.favourites || []).map((f) => f.id));
    const allPa = Object.entries(S.live).flatMap(([pk, d]) => (d?.items || []).filter((it) => it.paid && paPrice(it.paid)).map((it) => ({ it, pk })));
    const chosen = allPa.filter(({ it }) => favs.has(it.id));
    const pool = chosen.length ? chosen : allPa;
    const sum = pool.reduce((n, { it }) => n + paPrice(it.paid), 0);
    const up = h('input', { type: 'number', min: '0', step: '1', value: S.ultPrice, placeholder: '€', class: 'kid-h', inputmode: 'decimal' });
    up.addEventListener('change', () => { S.ultPrice = up.value; store.set('ultPrice', up.value); renderView(); });
    const ult = Number(S.ultPrice) || 0;
    let msg = 'Enter today’s Ultimate price from the app to compare.';
    if (ult && pool.length) {
      const sorted = pool.map(({ it }) => paPrice(it.paid)).sort((a, b) => b - a);
      let acc = 0; let k = 0;
      while (k < sorted.length && acc < ult) acc += sorted[++k - 1];
      msg = sum <= ult
        ? `Buying One for ${chosen.length ? 'your ' + pool.length + ' must-dos' : 'every ride listed'} costs €${sum.toFixed(0)} — less than Ultimate (€${ult}). Skip Ultimate.`
        : `Ultimate (€${ult}) beats buying One once you’d use ${k}+ of the priciest rides (One total for ${chosen.length ? 'your must-dos' : 'all'}: €${sum.toFixed(0)}).`;
    }
    add(frag, sec('🎟 Premier Access Ultimate — does it pay off?',
      h('div', { class: 'plan-row' }, h('label', null, 'Ultimate price today €', up)),
      h('p', null, msg),
      h('p', { class: 'spark-lbl' }, chosen.length ? `Using your ${chosen.length} must-do ride(s) with Premier Access.` : 'Tip: ★ rides as must-dos to compare just the ones you want.'),
      bullets(sk.ultimate)));
    add(frag, sec('1️⃣ Premier Access One', bullets(sk.one)));

    // Single rider (live)
    const srRows = Object.entries(S.live).flatMap(([pk, d]) => (d?.items || [])
      .filter((it) => it.type === 'ATTRACTION' && it.singleRider != null).map((it) => ({ it, pk })));
    srRows.sort((a, b) => ((b.it.wait ?? 0) - (b.it.singleRider ?? 0)) - ((a.it.wait ?? 0) - (a.it.singleRider ?? 0)));
    add(frag, sec('🧍 Single rider lines',
      srRows.length ? h('ul', { class: 'list' }, srRows.map(({ it, pk }) => h('li', { class: 'card log-item' },
        h('span', { class: 'what' }, it.name, h('small', null, parkShort(pk))),
        h('span', { class: 'when wide' }, `${it.singleRider} vs ${it.wait ?? '–'} min`,
          it.wait != null && it.wait - it.singleRider >= 10 ? h('small', { class: 'down' }, `saves ${it.wait - it.singleRider} min`) : null)))) : h('p', { class: 'spark-lbl' }, 'No single rider waits reported right now.'),
      bullets(sk.single)));

    add(frag, sec('📲 Virtual queues', bullets(sk.virtual)));
    add(frag, h('p', { class: 'foot' }, 'Sources: ', (sk.sources || []).map(([l, u], i) => [i ? ' · ' : '', h('a', { href: u, target: '_blank', rel: 'noopener' }, l)])));
    return frag;
  }

  // ================================================================
  //  Live walking navigation (OpenStreetMap paths, routed on the phone)
  // ================================================================

  S.nav = null;
  S.navVoice = store.get('navVoice', false);
  S.navNoSteps = store.get('navNoSteps', false);
  let walkGraph = null;
  let walkGraphLoading = null;
  let wakeLock = null;
  const WALK_M_PER_MIN = 75;

  async function loadWalkGraph() {
    if (walkGraph) return walkGraph;
    if (walkGraphLoading) return walkGraphLoading;
    walkGraphLoading = (async () => {
      const d = await api('walk-graph');
      const n = d.nodes.length;
      const lat = new Float64Array(n);
      const lng = new Float64Array(n);
      const grid = new Map();
      const cell = (la, ln) => `${Math.floor(la / 0.0005)}:${Math.floor(ln / 0.0007)}`;
      for (let i = 0; i < n; i++) {
        lat[i] = d.nodes[i][0];
        lng[i] = d.nodes[i][1];
        const k = cell(lat[i], lng[i]);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(i);
      }
      const adj = Array.from({ length: n }, () => []);
      for (const [a, b, len, kind] of d.edges) {
        const cost = len * (kind === 1 ? 1.3 : kind === 2 ? 1.6 : 1); // prefer footpaths over steps/service roads
        adj[a].push(b, cost, len, kind);
        adj[b].push(a, cost, len, kind);
      }
      walkGraph = { n, lat, lng, adj, grid, cell };
      return walkGraph;
    })();
    try { return await walkGraphLoading; } finally { walkGraphLoading = null; }
  }

  const gm = (aLat, aLng, bLat, bLng) => PPMap.metres({ lat: aLat, lng: aLng }, { lat: bLat, lng: bLng });

  function nearestNode(g, p) {
    const ci = Math.floor(p.lat / 0.0005);
    const cj = Math.floor(p.lng / 0.0007);
    let best = -1;
    let bestD = Infinity;
    for (let r = 1; r <= 4 && best < 0; r++) {
      for (let i = ci - r; i <= ci + r; i++) {
        for (let j = cj - r; j <= cj + r; j++) {
          for (const k of g.grid.get(`${i}:${j}`) || []) {
            const dd = gm(p.lat, p.lng, g.lat[k], g.lng[k]);
            if (dd < bestD) { bestD = dd; best = k; }
          }
        }
      }
    }
    return best < 0 ? null : { i: best, d: bestD };
  }

  /** A* over the walking graph; returns node indices or null. */
  function aStar(g, s, t, noSteps) {
    const dist = new Float64Array(g.n).fill(Infinity);
    const prev = new Int32Array(g.n).fill(-1);
    const closed = new Uint8Array(g.n);
    const heap = []; // [f, node]
    const push = (f, v) => {
      heap.push([f, v]);
      let i = heap.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1; const r = l + 1; let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
        }
      }
      return top;
    };
    const hcost = (v) => gm(g.lat[v], g.lng[v], g.lat[t], g.lng[t]);
    dist[s] = 0;
    push(hcost(s), s);
    while (heap.length) {
      const [, u] = pop();
      if (u === t) break;
      if (closed[u]) continue;
      closed[u] = 1;
      const a = g.adj[u];
      for (let k = 0; k < a.length; k += 4) {
        if (noSteps && a[k + 3] === 1) continue; // step-free: skip stairs
        const v = a[k];
        const nd = dist[u] + a[k + 1];
        if (nd < dist[v]) { dist[v] = nd; prev[v] = u; push(nd + hcost(v), v); }
      }
    }
    if (!Number.isFinite(dist[t])) return null;
    const path = [];
    for (let v = t; v !== -1; v = prev[v]) path.push(v);
    return path.reverse();
  }

  const bearing = (a, b) => (Math.atan2((b.lng - a.lng) * Math.cos((a.lat * Math.PI) / 180), b.lat - a.lat) * 180) / Math.PI;

  /** Route geometry + cumulative distances + turn instructions. */
  function buildRoute(g, from, dest) {
    const s = nearestNode(g, from);
    const t = nearestNode(g, dest);
    if (!s || !t) return null;
    let path = aStar(g, s.i, t.i, S.navNoSteps);
    let stepFree = S.navNoSteps;
    if (!path && S.navNoSteps) { path = aStar(g, s.i, t.i, false); stepFree = false; } // no step-free way: fall back
    if (!path) return null;
    const pts = path.map((i) => ({ lat: g.lat[i], lng: g.lng[i] }));
    if (PPMap.metres(pts[pts.length - 1], dest) > 5) pts.push({ lat: dest.lat, lng: dest.lng });
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + PPMap.metres(pts[i - 1], pts[i]));
    // Point at distance d along the route (for smoothed bearings).
    const at = (d) => {
      d = Math.max(0, Math.min(cum[cum.length - 1], d));
      let i = 1;
      while (i < cum.length - 1 && cum[i] < d) i++;
      const seg = cum[i] - cum[i - 1] || 1;
      const f = (d - cum[i - 1]) / seg;
      return { lat: pts[i - 1].lat + (pts[i].lat - pts[i - 1].lat) * f, lng: pts[i - 1].lng + (pts[i].lng - pts[i - 1].lng) * f };
    };
    const turns = [];
    for (let i = 1; i < pts.length - 1 && i < path.length; i++) {
      const d = cum[i];
      if (d < 8 || cum[cum.length - 1] - d < 8) continue;
      if (g.adj[path[i]].length / 4 < 3) continue; // only where paths actually meet
      let delta = bearing(pts[i], at(d + 12)) - bearing(at(d - 12), pts[i]);
      delta = ((delta + 540) % 360) - 180;
      const ad = Math.abs(delta);
      if (ad < 40) continue;
      const side = delta > 0 ? 'right' : 'left';
      const text = ad > 125 ? `Sharp ${side}` : ad < 60 ? `Bear ${side}` : `Turn ${side}`;
      const prevTurn = turns[turns.length - 1];
      if (prevTurn && d - prevTurn.dist < 15) { if (ad > prevTurn.ad) turns[turns.length - 1] = { dist: d, text, ad, side }; continue; }
      turns.push({ dist: d, text, ad, side });
    }
    const steps = path.slice(1).some((v, i) => { const a = g.adj[path[i]]; for (let k = 0; k < a.length; k += 4) if (a[k] === v) return a[k + 3] === 1; return false; });
    return { pts, cum, turns, total: cum[cum.length - 1], snapFrom: s.d, stepFree: stepFree || !steps, hasSteps: steps };
  }

  function speak(text) {
    if (!S.navVoice || !('speechSynthesis' in window)) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-GB';
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch { /* ignore */ }
  }

  async function keepAwake(on) {
    try {
      if (on && 'wakeLock' in navigator && !wakeLock) wakeLock = await navigator.wakeLock.request('screen');
      if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch { /* not supported / denied */ }
  }

  async function startNav(place) {
    startGeo();
    if (!S.geo) { toast('Waiting for your location… tap Go again in a moment'); return; }
    if (!atResort()) {
      toast('In-park navigation works once you’re at the resort — use Google or Apple Maps to get there');
      return;
    }
    toast('Planning your route…');
    let g;
    try { g = await loadWalkGraph(); } catch (e) { toast('Couldn’t load the path network: ' + e.message); return; }
    const r = buildRoute(g, S.geo, place);
    if (!r) { toast('No walking route found to there'); return; }
    S.nav = { dest: { id: place.id, name: place.name, lat: place.lat, lng: place.lng }, r, seg: 0, off: 0, lastReroute: Date.now(), spoken: new Set(), arrived: false };
    followMe = true;
    keepAwake(true);
    map?.setRoute(r.pts, 0);
    map?.setView(S.geo.lat, S.geo.lng, Math.max(map.z, 18));
    speak(`Route to ${place.name}. About ${Math.max(1, Math.round(r.total / WALK_M_PER_MIN))} minutes.`);
    renderMapCard();
  }

  function stopNav(msg) {
    S.nav = null;
    keepAwake(false);
    map?.setRoute(null);
    if (msg) toast(msg);
    renderMapCard();
  }

  /** Called on every GPS fix while navigating. */
  async function updateNav() {
    const nav = S.nav;
    if (!nav || !S.geo) return;
    const { pts, cum } = nav.r;
    // Project the user onto the route near the last known segment.
    let best = { d: Infinity, i: nav.seg, along: cum[nav.seg] };
    const from = Math.max(0, nav.seg - 5);
    const to = Math.min(pts.length - 1, nav.seg + 80);
    for (let i = from + 1; i <= to; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const kx = 111320 * Math.cos((a.lat * Math.PI) / 180);
      const ax = 0; const ay = 0;
      const bx = (b.lng - a.lng) * kx; const by = (b.lat - a.lat) * 111320;
      const px = (S.geo.lng - a.lng) * kx; const py = (S.geo.lat - a.lat) * 111320;
      const L = bx * bx + by * by || 1;
      const t = Math.max(0, Math.min(1, ((px - ax) * bx + (py - ay) * by) / L));
      const d = Math.hypot(px - t * bx, py - t * by);
      if (d < best.d) best = { d, i: i - 1, along: cum[i - 1] + t * Math.sqrt(L) };
    }
    nav.seg = best.i;
    const remaining = Math.max(0, nav.r.total - best.along);

    if (remaining < 15 || PPMap.metres(S.geo, nav.dest) < 15) {
      speak(`You have arrived at ${nav.dest.name}.`);
      toast(`🎉 You’ve arrived at ${nav.dest.name}`);
      stopNav();
      return;
    }

    // Off route? Re-plan from here (needs two bad fixes in a row and 8 s since the last re-plan).
    const tol = Math.max(30, Math.min(60, (S.geo.acc || 20) * 1.2));
    nav.off = best.d > tol ? nav.off + 1 : 0;
    if (nav.off >= 2 && Date.now() - nav.lastReroute > 8000) {
      const g = await loadWalkGraph().catch(() => null);
      const r = g && buildRoute(g, S.geo, nav.dest);
      if (r) {
        nav.r = r; nav.seg = 0; nav.off = 0; nav.lastReroute = Date.now(); nav.spoken = new Set();
        speak('Re-routing.');
        toast('Re-routing…');
        map?.setRoute(r.pts, 0);
        renderMapCard();
        return;
      }
    }

    const next = nav.r.turns.find((t) => t.dist > best.along + 3);
    nav.next = next ? { text: next.text, inM: Math.round(next.dist - best.along), dist: next.dist } : null;
    nav.remaining = remaining;
    if (next && next.dist - best.along < 25 && !nav.spoken.has(next.dist)) {
      nav.spoken.add(next.dist);
      if (!/^Bear/.test(next.text)) speak(next.text); // slight bends: on screen only
    }
    map?.setRoute(pts, nav.seg);
    if (followMe) map?.setView(S.geo.lat, S.geo.lng);
    renderNavPanel();
  }

  function renderNavPanel() {
    const card = $('#mapCard');
    const nav = S.nav;
    if (!card || !nav) return;
    const rem = nav.remaining ?? nav.r.total;
    const mins = Math.max(1, Math.round((rem * 1.0) / WALK_M_PER_MIN));
    const dist = rem < 1000 ? `${Math.round(rem / 10) * 10} m` : `${(rem / 1000).toFixed(1)} km`;
    const arrow = !nav.next ? '⬆' : /left/i.test(nav.next.text) ? (/Sharp/.test(nav.next.text) ? '↰' : /Bear/.test(nav.next.text) ? '↖' : '⬅') : (/Sharp/.test(nav.next.text) ? '↱' : /Bear/.test(nav.next.text) ? '↗' : '➡');
    card.hidden = false;
    card.classList.add('nav-on');
    card.replaceChildren(
      h('div', { class: 'nav-step' },
        h('span', { class: 'nav-arrow', 'aria-hidden': 'true' }, arrow),
        h('div', null,
          h('b', null, nav.next ? `${nav.next.text} in ${Math.max(5, Math.round(nav.next.inM / 5) * 5)} m` : `Continue to ${nav.dest.name}`),
          h('small', null, `${nav.dest.name} · ${dist} · ~${mins} min${S.navNoSteps ? (nav.r.hasSteps ? ' · ⚠ includes steps (no step-free way)' : ' · step-free') : ''}`))),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn small', onclick: () => { followMe = true; if (S.geo) map.setView(S.geo.lat, S.geo.lng, Math.max(map.z, 18)); } }, '◎ Follow'),
        h('button', {
          type: 'button', class: 'btn small', 'aria-pressed': String(S.navVoice),
          onclick: () => { S.navVoice = !S.navVoice; store.set('navVoice', S.navVoice); if (S.navVoice) speak('Voice on'); renderNavPanel(); },
        }, S.navVoice ? '🔊 Voice' : '🔇 Voice'),
        h('button', {
          type: 'button', class: 'btn small', 'aria-pressed': String(S.navNoSteps), title: 'Avoid steps (pushchairs, wheelchairs)',
          onclick: async () => {
            S.navNoSteps = !S.navNoSteps; store.set('navNoSteps', S.navNoSteps);
            const g = await loadWalkGraph().catch(() => null);
            const r = g && S.geo && S.nav && buildRoute(g, S.geo, S.nav.dest);
            if (r) { S.nav.r = r; S.nav.seg = 0; S.nav.spoken = new Set(); map?.setRoute(r.pts, 0); }
            toast(S.navNoSteps ? 'Step-free route' : 'Fastest route');
            renderNavPanel();
          },
        }, S.navNoSteps ? '♿ Step-free' : '♿ Steps OK'),
        h('button', { type: 'button', class: 'btn small danger', onclick: () => stopNav('Navigation stopped') }, 'Stop')));
  }

  // ================================================================
  //  Essentials · What now? · leave alerts · last chance
  // ================================================================

  // cat = which map toggle shows it (ess = core essentials).
  const ESS = {
    toilets: { icon: '🚻', label: 'Toilets', cat: 'ess' },
    water: { icon: '🚰', label: 'Drinking water', cat: 'ess' },
    firstaid: { icon: '⛑', label: 'First aid', cat: 'ess' },
    aed: { icon: '❤️', label: 'Defibrillator', cat: 'ess' },
    cash: { icon: '🏧', label: 'Cash machine', cat: 'ess' },
    lockers: { icon: '🔒', label: 'Lockers', cat: 'ess' },
    baby: { icon: '👶', label: 'Baby care', cat: 'ess' },
    shelter: { icon: '☂️', label: 'Rain shelter', cat: 'rain' },
    seat: { icon: '🪑', label: 'Seating', cat: 'seat' },
    smoking: { icon: '🚬', label: 'Smoking area', cat: 'smoke' },
    viewpoint: { icon: '📸', label: 'Viewpoint', cat: 'view' },
  };
  const essLabel = (e) => e.name || (e.type === 'shelter' && e.walkway ? 'Covered walkway' : ESS[e.type].label);

  async function loadEssentials() {
    if (S.ess && Date.now() - (S.ess._at || 0) < 24 * 3600 * 1000) return S.ess;
    try {
      const d = await api('essentials');
      d._at = Date.now();
      S.ess = d;
      store.set('ess', d);
      if (S.tab === 'map') renderView();
    } catch { /* optional */ }
    return S.ess;
  }

  const walkMinsFrom = (from, to) => (from && to ? Math.max(1, Math.round((PPMap.metres(from, to) * 1.35) / WALK_M_PER_MIN)) : null);

  /** Walk to the nearest essential of a type (baby-changing toilets when asked for 'baby'). */
  async function goNearest(type) {
    startGeo();
    if (!S.geo) { toast('Waiting for your location…'); return; }
    const ess = await loadEssentials();
    // In step-free mode prefer wheelchair-accessible toilets when any are tagged.
    let list = (ess?.items || []).filter((e) => (type === 'baby' ? e.baby : e.type === type));
    if (S.navNoSteps && type === 'toilets' && list.some((e) => e.wheelchair)) list = list.filter((e) => e.wheelchair);
    if (!list.length) { toast(`No ${ESS[type]?.label.toLowerCase() || type} found nearby`); return; }
    const best = list.map((e) => ({ e, d: PPMap.metres(S.geo, e) })).sort((a, b) => a.d - b.d)[0].e;
    if (S.tab !== 'map') switchTab('map');
    S.mapKinds = { ...S.mapKinds, [ESS[best.type]?.cat || 'ess']: true };
    store.set('mapKinds', S.mapKinds);
    closeSheet();
    renderView();
    requestAnimationFrame(() => {
      selectPlace(best.id, true);
      startNav({ id: best.id, name: essLabel(best), lat: best.lat, lng: best.lng });
    });
  }

  // ------------------------------------------------------------- leave alerts

  const BIG_SHOW = /parade|tales of magic|cascade|illuminat|dream|firework|night|celebration|lights/i;

  function leaveButton(show, nextIso) {
    const key = `${show.id}|${nextIso}`;
    const on = !!S.leave[key];
    return h('button', {
      type: 'button', class: 'btn small' + (on ? ' primary' : ''),
      onclick: () => {
        if (on) { delete S.leave[key]; toast('Leave alert removed'); }
        else {
          const early = BIG_SHOW.test(show.name) ? 25 : 10;
          S.leave[key] = { id: show.id, name: show.name, start: Date.parse(nextIso), lat: show.location.lat, lng: show.location.lng, early };
          startGeo();
          if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
          toast(`I’ll tell you when to leave — aiming to arrive ${early} min early`);
        }
        store.set('leave', S.leave);
        renderView();
      },
    }, on ? '🚶 Leave alert on' : '🚶 Leave alert');
  }

  function checkLeaveAlerts() {
    const now = Date.now();
    let changed = false;
    for (const [k, a] of Object.entries(S.leave)) {
      if (a.start < now - 10 * 60000) { delete S.leave[k]; changed = true; continue; }
      if (a.done) continue;
      const walk = walkMinsFrom(S.geo && atResort() ? S.geo : null, a) ?? 10;
      const leaveAt = a.start - (a.early + walk) * 60000;
      if (now >= leaveAt) {
        a.done = true;
        changed = true;
        notify(`Leave now for ${a.name}`, `~${walk} min walk · starts ${hhmm(a.start)} · aiming to arrive ${a.early} min early`, 'leave-' + a.id);
      }
    }
    if (changed) store.set('leave', S.leave);
  }
  const leavePending = () => Object.values(S.leave).some((a) => !a.done && a.start > Date.now());

  // --------------------------------------------------- last chance (in-app)

  function checkLastChance() {
    if (S.push || !onTrip()) return; // the server sends it as a push notification instead
    const favs = new Set((S.me?.favourites || []).map((f) => f.id));
    if (!favs.size) return;
    const done = new Set((S.me?.log || []).filter((l) => l.day === today() && (!S.boot.user || l.mine)).map((l) => l.entityId));
    const shown = store.get('lastChanceShown', {});
    for (const [park, d] of Object.entries(S.live)) {
      const close = Date.parse(d?.hours?.find((x) => x.type === 'OPERATING')?.close || '');
      if (!close) continue;
      const mins = (close - Date.now()) / 60000;
      const key = `${today()}:${park}`;
      if (mins < 35 || mins > 55 || shown[key]) continue;
      const left = (d.items || []).filter((it) => it.type === 'ATTRACTION' && favs.has(it.id) && it.status === 'OPERATING' && !done.has(it.id))
        .sort((a, b) => (a.wait ?? 99) - (b.wait ?? 99));
      if (!left.length) continue;
      shown[key] = true;
      store.set('lastChanceShown', shown);
      notify(`Last chance at ${parkShort(park)} — closes ${hhmm(close)}`, 'Not ridden yet: ' + left.slice(0, 4).map((it) => `${it.name}${it.wait != null ? ` (${it.wait} min)` : ''}`).join(', '), 'lastchance-' + park);
    }
  }

  // ------------------------------------------------------------- what now?

  function currentPark() {
    if (S.geo && atResort()) {
      let best = null;
      for (const [park, d] of Object.entries(S.live)) {
        for (const it of d?.items || []) {
          if (!it.location) continue;
          const dd = PPMap.metres(S.geo, it.location);
          if (!best || dd < best.d) best = { park, d: dd };
        }
      }
      if (best && best.d < 400) return best.park;
    }
    return S.park;
  }

  /** Top suggestions right now: rides, shows to leave for, bookings, last chances. */
  function whatNow() {
    const here = S.geo && atResort() ? S.geo : null;
    const park = currentPark();
    const d = S.live[park];
    const now = Date.now();
    const out = [];
    if (!d) return { park, list: out, here };
    const doneToday = new Set((S.me?.log || []).filter((l) => l.day === today()).map((l) => l.entityId));
    const close = Date.parse(d.hours?.find((x) => x.type === 'OPERATING')?.close || '') || now + 8 * 3600000;
    const closingSoon = close - now < 60 * 60000;
    const kh = Number(S.kidHeight) || 0;

    for (const it of d.items) {
      if (it.type !== 'ATTRACTION' || it.status !== 'OPERATING' || it.wait == null || !it.location || hasShowtimesToday(it)) continue;
      if (kh && it.info?.height && it.info.height > kh) continue;
      const walk = walkMinsFrom(here, it.location);
      let later = Infinity;
      const base = new Date(); base.setMinutes(0, 0, 0);
      for (let i = 1; i <= 3; i++) { const ms = base.getTime() + i * 3600000; if (ms < close) later = Math.min(later, predictWait(it, ms, true)); }
      const quietVsUsual = it.usually != null && it.wait <= it.usually - 10;
      const quietVsLater = Number.isFinite(later) && it.wait <= later - 10;
      const lastChance = closingSoon && it.fav && !doneToday.has(it.id);
      let score = it.wait + (walk ?? 0) + (it.fav ? -12 : 0) + (doneToday.has(it.id) ? 20 : 0) - (quietVsUsual || quietVsLater ? 8 : 0) - (lastChance ? 15 : 0);
      const why = [`${it.wait} min wait`];
      if (walk != null) why.push(`${walk} min walk`);
      if (quietVsUsual) why.push(`usually ~${it.usually} — unusually quiet`);
      else if (quietVsLater) why.push(`likely ~${later} later`);
      if (it.singleRider != null && it.wait - it.singleRider >= 15) { why.push(`single rider ${it.singleRider}`); score -= 4; }
      if (lastChance) why.push('last chance before close');
      if (it.fav) why.push('★ must-do');
      if (doneToday.has(it.id)) why.push('ridden today');
      out.push({ kind: 'ride', id: it.id, name: it.name, score, why, loc: it.location, item: it });
    }

    for (const it of d.items) {
      if (!(it.type === 'SHOW' || hasShowtimesToday(it)) || it.reserved || !it.location) continue;
      const next = (it.showtimes || []).map((x) => Date.parse(x.start)).filter((t) => t > now && t < now + 90 * 60000).sort((a, b) => a - b)[0];
      if (!next) continue;
      const walk = walkMinsFrom(here, it.location) ?? 0;
      const early = BIG_SHOW.test(it.name) ? 25 : 10;
      const leaveIn = Math.round((next - now) / 60000) - walk - early;
      if (leaveIn < -5) continue;
      const big = BIG_SHOW.test(it.name);
      if (!big && !it.fav && leaveIn > 20) continue;
      const score = leaveIn <= 10 ? (it.fav || big ? -6 : 10) : 30 + leaveIn;
      out.push({
        kind: 'show', id: it.id, name: it.name, score, loc: it.location, item: it, start: next,
        why: [`starts ${hhmm(next)}`, leaveIn <= 0 ? 'leave now' : `leave in ${leaveIn} min`, walk ? `${walk} min walk` : null, big ? `arrive ${early} min early for a spot` : null, it.fav ? '★' : null].filter(Boolean),
      });
    }

    for (const b of S.bookings || []) {
      const at = b.at * 1000;
      if (at < now || at > now + 90 * 60000) continue;
      const loc = b.entityId ? locOf(b.entityId) : null;
      const walk = walkMinsFrom(here, loc) ?? 10;
      const leaveIn = Math.round((at - now) / 60000) - walk - 5;
      out.push({ kind: 'booking', id: 'b' + b.id, name: b.name, score: leaveIn <= 15 ? -20 : 50, loc, why: [`booked for ${timeTs(b.at)}`, leaveIn <= 0 ? 'leave now' : `leave in ${leaveIn} min`] });
    }

    out.sort((a, b) => a.score - b.score);
    return { park, list: out.slice(0, 3), here };
  }

  async function openWhatNow() {
    startGeo();
    const park = currentPark();
    if (!S.live[park] || Date.now() / 1000 - S.live[park].meta.fetchedAt > 90) await loadLive(park, { quiet: true });
    const { list, here } = whatNow();
    const dlg = $('#sheet');
    const icon = { ride: '🎢', show: '✨', booking: '📅' };
    dlg.replaceChildren(h('form', { method: 'dialog', onsubmit: (e) => { e.preventDefault(); closeSheet(); } },
      h('h2', null, `🎯 What now? · ${parkShort(park)}`),
      here ? null : h('p', { class: 'spark-lbl' }, S.geo ? 'You’re not at the resort, so walking times are left out.' : 'Turn on location for walking times (finding you…).'),
      list.length ? h('ol', { class: 'whatnow' }, list.map((x) => h('li', { class: 'card' },
        h('b', null, `${icon[x.kind]} ${x.name}`),
        h('small', null, x.why.join(' · ')),
        h('div', { class: 'actions' },
          x.loc ? h('button', {
            type: 'button', class: 'btn small primary',
            onclick: () => { closeSheet(); switchTab('map'); requestAnimationFrame(() => { selectPlace(x.id, true); startNav({ id: x.id, name: x.name, lat: x.loc.lat, lng: x.loc.lng }); }); },
          }, '🧭 Go') : null,
          x.kind === 'show' && x.item?.location ? leaveButton(x.item, new Date(x.start).toISOString()) : null,
          x.kind === 'ride' ? h('button', { type: 'button', class: 'btn small', onclick: () => { closeSheet(); openFav({ id: x.id, park }); } }, 'Details') : null)))) : h('p', { class: 'empty' }, 'Nothing open right now — check the Trip tab for hours.'),
      h('div', { class: 'group-h' }, 'Nearest'),
      h('div', { class: 'qtypes' },
        chip('🚻 Toilet', false, () => goNearest('toilets')),
        chip('👶 Baby change', false, () => goNearest('baby')),
        chip('🚰 Water', false, () => goNearest('water')),
        chip('⛑ First aid', false, () => goNearest('firstaid')),
        chip('🏧 Cash', false, () => goNearest('cash')),
        chip('☂️ Shelter', false, () => goNearest('shelter')),
        chip('🪑 Seat', false, () => goNearest('seat')),
        chip('🚬 Smoking', false, () => goNearest('smoking'))),
      h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'btn' }, 'Close'))));
    if (typeof dlg.showModal === 'function' && !dlg.open) dlg.showModal(); else dlg.setAttribute('open', '');
  }

  // ================================================================
  //  Trip pack: download everything for no-signal use
  // ================================================================

  S.pack = store.get('pack', null); // { at, ok, total, failed: [], bytes, persisted }
  let packRunning = false;

  function packSteps() {
    const parks = S.boot.parks.map((p) => p.key);
    const stamp = (d) => { d._at = Date.now(); return d; };
    return [
      ['Live waits, shows & restaurants', async () => {
        for (const p of parks) S.live[p] = await api('live/' + p);
        store.set('live', S.live);
      }],
      ['Trip days: hours & show times', async () => { S.trip = await api('trip'); store.set('trip', S.trip); }],
      ['Restaurant hours (Disney schedules)', async () => {
        for (const p of parks) S.foodSched[p] = stamp(await api('food-schedule/' + p));
        store.set('foodSched', S.foodSched);
      }],
      ['Disney Village & hotels', async () => { S.village = await api('village'); store.set('village', S.village); }],
      ['Shops', async () => { S.shops = await api('shops'); store.set('shops', S.shops); }],
      ['Menus', async () => { S.menus = stamp(await api('menus')); store.set('menus', S.menus); }],
      ['Toilets, water & first aid', async () => { S.ess = stamp(await api('essentials')); store.set('ess', S.ess); }],
      ['Walking paths (navigation)', async () => { walkGraph = null; await loadWalkGraph(); }],
      ['Guide & docs', async () => {
        S.guide = stamp(await api('guide')); store.set('guide', S.guide);
        S.docs = await api('docs'); store.set('docs', S.docs);
        S.features = await api('features'); store.set('features', S.features);
      }],
      ['Crowd calendar & touring plans', async () => {
        S.crowd = stamp(await api('crowd-calendar')); store.set('crowd', S.crowd);
        S.tp = stamp(await api('touring-plans')); store.set('tp', S.tp);
      }],
      ['Best times from your history', async () => { S.best = stamp(await api('best-times')); store.set('best', S.best); }],
      ['Weather forecast', async () => { S.weather = await api('weather'); store.set('weather', S.weather); }],
      S.boot.transit ? ['Trains (RER A)', async () => { S.transit = await api('transit'); store.set('transit', S.transit); }] : null,
      ['Your bookings, must-dos & ratings', async () => {
        S.bookings = (await api('bookings')).bookings; store.set('bookings', S.bookings);
        S.me = await api('me'); store.set('me', S.me);
        S.ratings = (await api('ratings?device=' + deviceId())).ratings || {}; store.set('ratings', S.ratings);
      }],
      ['App files', async () => {
        // Re-fetch the exact versioned CSS/JS + shell so the offline copy matches this version.
        const urls = ['./', 'manifest.webmanifest', 'assets/icon.svg',
          ...[...document.querySelectorAll('link[rel="stylesheet"], script[src]')].map((e) => e.href || e.src)];
        for (const u of urls) { const r = await fetch(u, { cache: 'reload' }); if (!r.ok) throw new Error(`${u}: ${r.status}`); }
      }],
    ].filter(Boolean);
  }

  async function downloadPack({ quiet = false } = {}) {
    if (packRunning) return;
    if (!navigator.onLine) { if (!quiet) toast('You’re offline — connect to Wi-Fi or data first'); return; }
    packRunning = true;
    const steps = packSteps();
    const state = steps.map(([label]) => ({ label, st: 'wait', err: null }));
    const dlg = $('#sheet');
    const draw = (done) => {
      if (quiet) return;
      dlg.replaceChildren(h('form', { method: 'dialog', onsubmit: (e) => { e.preventDefault(); closeSheet(); } },
        h('h2', null, '📦 Trip pack'),
        h('ul', { class: 'check-list' }, state.map((s) => h('li', { class: s.st === 'ok' ? 'ok' : s.st === 'fail' ? 'bad' : 'warn' },
          h('b', null, `${s.st === 'ok' ? '✅' : s.st === 'fail' ? '❌' : s.st === 'run' ? '⏳' : '·'} ${s.label}`),
          s.err ? h('small', null, s.err) : null))),
        done ? packSummary() : h('p', { class: 'spark-lbl' }, 'Downloading… keep the app open.'),
        h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'btn primary' }, done ? 'Done' : 'Hide'))));
      if (!dlg.open) { if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', ''); }
    };
    draw(false);
    for (let i = 0; i < steps.length; i++) {
      state[i].st = 'run';
      draw(false);
      try {
        await steps[i][1]();
        state[i].st = 'ok';
      } catch (e) {
        state[i].st = 'fail';
        state[i].err = e.message;
      }
    }
    let persisted = false;
    let bytes = null;
    try { persisted = await navigator.storage?.persist?.() || await navigator.storage?.persisted?.() || false; } catch { /* unsupported */ }
    try { bytes = (await navigator.storage?.estimate?.())?.usage ?? null; } catch { /* unsupported */ }
    S.pack = {
      at: Date.now(), ok: state.filter((s) => s.st === 'ok').length, total: state.length,
      failed: state.filter((s) => s.st === 'fail').map((s) => s.label), bytes, persisted,
    };
    store.set('pack', S.pack);
    packRunning = false;
    draw(true);
    if (quiet) { if (S.tab === 'trip') renderView(); return; }
    toast(S.pack.failed.length ? `Trip pack saved with ${S.pack.failed.length} gap(s)` : 'Trip pack saved — Park Pulse works offline now');
    renderView();
  }

  function packSummary() {
    const p = S.pack;
    if (!p) return h('p', { class: 'spark-lbl' }, 'Not downloaded yet.');
    const mb = p.bytes != null ? `${(p.bytes / 1048576).toFixed(1)} MB stored` : null;
    return h('div', { class: 'spark-lbl' },
      h('div', null, [`Saved ${dayLabel(parkDate(new Date(p.at)))} ${hhmm(p.at)}`, `${p.ok}/${p.total} parts`, mb].filter(Boolean).join(' · ')),
      p.failed.length ? h('div', { class: 'up' }, `Missing: ${p.failed.join(', ')} — try again with better signal.`) : null,
      h('div', null, p.persisted ? '🔒 Storage kept permanently by the browser.' : 'ℹ️ The browser may clear storage if the app isn’t used for a while — on iPhone, using it from the Home Screen helps.'));
  }

  function tripPackCard() {
    const p = S.pack;
    const age = p ? (Date.now() - p.at) / 3600000 : null;
    return h('section', { class: 'card day pack' },
      h('h2', null, '📦 Trip pack', p ? h('span', { class: 'badge ' + (age < 24 && !p.failed.length ? 'open' : 'closed') }, age < 24 ? 'READY' : 'OLD') : null),
      h('p', { class: 'spark-lbl' }, 'Saves everything — waits, shows, hours, menus, shops, toilets & first aid, walking paths, guide and your plans — so Park Pulse keeps working in queues with no signal. It refreshes itself when you have signal.'),
      packSummary(),
      h('p', { class: 'spark-lbl' }, '🗺 Map tiles: open the Map on Wi-Fi and zoom around both parks and the Village once — viewed tiles are kept (OpenStreetMap doesn’t allow bulk downloads).'),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn primary', disabled: packRunning || null, onclick: () => downloadPack() }, p ? 'Update trip pack' : 'Download for the trip')));
  }

  // ================================================================
  //  About + Features (renders FEATURES.md)
  // ================================================================

  S.features = store.get('features', null);
  S.prevTab = 'now';

  async function loadFeatures() {
    try {
      const d = await api('features');
      S.features = d;
      store.set('features', d);
      if (S.tab === 'features') renderView();
    } catch { /* keep cached */ }
  }

  S.docs = store.get('docs', null);
  async function loadDocs() {
    try {
      const d = await api('docs');
      S.docs = d;
      store.set('docs', d);
      if (S.tab === 'docs') renderView();
    } catch { /* keep cached */ }
  }

  function openPage(tab) {
    if (!['about', 'features', 'docs'].includes(S.tab)) S.prevTab = S.tab;
    switchTab(tab);
    if (tab === 'features') loadFeatures();
    if (tab === 'docs') loadDocs();
  }

  function viewDocs() {
    const frag = document.createDocumentFragment();
    add(frag, h('div', { class: 'actions' }, backButton()));
    if (!S.docs) {
      add(frag, h('p', { class: 'empty' }, 'Loading documentation…'));
      return frag;
    }
    const body = mdRender(S.docs.markdown);
    // Contents: every section heading, tap to jump.
    const heads = [...body.querySelectorAll('h3')];
    add(frag, h('section', { class: 'card day' },
      h('h2', null, '📚 Contents'),
      h('div', { class: 'qtypes docs-toc' }, heads.map((hd) => chip(hd.textContent, false, () => {
        document.getElementById(hd.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      })))));
    add(frag, h('section', { class: 'card day md-card' }, body));
    if (S.docs.updated) add(frag, h('p', { class: 'foot' }, `Updated ${dayLabel(parkDate(new Date(S.docs.updated * 1000)))}`));
    return frag;
  }

  /** Inline markdown: **bold**, `code`, [text](https://…) → DOM nodes (no innerHTML). */
  function mdInline(text) {
    const out = [];
    // **bold** | `code` | [text](url)   (built from a string; \u0060 is a backtick)
    const re = new RegExp('\\*\\*([^*]+)\\*\\*|\u0060([^\u0060]+)\u0060|\\[([^\\]]+)\\]\\(([^)\\s]+)\\)', 'g');
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(text.slice(last, m.index));
      if (m[1] != null) out.push(h('b', null, m[1]));
      else if (m[2] != null) out.push(h('code', null, m[2]));
      else {
        const href = m[4];
        const safe = href.startsWith('https:' + '/' + '/') || href.startsWith('http:' + '/' + '/'); // only real web links
        out.push(safe ? h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, m[3]) : m[3]);
      }
      last = re.lastIndex;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }

  /** Small markdown renderer for FEATURES.md: headings, nested bullets, tables, paragraphs. */
  const mdSlug = (t) => 'doc-' + normName(t.replace(/[^\p{L}\p{N}\s-]/gu, '')).replace(/\s+/g, '-');

  // ![caption](assets/docs/file.png) on its own line; images only from assets/docs/.
  const MD_IMG = new RegExp('^\\s*!\\[([^\\]]*)\\]\\(([^)\\s]+)\\)\\s*$');
  const MD_IMG_SRC = new RegExp('^assets/docs/[\\w.-]+\\.(png|jpe?g|webp)$', 'i');

  function mdRender(md) {
    const root = h('div', { class: 'md' });
    const lines = md.replace(/\r/g, '').split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      if (/^\s*~~~|^\s*\u0060\u0060\u0060/.test(line)) { // fenced code block
        const code = [];
        i++;
        while (i < lines.length && !/^\s*~~~|^\s*\u0060\u0060\u0060/.test(lines[i])) { code.push(lines[i]); i++; }
        i++;
        add(root, h('pre', { class: 'md-pre' }, h('code', null, code.join('\n'))));
        continue;
      }
      const im = MD_IMG.exec(line);
      if (im) { // screenshot: only files from assets/docs/, hidden until it exists
        i++;
        if (MD_IMG_SRC.test(im[2])) {
          const fig = h('figure', { class: 'md-shot' },
            h('img', { src: im[2], alt: im[1], loading: 'lazy', decoding: 'async', onerror: () => fig.remove() }),
            im[1] ? h('figcaption', null, im[1]) : null);
          add(root, fig);
        }
        continue;
      }
      const hm = /^(#{1,4})\s+(.*)$/.exec(line);
      if (hm) { add(root, h('h' + Math.min(4, hm[1].length + 1), { id: mdSlug(hm[2]) }, mdInline(hm[2]))); i++; continue; }
      if (/^\s*\d+[.\u0029]\s+/.test(line)) { // numbered list
        const ol = h('ol');
        while (i < lines.length && /^\s*\d+[.\u0029]\s+/.test(lines[i])) { add(ol, h('li', null, mdInline(lines[i].replace(/^\s*\d+[.\u0029]\s+/, '')))); i++; }
        add(root, ol);
        continue;
      }
      if (/^\s*\|/.test(line)) {
        const rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i]); i++; }
        const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        const body = rows.filter((r) => !/^\s*\|[\s:|-]+\|\s*$/.test(r));
        const [head, ...rest] = body;
        add(root, h('div', { class: 'md-table' }, h('table', null,
          h('thead', null, h('tr', null, cells(head).map((c) => h('th', null, mdInline(c))))),
          h('tbody', null, rest.map((r) => h('tr', null, cells(r).map((c) => h('td', null, mdInline(c)))))))));
        continue;
      }
      if (/^\s*[-*]\s+/.test(line)) {
        // Nested list by indentation (2 spaces per level).
        const top = h('ul');
        const stack = [{ indent: -1, ul: top }];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          const indent = /^(\s*)/.exec(lines[i])[1].length;
          const text = lines[i].replace(/^\s*[-*]\s+/, '');
          while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
          let parent = stack[stack.length - 1];
          if (indent > parent.indent + 1 && parent.lastLi) {
            const ul = h('ul');
            parent.lastLi.append(ul);
            parent = { indent, ul };
            stack.push(parent);
          }
          const li = h('li', null, mdInline(text));
          add(parent.ul, li);
          parent.lastLi = li;
          i++;
        }
        add(root, top);
        continue;
      }
      const para = [];
      while (i < lines.length && lines[i].trim() && !/^(#|\s*[-*]\s|\s*\||\s*\d+[.\u0029]\s|\s*~~~|\s*\u0060\u0060\u0060)/.test(lines[i]) && !MD_IMG.test(lines[i])) { para.push(lines[i].trim()); i++; }
      add(root, h('p', null, mdInline(para.join(' '))));
    }
    return root;
  }

  function backButton() {
    return h('button', { type: 'button', class: 'btn small', onclick: () => switchTab(S.prevTab || 'now') }, '← Back');
  }

  // ------------------------------------------------------- install as an app

  let installPrompt = null; // Android/desktop Chrome's deferred install prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    if (S.tab === 'about') renderView();
  });
  window.addEventListener('appinstalled', () => { installPrompt = null; toast('Park Pulse installed 🎉'); if (S.tab === 'about') renderView(); });

  const isAndroid = () => /Android/i.test(navigator.userAgent);

  function installSection() {
    const installed = isStandalone();
    return sec('📲 Install as an app',
      installed ? h('p', null, '✅ You’re using the installed app.') : null,
      !installed && installPrompt ? h('div', { class: 'actions' }, h('button', {
        type: 'button', class: 'btn primary',
        onclick: async () => {
          const p = installPrompt;
          installPrompt = null;
          try { await p.prompt(); await p.userChoice; } catch { /* dismissed */ }
          renderView();
        },
      }, '📲 Install Park Pulse')) : null,
      h('h3', { class: 'inst-h' }, `🤖 Android${isAndroid() && !installed ? ' (this phone)' : ''}`),
      h('ol', { class: 'inst' },
        h('li', null, 'Open Park Pulse in ', h('b', null, 'Chrome'), '.'),
        h('li', null, 'Tap the ', h('b', null, '⋮'), ' menu (top right) → ', h('b', null, 'Install app'), ' (older versions: ', h('b', null, 'Add to Home screen'), ') → ', h('b', null, 'Install'), '.'),
        h('li', null, 'Open it from the new icon on your home screen or app drawer.'),
        h('li', null, 'Samsung Internet: menu ', h('b', null, '≡'), ' → ', h('b', null, 'Add page to'), ' → ', h('b', null, 'Home screen'), '. Firefox: ', h('b', null, '⋮'), ' → ', h('b', null, 'Install'), '.')),
      h('p', { class: 'spark-lbl' }, 'On Android, notifications work in the browser too — installing just gives a full-screen app with its own icon.'),
      h('h3', { class: 'inst-h' }, `🍎 iPhone / iPad${isIOS() && !installed ? ' (this phone)' : ''}`),
      h('ol', { class: 'inst' },
        h('li', null, 'Open Park Pulse in ', h('b', null, 'Safari'), '.'),
        h('li', null, 'Tap ', h('b', null, 'Share'), ' (the square with an arrow) → ', h('b', null, 'Add to Home Screen'), ' → ', h('b', null, 'Add'), '.'),
        h('li', null, 'Open it from the new icon — notifications only work there (iOS 16.4 or later).')),
      h('p', { class: 'spark-lbl' }, 'After installing: sign in again if asked, turn on notifications (Mine → Notifications) and tap 📦 Download for the trip.'));
  }

  function viewAbout() {
    const frag = document.createDocumentFragment();
    const name = S.boot?.appName || 'Park Pulse';
    add(frag, 
      h('div', { class: 'actions' }, backButton()),
      sec(`ℹ️ About ${name}${S.boot?.version ? ' · v' + S.boot.version : ''}`,
        h('p', null, `${name} is our private trip companion for Disneyland Paris — Disneyland Park and Disney Adventure World — for ${dayLabel(S.boot.trip.start)} to ${dayLabel(S.boot.trip.end)}. Live waits, shows, food, maps & navigation, planning, notifications and a full guide, in one app that keeps working with no signal.`),
        h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn primary', onclick: () => openPage('docs') }, '📚 Documentation'),
          h('button', { type: 'button', class: 'btn', onclick: () => openPage('features') }, '📋 Features'))),
      installSection(),
      sec('📡 Where the data comes from', bullets([
        'Live waits, shows, restaurant status and park hours: ThemeParks.wiki (Disney’s own data).',
        'Wait-time backup and land names: Queue-Times.com.',
        'Shops, Disney Village venues, opening hours, toilets & essentials, diet tags and walking paths: © OpenStreetMap contributors.',
        'Menus: Disney’s official PDFs (media.disneylandparis.com).',
        'Weather: Open-Meteo. Trains: Île-de-France Mobilités (PRIM), when enabled.',
        'Guide, hours research, ride facts, crowd calendar and touring plans: researched from public sources, listed with each section.',
      ])),
      sec('🔒 Privacy', bullets([
        'Everything lives on our own server — no ads, no trackers, no third-party scripts.',
        'Shared with the party: must-dos, ride log, bookings, ratings, and (only if you turn it on) your live location.',
        'On this phone only: settings, alerts, leave alerts, the trip pack and offline map tiles.',
        'Location is used on the phone for the map, navigation and “What now?”; it is only sent to the server when you share it with the party.',
      ])),
      sec('🩺 Status',
        h('p', null, cronFooter()),
        h('div', { class: 'actions' },
          h('a', { class: 'btn small', href: 'api/health', target: '_blank', rel: 'noopener' }, 'Health check'),
          S.pack ? null : h('button', { type: 'button', class: 'btn small', onclick: () => downloadPack() }, '📦 Download trip pack'))),
    );
    return frag;
  }

  function viewFeatures() {
    const frag = document.createDocumentFragment();
    add(frag, h('div', { class: 'actions' }, backButton()));
    if (!S.features) {
      add(frag, h('p', { class: 'empty' }, 'Loading features…'));
      return frag;
    }
    add(frag, h('section', { class: 'card day md-card' }, mdRender(S.features.markdown)));
    if (S.features.updated) add(frag, h('p', { class: 'foot' }, `Updated ${dayLabel(parkDate(new Date(S.features.updated * 1000)))}`));
    return frag;
  }

  // ================================================================
  //  PIN-mode profiles: choose / create / switch
  // ================================================================

  const PROFILE_EMOJI = ['🐭', '🦆', '🐶', '🧸', '🦁', '🐸', '🦄', '🐼', '🐯', '🐙', '🦊', '🐻', '⭐', '🎈', '🏰', '🚀'];

  /** Full-screen "Who's using Park Pulse?" picker (after the PIN, or when switching). */
  async function showProfilePicker({ switching = false } = {}) {
    closeSheet();
    $('.dock').hidden = true;
    $('#parkSeg').hidden = true;
    $('#hours').replaceChildren();
    let list = [];
    let current = null;
    try { ({ profiles: list, current } = await api('profiles')); } catch (e) { toast(e.message); }

    let emoji = PROFILE_EMOJI[Math.floor(Math.random() * PROFILE_EMOJI.length)];
    const name = h('input', { type: 'text', maxlength: '30', placeholder: 'Your name', autocomplete: 'nickname', 'aria-label': 'Name' });
    const picks = h('div', { class: 'emoji-pick' });
    const drawPicks = () => fill(picks, PROFILE_EMOJI.map((e) => h('button', {
      type: 'button', class: e === emoji ? 'on' : '', 'aria-label': `Avatar ${e}`, 'aria-pressed': String(e === emoji),
      onclick: () => { emoji = e; drawPicks(); },
    }, e)));
    drawPicks();
    const msg = h('p', { class: 'spark-lbl' });

    const choose = async (id) => {
      try {
        await api('profiles/select', { method: 'POST', body: { id } });
        await afterProfileChange();
      } catch (e) { toast(e.message); }
    };
    const form = h('form', {
      class: 'profile-new',
      onsubmit: async (e) => {
        e.preventDefault();
        if (!name.value.trim()) { msg.textContent = 'Enter a name'; name.focus(); return; }
        try {
          await api('profiles', { method: 'POST', body: { name: name.value.trim(), emoji } });
          await afterProfileChange();
        } catch (err) { msg.textContent = err.message; }
      },
    }, h('h3', null, list.length ? '…or add a new profile' : 'Create your profile'), name, picks, msg,
    h('button', { type: 'submit', class: 'btn primary' }, 'Create & continue'));

    fill($('#view'), h('div', { class: 'card pin profile-card' },
      h('h2', null, switching ? 'Switch profile' : 'Who’s using Park Pulse?'),
      h('p', { class: 'spark-lbl' }, 'Your profile keeps your rides, alerts and notifications separate from the rest of the party.'),
      list.length ? h('div', { class: 'profile-list' }, list.map((p) => h('button', {
        type: 'button', class: 'profile-btn' + (p.id === current ? ' on' : ''),
        onclick: () => choose(p.id),
      }, p.avatar ? h('img', { class: 'pf-av', src: p.avatar, alt: '' }) : h('span', { class: 'pf-emoji', 'aria-hidden': 'true' }, p.emoji), h('span', null, p.name), p.id === current ? h('small', null, 'current') : null))) : null,
      form,
      switching ? h('button', { type: 'button', class: 'btn', onclick: () => { $('.dock').hidden = false; render(); } }, 'Cancel') : null));
    if (!list.length) name.focus();
  }

  // ------------------------------------------------------------ profile picture / emoji

  const AVATAR_EMOJI = [...PROFILE_EMOJI, '🐰', '🐨', '🐷', '🐵', '🦖', '🐳', '🦋', '🌈', '🍦', '🎢', '🎠', '👑', '🧚', '🦸', '🏴‍☠️', '👻'];
  const initialsOf = (name) => (name ? name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() : '🔒');

  /** A person's picture, else their emoji, else their initials. */
  function avatarEl(u, cls) {
    if (u?.avatar) return h('img', { class: cls + ' av-img', src: u.avatar, alt: '' });
    return h('span', { class: cls, 'aria-hidden': 'true' }, u?.emoji || initialsOf(u?.name));
  }

  /** Square-crop the middle of a photo and shrink it to 160×160 JPEG (≈10 KB). */
  async function avatarFromFile(file) {
    const bmp = await createImageBitmap(file);
    const side = Math.min(bmp.width, bmp.height);
    const c = document.createElement('canvas');
    c.width = 160; c.height = 160;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 160, 160);
    ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 160, 160);
    return c.toDataURL('image/jpeg', 0.85);
  }

  function applyUser(user) {
    if (!user) return;
    if (S.boot) S.boot.user = { ...(S.boot.user || {}), ...user };
    if (S.me) { S.me.user = { ...(S.me.user || {}), ...user }; store.set('me', S.me); }
    renderUser();
    renderView();
  }

  function openAvatarSheet() {
    const u = S.me?.user || S.boot?.user;
    if (!u) return;
    const pin = S.boot.auth === 'pin';
    let emoji = u.emoji || '';
    let image = u.avatar || null;
    const dlg = $('#sheet');
    const preview = h('div', { class: 'av-preview' });
    const picks = h('div', { class: 'emoji-pick' });
    const file = h('input', {
      type: 'file', accept: 'image/*', hidden: true,
      onchange: async (e) => {
        const f = e.target.files[0];
        e.target.value = '';
        if (!f) return;
        try { image = await avatarFromFile(f); draw(); } catch { toast('Couldn’t use that picture — try another.'); }
      },
    });
    const removeBtn = h('button', { type: 'button', class: 'btn small', onclick: () => { image = null; draw(); } }, '✕ Remove photo');
    const pick = (label, value, aria) => h('button', {
      type: 'button', class: value === emoji ? 'on' : '', 'aria-pressed': String(value === emoji), 'aria-label': aria,
      onclick: () => { emoji = value; draw(); },
    }, label);
    const draw = () => {
      fill(preview, avatarEl({ ...u, emoji, avatar: image }, 'up-i huge'));
      removeBtn.hidden = !image;
      fill(picks, pin ? null : pick(initialsOf(u.name), '', 'Use my initials'), AVATAR_EMOJI.map((e) => pick(e, e, `Emoji ${e}`)));
    };
    draw();
    fill(dlg, h('form', { method: 'dialog', onsubmit: async (e) => {
      e.preventDefault();
      try {
        const r = await api('avatar', { method: 'POST', body: { emoji, image } });
        closeSheet();
        applyUser(r.user);
        toast('Picture updated');
      } catch (err) { toast(err.message || 'Couldn’t save your picture'); }
    } },
      h('h2', null, '🎨 Your picture'),
      h('div', { class: 'av-row' }, preview,
        h('div', { class: 'av-actions' },
          h('button', { type: 'button', class: 'btn small', onclick: () => file.click() }, '📷 Upload photo'),
          removeBtn, file)),
      h('p', { class: 'spark-lbl' }, pin
        ? 'Pick an emoji, or upload a photo (it’s shown instead of the emoji). Your party sees it.'
        : 'Pick an emoji (or your initials), or upload a photo (it’s shown instead). Your party sees it.'),
      picks,
      h('div', { class: 'actions' },
        h('button', { type: 'submit', class: 'btn primary' }, 'Save'),
        h('button', { type: 'button', class: 'btn', onclick: closeSheet }, 'Cancel'))));
    if (typeof dlg.showModal === 'function' && !dlg.open) dlg.showModal(); else dlg.setAttribute('open', '');
  }

  /** After choosing/creating a profile: reload as that person and re-link this phone's push. */
  async function afterProfileChange() {
    S.me = null;
    store.set('me', null);
    S.justMe = false;
    $('.dock').hidden = false;
    await start();
    try {
      if (S.push && 'serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await api('push/subscribe', { method: 'POST', body: { subscription: sub.toJSON(), device: deviceId(), prefs: S.push.status?.prefs || {}, alerts: alertsPayload() } });
        }
      }
    } catch { /* push relink is best-effort */ }
    const u = S.boot?.user;
    if (u) toast(`Hi ${u.emoji || ''} ${u.name}!`.replace('  ', ' '));
  }

  // ------------------------------------------------------------- trip tab

  function hoursLine(segs) {
    if (!segs || !segs.length) return h('span', { class: 'hrs' }, 'Hours not published yet');
    const op = segs.find((s) => s.type === 'OPERATING');
    const emh = segs.find((s) => s.type === 'EXTRA_HOURS');
    return h('span', { class: 'hrs' },
      op ? `${time(op.open)}–${time(op.close)}` : segs.map((s) => `${time(s.open)}–${time(s.close)}`).join(', '),
      emh ? h('div', null, h('span', { class: 'badge emh' }, 'EMH'), ` ${time(emh.open)}–${time(emh.close)}`) : null);
  }

  // ------------------------------------------------------------ park tickets (kept on this phone only)
  // Scan the ticket's QR code with the camera (or read it from a photo / screenshot), decode it with our own
  // reader (assets/qr.js, works on iPhone too) and redraw an exact, crisp copy of the code for the gates.
  // Codes that aren't QR (Aztec, PDF417, barcodes) are read by the browser's BarcodeDetector where it exists
  // and kept as a picture.
  const OTHER_FORMATS = ['aztec', 'pdf417', 'data_matrix', 'code_128', 'code_39', 'ean_13', 'itf'];
  const TICKET_FORMAT_LABEL = { qr_code: 'QR code', aztec: 'Aztec code', pdf417: 'PDF417 barcode', data_matrix: 'Data Matrix', code_128: 'barcode', code_39: 'barcode', ean_13: 'barcode', itf: 'barcode' };
  let ticketStream = null;
  let ticketLoop = 0;
  let ticketLock = null;
  let ticketDelete = null;

  const getTickets = () => { const l = store.get('tickets', []); return Array.isArray(l) ? l : []; };
  function saveTickets(list) {
    try { localStorage.setItem('pp:tickets', JSON.stringify(list)); return true; } catch {
      toast('Not enough space on this phone to save that ticket.');
      return false;
    }
  }

  function stopTicketMedia() {
    clearTimeout(ticketLoop);
    if (ticketStream) { ticketStream.getTracks().forEach((t) => t.stop()); ticketStream = null; }
    if (ticketLock) { ticketLock.release().catch(() => {}); ticketLock = null; }
  }

  async function otherDetector() {
    if (!('BarcodeDetector' in window)) return null;
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      const formats = OTHER_FORMATS.filter((f) => supported.includes(f));
      return formats.length ? new window.BarcodeDetector({ formats }) : null;
    } catch { return null; }
  }

  /** Draw an image / video frame onto a canvas no bigger than `max` px and return its pixels. */
  function framePixels(src, w, ht, max) {
    const scale = Math.min(1, max / Math.max(w, ht));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(ht * scale));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0, c.width, c.height);
    return ctx.getImageData(0, 0, c.width, c.height);
  }

  function readQR(src, w, ht) {
    if (!window.PPQR) return null;
    for (const max of [960, 1600, 2400]) {
      try {
        const r = window.PPQR.decode(framePixels(src, w, ht, max));
        if (r) return r;
      } catch { /* try a bigger size */ }
      if (Math.max(w, ht) <= max) break;
    }
    return null;
  }

  /** A crop (with margin) or downscale of a picture, as a data: URL — only used for codes we can't redraw. */
  function ticketPicture(src, w, ht, box) {
    let sx = 0, sy = 0, sw = w, sh = ht;
    if (box) {
      const pad = Math.max(box.width, box.height) * 0.12;
      sx = Math.max(0, box.x - pad); sy = Math.max(0, box.y - pad);
      sw = Math.min(w - sx, box.width + pad * 2); sh = Math.min(ht - sy, box.height + pad * 2);
    }
    const big = Math.max(sw, sh) || 1;
    const scale = Math.min(1200, Math.max(600, big)) / big;
    const c = document.createElement('canvas');
    c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingEnabled = !box;
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.9);
  }

  /** Turn a QR decode into what we store: the exact segments, so the redraw carries identical data. */
  function qrTicketData(r) {
    return { value: r.text, format: 'qr_code', qr: { segments: r.segments, ecl: r.ecl, version: r.version } };
  }

  function ticketQRModel(t) {
    if (!window.PPQR) return null;
    try {
      if (t.qr) return window.PPQR.encodeSegments(t.qr.segments, t.qr.ecl, t.qr.version, false);
      if (t.format === 'qr_code' && t.value) return window.PPQR.encodeText(t.value);
    } catch { /* fall back to the picture */ }
    return null;
  }

  /** The ticket's code: a redrawn QR (SVG, sharp at any size) or the saved picture. */
  function ticketCode(t, cls) {
    const q = ticketQRModel(t);
    if (q) {
      const { d, dim } = window.PPQR.svgPath(q, 4);
      const el = svg('svg', { viewBox: `0 0 ${dim} ${dim}`, class: cls, 'shape-rendering': 'crispEdges', role: 'img', 'aria-label': `QR code for ${t.label || 'ticket'}` });
      el.append(svg('rect', { width: dim, height: dim, fill: '#fff' }), svg('path', { d, fill: '#000' }));
      return el;
    }
    return t.img ? h('img', { class: cls, src: t.img, alt: `Ticket code for ${t.label || 'ticket'}` }) : h('span', { class: cls }, '🎟');
  }

  async function openTicketScanner() {
    const dlg = $('#sheet');
    const detector = await otherDetector();
    const video = h('video', { class: 'scan-video', playsinline: true, muted: true, autoplay: true });
    video.muted = true;
    const status = h('p', { class: 'spark-lbl' }, 'Starting the camera…');
    const keepPicture = () => {
      if (!video.videoWidth) return;
      const vw = video.videoWidth, vh = video.videoHeight, side = Math.min(vw, vh) * 0.85;
      const img = ticketPicture(video, vw, vh, { x: (vw - side) / 2, y: (vh - side) / 2, width: side, height: side });
      stopTicketMedia();
      labelTicket({ img, format: '' }, true);
    };
    const fallbackBtn = h('button', { type: 'button', class: 'btn', hidden: true, onclick: keepPicture }, '📸 Save a picture instead');
    fill(dlg, h('form', { method: 'dialog', onsubmit: (e) => { e.preventDefault(); closeSheet(); } },
      h('h2', null, '🎟 Scan a park ticket'),
      h('div', { class: 'scan-box' }, video, h('div', { class: 'scan-frame', 'aria-hidden': 'true' })),
      status,
      h('div', { class: 'actions' }, fallbackBtn, h('button', { type: 'submit', class: 'btn' }, 'Cancel'))));
    dlg.addEventListener('close', stopTicketMedia, { once: true });
    if (typeof dlg.showModal === 'function' && !dlg.open) dlg.showModal(); else dlg.setAttribute('open', '');
    try {
      ticketStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      video.srcObject = ticketStream;
      await video.play();
    } catch (e) {
      status.textContent = e && e.name === 'NotAllowedError'
        ? 'Camera access was blocked. Allow the camera for this site in your browser settings, or use “From photo or screenshot”.'
        : 'Couldn’t start the camera. Use “From photo or screenshot” instead.';
      return;
    }
    status.textContent = 'Hold the ticket’s QR code inside the frame — it saves as soon as it’s read.';
    const started = Date.now();
    const tick = async () => {
      if (!ticketStream) return;
      if (video.videoWidth) {
        const r = readQR(video, video.videoWidth, video.videoHeight);
        if (r) { stopTicketMedia(); if (navigator.vibrate) navigator.vibrate(60); labelTicket(qrTicketData(r), false); return; }
        if (detector) {
          try {
            const c = (await detector.detect(video))[0];
            if (c) {
              const img = ticketPicture(video, video.videoWidth, video.videoHeight, c.boundingBox);
              stopTicketMedia();
              labelTicket({ value: c.rawValue, format: c.format, img }, false);
              return;
            }
          } catch { /* frame not ready */ }
        }
        if (Date.now() - started > 12000 && fallbackBtn.hidden) {
          fallbackBtn.hidden = false;
          status.textContent = 'Still looking… move closer, avoid glare and keep it steady. If it’s not a QR code, save a picture instead.';
        }
      }
      ticketLoop = setTimeout(tick, 180);
    };
    tick();
  }

  async function importTicketImage(file) {
    if (!file) return;
    let bmp;
    try { bmp = await createImageBitmap(file); } catch { toast('Couldn’t open that image. For a PDF ticket, take a screenshot of it first.'); return; }
    toast('Reading the code…');
    await new Promise((r) => setTimeout(r, 30)); // let the toast paint before the decode
    const r = readQR(bmp, bmp.width, bmp.height);
    if (r) { labelTicket(qrTicketData(r), false); return; }
    const detector = await otherDetector();
    if (detector) {
      try {
        const c = (await detector.detect(bmp))[0];
        if (c) { labelTicket({ value: c.rawValue, format: c.format, img: ticketPicture(bmp, bmp.width, bmp.height, c.boundingBox) }, false); return; }
      } catch { /* unreadable */ }
    }
    labelTicket({ img: ticketPicture(bmp, bmp.width, bmp.height, null), format: '' }, true);
  }

  function labelTicket(found, notRead) {
    const list = getTickets();
    if (found.value && list.some((t) => t.value === found.value)) { closeSheet(); toast('That ticket is already saved.'); return; }
    const dlg = $('#sheet');
    const me = S.me?.user?.name || S.boot.user?.name || '';
    const name = h('input', { type: 'text', maxlength: '40', required: true, value: list.length ? '' : me, placeholder: 'Whose ticket? e.g. Sam' });
    const note = h('input', { type: 'text', maxlength: '60', placeholder: 'Optional, e.g. 3-day, 4–6 Nov' });
    const preview = { label: 'ticket', ...found };
    fill(dlg, h('form', { method: 'dialog', onsubmit: (e) => {
      e.preventDefault();
      const t = { id: Date.now().toString(36), label: name.value.trim() || `Ticket ${list.length + 1}`, note: note.value.trim(), added: Date.now(), ...found };
      if (t.qr) delete t.img; // the redraw replaces the picture
      if (saveTickets([...list, t])) { closeSheet(); toast('🎟 Ticket saved on this phone'); renderView(); }
    } },
      h('h2', null, '🎟 Save ticket'),
      h('div', { class: 'ticket-big' }, ticketCode(preview, 'ticket-code')),
      notRead
        ? h('p', { class: 'notice' }, 'The code couldn’t be read, so a picture is saved instead. For a code the app can redraw perfectly, try again closer, without glare — or use a screenshot of the e-ticket.')
        : h('p', { class: 'spark-lbl' }, found.qr
          ? `✓ QR code read and redrawn (version ${found.qr.version}, error correction ${window.PPQR?.ECL_NAMES[found.qr.ecl] || ''}).`
          : `✓ ${TICKET_FORMAT_LABEL[found.format] || 'Code'} read — kept as a picture.`),
      found.value && found.value.length <= 60 ? h('p', { class: 'ticket-val' }, found.value) : null,
      h('label', null, 'Name', name),
      h('label', null, 'Note', note),
      h('div', { class: 'actions' },
        h('button', { type: 'submit', class: 'btn primary' }, 'Save'),
        h('button', { type: 'button', class: 'btn', onclick: closeSheet }, 'Cancel'))));
    if (typeof dlg.showModal === 'function' && !dlg.open) dlg.showModal(); else dlg.setAttribute('open', '');
    name.focus();
  }

  async function showTicket(i) {
    const list = getTickets();
    const t = list[i];
    if (!t) return;
    const dlg = $('#sheet');
    fill(dlg, h('form', { method: 'dialog', class: 'ticket-show', onsubmit: (e) => { e.preventDefault(); closeSheet(); } },
      h('h2', null, `🎟 ${t.label}`, list.length > 1 ? h('small', null, ` · ${i + 1} of ${list.length}`) : null),
      t.note ? h('p', { class: 'spark-lbl' }, t.note) : null,
      h('div', { class: 'ticket-big' }, ticketCode(t, 'ticket-code')),
      t.value && t.value.length <= 40 ? h('p', { class: 'ticket-val' }, t.value) : null,
      h('p', { class: 'spark-lbl' }, '☀️ Turn your screen brightness right up and hold the phone flat under the gate reader. The screen stays on while this is open.'),
      h('div', { class: 'actions' },
        list.length > 1 ? h('button', { type: 'button', class: 'btn', onclick: () => showTicket((i - 1 + list.length) % list.length) }, '◀ Prev') : null,
        list.length > 1 ? h('button', { type: 'button', class: 'btn', onclick: () => showTicket((i + 1) % list.length) }, 'Next ▶') : null,
        h('button', { type: 'submit', class: 'btn primary' }, 'Done'))));
    dlg.addEventListener('close', stopTicketMedia, { once: true });
    if (typeof dlg.showModal === 'function' && !dlg.open) dlg.showModal(); else dlg.setAttribute('open', '');
    if (!ticketLock && 'wakeLock' in navigator) {
      try { ticketLock = await navigator.wakeLock.request('screen'); } catch { /* not allowed */ }
    }
  }

  function ticketsCard() {
    const list = getTickets();
    const file = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: (e) => { importTicketImage(e.target.files[0]); e.target.value = ''; } });
    const canCam = !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;
    return h('section', { class: 'card day tickets' },
      h('h2', null, `🎟 Park tickets${list.length ? ` (${list.length})` : ''}`),
      list.length
        ? h('ul', { class: 'ticket-list' }, list.map((t, i) => {
          const confirming = ticketDelete === t.id;
          return h('li', null,
            h('button', { type: 'button', class: 'ticket-row', onclick: () => showTicket(i) },
              ticketCode(t, 'ticket-thumb'),
              h('span', { class: 'what' }, h('b', null, t.label), h('small', null, [t.note, ticketQRModel(t) ? 'QR code' : (TICKET_FORMAT_LABEL[t.format] || 'picture')].filter(Boolean).join(' · ')))),
            h('button', {
              type: 'button', class: 'btn small' + (confirming ? ' danger' : ''), 'aria-label': confirming ? `Confirm delete ${t.label}` : `Delete ${t.label}`,
              onclick: () => {
                if (!confirming) { ticketDelete = t.id; renderView(); setTimeout(() => { if (ticketDelete === t.id) { ticketDelete = null; renderView(); } }, 4000); return; }
                ticketDelete = null;
                saveTickets(getTickets().filter((x) => x.id !== t.id));
                toast('Ticket removed');
                renderView();
              },
            }, confirming ? 'Delete?' : '✕'));
        }))
        : h('p', { class: 'spark-lbl' }, 'Scan everyone’s park tickets: the app reads each QR code and redraws it here, ready for the gates, even with no signal.'),
      h('div', { class: 'actions' },
        list.length ? h('button', { type: 'button', class: 'btn primary', onclick: () => showTicket(0) }, '🚪 Show at the gate') : null,
        canCam ? h('button', { type: 'button', class: 'btn' + (list.length ? '' : ' primary'), onclick: openTicketScanner }, '📷 Scan ticket') : null,
        h('button', { type: 'button', class: 'btn', onclick: () => file.click() }, '🖼 From photo or screenshot'),
        file),
      h('p', { class: 'spark-lbl' }, '🔒 Tickets stay on this phone only and are never uploaded. Keep your official ticket or the Disneyland Paris app as a backup.'));
  }

  function viewTrip() {
    const frag = document.createDocumentFragment();
    const trip = S.trip;
    const cfg = S.boot.trip;
    const t = today();
    const until = daysBetween(t, cfg.start);
    const after = daysBetween(cfg.end, t);
    let cd;
    if (until > 0) cd = h('div', { class: 'card countdown' }, h('b', null, until === 1 ? 'Tomorrow!' : `${until} days`), until === 1 ? 'until the parks' : `until ${dayLabel(cfg.start)}`);
    else if (after <= 0) cd = h('div', { class: 'card countdown' }, h('b', null, `Day ${1 - until}`), `of ${daysBetween(cfg.start, cfg.end) + 1} — have fun!`);
    else cd = h('div', { class: 'card countdown' }, h('b', null, 'Trip complete'), 'Your ride log is under Mine.', h('button', { type: 'button', class: 'btn small wr-play', onclick: () => openWrapped() }, '▶ Watch your Wrapped'), h('button', { type: 'button', class: 'btn small wr-play', onclick: () => openVisitSheet() }, '＋ Plan another visit'));
    add(frag, cd);
    const added = S.catalog?.new || [];
    if (added.length) {
      const kinds = { ATTRACTION: 'Ride', SHOW: 'Show', RESTAURANT: 'Restaurant' };
      add(frag, h('section', { class: 'card whats-new' },
        h('h2', null, '🆕 New at the parks'),
        h('ul', { class: 'wr-list' }, added.map((n) => h('li', null, h('b', null, n.name), ` · ${kinds[n.type] || 'New'}, ${parkShort(n.park)}, spotted ${dayLabelY(n.firstSeen)}`)))));
    }
    add(frag, ticketsCard());
    add(frag, tripPackCard());
    add(frag, crowdCalendar());
    add(frag, plannerCard());
    add(frag, bookingsCard());
    add(frag, ropeDropCard());
    if (S.boot.transit) add(frag, transitCard());

    if (S.tripErr) add(frag, h('p', { class: 'notice' + (trip ? '' : ' err') }, `Couldn’t refresh schedules: ${S.tripErr}`));
    if (!trip) {
      add(frag, h('p', { class: 'empty' }, S.tripErr ? '' : 'Loading schedules (first load fetches every show — a few seconds)…'));
      return frag;
    }
    for (const e of trip.errors || []) add(frag, h('p', { class: 'notice' }, e));

    for (const day of trip.days) {
      const shows = day.shows.filter((s) => !(S.hideReserved && s.reserved));
      const isToday = day.date === t;
      const card = h('section', { class: 'card day' + (isToday ? ' today' : '') },
        h('h2', null, dayLabel(day.date), isToday ? h('span', { class: 'badge open' }, 'TODAY') : null),
        S.weather?.daily?.[day.date]
          ? h('button', { type: 'button', class: 'wx-day', onclick: openWeatherSheet }, dayWeather(S.weather.daily[day.date]))
          : null,
        trip.parks.map((p) => h('div', { class: 'day-park' }, h('span', null, p.short), hoursLine(day.parks[p.key]))));

      if (shows.length) {
        const byPark = trip.parks.map((p) => ({ p, list: groupShows(shows.filter((s) => s.park === p.key)) }))
          .filter((g) => g.list.length);
        add(card, h('details', { open: isToday || null },
          h('summary', null, `Shows & characters (${groupShows(shows).length})`),
          byPark.map(({ p, list }) => [
            h('div', { class: 'group-h' }, p.short),
            list.map((s) => h('div', { class: 'show-row' }, h('div', { class: 'show-name' }, s.name, completedTag(s.id)), timeChips(s.times, isToday))),
          ])));
      } else {
        add(card, h('p', { class: 'spark-lbl' }, 'No show times published yet.'));
      }
      add(frag, card);
    }
    add(frag, h('p', { class: 'foot' }, `Schedules fetched ${ago(trip.fetchedAt)} · ThemeParks.wiki`));
    return frag;
  }

  function transitCard() {
    const t = S.transit;
    const card = h('section', { class: 'card day transit' },
      h('h2', null, '🚆 Trains', h('button', { type: 'button', class: 'btn small', onclick: () => { toast('Refreshing trains…'); loadTransit(); } }, '↻')));
    if (!t) {
      add(card, h('p', { class: 'spark-lbl' }, 'Loading RER A…'));
      return card;
    }
    add(card, h('div', { class: 'spark-lbl' }, `${t.label} → Paris · updated ${ago(t.fetchedAt)}`));
    for (const m of t.messages) {
      add(card, h('p', { class: 'notice' + (m.severity === 'disruption' ? ' err' : '') }, m.text));
    }
    if (!t.messages.length && !t.errors.length) add(card, h('p', { class: 'spark-lbl ok' }, '✓ No disruption reported on RER A'));
    if (t.departures.length) {
      add(card, h('ul', { class: 'deps' }, t.departures.map((d) => h('li', null,
        h('b', null, time(d.time)),
        h('span', { class: 'what' }, d.destination || 'Paris', d.code ? h('small', null, ` ${d.code}`) : null),
        d.delay > 0 ? h('span', { class: 'up' }, `+${d.delay}`) : null,
        /cancel/i.test(d.status) ? h('span', { class: 'up' }, 'Cancelled') : null,
        d.platform ? h('small', null, `Pl. ${d.platform}`) : null,
        h('small', null, inLabel(minsUntil(d.time)))))));
    }
    for (const e of t.errors) add(card, h('p', { class: 'notice' }, e));
    add(card, h('p', { class: 'foot' }, 'Live data: Île-de-France Mobilités (PRIM)'));
    return card;
  }

  // ------------------------------------------------------------- mine tab

  function liveItem(id) {
    for (const p of [...Object.values(S.live), S.village, S.shops]) {
      const it = p?.items?.find((x) => x.id === id);
      if (it) return it;
    }
    return null;
  }

  // ---------------------------------------------------- best times (Mine)

  async function loadBest() {
    if (S.best && Date.now() - (S.best._at || 0) < 10 * 60 * 1000) return;
    try {
      const d = await api('best-times');
      d._at = Date.now();
      S.best = d;
      store.set('best', S.best);
      if (S.tab === 'mine') renderView();
    } catch { /* keep cached */ }
  }

  const hh = (n) => String(n % 24).padStart(2, '0');
  /** [9,10,19] -> "09–11, 19–20" */
  function hourRanges(hours) {
    const out = [];
    for (const n of [...hours].map(Number).sort((a, b) => a - b)) {
      const last = out[out.length - 1];
      if (last && last[1] === n) last[1] = n + 1; else out.push([n, n + 1]);
    }
    return out.map(([a, b]) => `${hh(a)}–${hh(b)}`).join(', ');
  }
  /** Sequential bucket (one hue, light = short, dark = long). */
  const level = (w) => (w <= 10 ? 1 : w <= 20 ? 2 : w <= 30 ? 3 : w <= 45 ? 4 : w <= 60 ? 5 : w <= 90 ? 6 : 7);

  function bestStrip(r, range, nowHour) {
    const pick = S.bestPick[r.id];
    const best = new Set((r.best || []).map(Number));
    const cells = [];
    for (let hr = range[0]; hr <= range[1]; hr++) {
      const x = r.hours[hr];
      cells.push(h('button', {
        type: 'button',
        class: 'bt-cell' + (x ? ' lv' + level(x.avg) : ' none') + (best.has(hr) ? ' best' : '')
          + (hr === nowHour ? ' now' : '') + (pick === hr ? ' picked' : ''),
        title: x ? `${hh(hr)}:00 · ~${x.avg} min` : `${hh(hr)}:00 · no data`,
        'aria-label': x ? `${hh(hr)}:00, about ${x.avg} minutes${best.has(hr) ? ', best time' : ''}` : `${hh(hr)}:00, no data`,
        onclick: () => { S.bestPick[r.id] = pick === hr ? undefined : hr; renderView(); },
      }));
    }
    return h('div', { class: 'bt-strip', role: 'group', 'aria-label': `Average wait by hour for ${r.name}` }, cells);
  }

  function bestRow(r, range, nowHour) {
    const pick = S.bestPick[r.id];
    let caption;
    if (pick != null && r.hours[pick]) {
      const x = r.hours[pick];
      caption = `${hh(pick)}:00–${hh(pick + 1)}:00 · ~${x.avg} min · ${x.n} snapshots over ${x.days} day${x.days === 1 ? '' : 's'}`;
    } else if (pick != null) {
      caption = `${hh(pick)}:00 · no data for this hour yet`;
    } else if (r.alwaysShort) {
      caption = 'Short all day (≤10 min) — ride whenever it suits you';
    } else {
      caption = [
        r.best.length ? `Best ${hourRanges(r.best)} (~${r.bestAvg} min)` : null,
        r.worst != null ? `avoid ${hourRanges([r.worst])} (~${r.worstAvg} min)` : null,
      ].filter(Boolean).join(' · ');
    }
    const now = r.hours[nowHour];
    return h('li', { class: 'card bt-row' },
      h('div', { class: 'bt-h' },
        h('button', { type: 'button', class: 'bt-name', onclick: () => openFav({ id: r.id, park: r.park }) },
          r.fav ? h('span', { class: 'star', 'aria-label': 'Must-do' }, '★') : null, r.name),
        now ? h('span', { class: 'bt-now' }, `now usually ~${now.avg}`) : null),
      bestStrip(r, range, nowHour),
      h('div', { class: 'bt-cap' + (pick == null && !r.alwaysShort && r.best.length ? ' good' : '') }, caption));
  }

  function bestTimesSection() {
    const frag = document.createDocumentFragment();
    add(frag, h('h2', { class: 'group-h' }, 'Best times to ride'));
    const b = S.best;
    if (!b) {
      add(frag, h('p', { class: 'empty' }, 'Loading wait history…'));
      return frag;
    }
    const favs = new Set((S.me?.favourites || []).map((f) => f.id));
    const rides = b.rides.map((r) => ({ ...r, fav: favs.has(r.id) }));
    const ready = rides.filter((r) => r.enough);
    if (!ready.length) {
      add(frag, h('p', { class: 'notice' },
        'Not enough wait history yet. Park Pulse saves a snapshot every 5 minutes while the cron job runs (or someone has the app open); best times appear after a few hours of data and get sharper each day of the trip.'));
      return frag;
    }

    add(frag, h('p', { class: 'spark-lbl' },
      `From ${b.days} day${b.days === 1 ? '' : 's'} of wait snapshots${b.first ? ` (${dayLabel(b.first)}${b.last && b.last !== b.first ? '–' + dayLabel(b.last) : ''})` : ''}. Outlined hours are the quietest; tap any hour for its average.`));
    add(frag, h('div', { class: 'bt-legend', 'aria-hidden': 'true' },
      h('span', null, 'short'), [1, 2, 3, 4, 5, 6, 7].map((l) => h('i', { class: 'bt-cell lv' + l })), h('span', null, 'long wait'),
      h('i', { class: 'bt-cell lv2 best' }), h('span', null, 'best')));

    add(frag, h('div', { class: 'toggle-row' },
      chip('Must-dos & top rides', !S.bestAll, () => { S.bestAll = false; renderView(); }),
      chip(`All ${ready.length} rides`, S.bestAll, () => { S.bestAll = true; renderView(); })));

    for (const p of S.boot.parks) {
      let list = ready.filter((r) => r.park === p.key);
      if (!list.length) continue;
      list.sort((a, b2) => (b2.fav - a.fav) || (b2.avg - a.avg));
      if (!S.bestAll) list = list.filter((r, i) => r.fav || i < 8);
      const hoursSeen = list.flatMap((r) => Object.keys(r.hours).map(Number));
      const range = [Math.min(...hoursSeen), Math.max(...hoursSeen)];
      const pk = b.parks?.[p.key];
      add(frag, h('div', { class: 'bt-park' },
        h('b', null, p.short),
        pk?.best?.length ? h('span', null, ` · quietest overall ${hourRanges(pk.best)}`) : null));
      add(frag, h('div', { class: 'bt-axis', 'aria-hidden': 'true' },
        h('span', null, `${hh(range[0])}:00`), h('span', null, `${hh(range[1] + 1)}:00`)));
      add(frag, h('ul', { class: 'list' }, list.map((r) => bestRow(r, range, b.hour))));
    }
    const waiting = rides.length - ready.length;
    if (waiting > 0) add(frag, h('p', { class: 'spark-lbl' }, `${waiting} more ride${waiting === 1 ? '' : 's'} still collecting data.`));
    return frag;
  }

  async function signOut() {
    try {
      const r = await api('logout', { method: 'POST' });
      try { localStorage.clear(); } catch { /* ignore */ }
      if (r.redirect) location.href = r.redirect;
      else location.reload();
    } catch (e) { toast(e.message); }
  }

  function favStatus(f, it) {
    if (completedShow(f.id)) return 'Completed';
    if (!it) return '';
    if (it.type === 'SHOP') return '🛍';
    if (it.type === 'RESTAURANT' || it.type === 'VILLAGE') return foodState(it).badge;
    if (it.status === 'OPERATING') return it.wait != null ? `${it.wait} min` : 'Open';
    return it.status === 'DOWN' ? 'Down' : 'Closed';
  }

  function openFav(f) {
    const it = liveItem(f.id);
    const food = f.park === 'village' || it?.type === 'RESTAURANT' || it?.type === 'SHOP' || f.id.startsWith('osm-');
    if (food) {
      S.placeKind = it?.type === 'SHOP' || it?.section === 'Shops' ? 'shop' : 'food';
      store.set('placeKind', S.placeKind);
      S.foodArea = f.park; store.set('foodArea', f.park);
      S.foodFilter = 'all'; store.set('foodFilter', 'all');
      if (f.park !== 'village') { S.park = f.park; store.set('park', f.park); }
      switchTab('food');
    } else {
      S.park = f.park; store.set('park', f.park);
      S.filter = 'all'; store.set('filter', 'all');
      switchTab('now');
      loadHistory(f.id);
    }
    S.expanded = f.id;
    renderView();
    requestAnimationFrame(() => document.getElementById('r-' + f.id)?.scrollIntoView({ block: 'center' }));
  }

  // Colour theme: per phone, applied by assets/theme.js (loaded in <head> so there's no flash).
  const THEME_MODES = [['auto', '🌗 Auto'], ['light', '☀️ Light'], ['dark', '🌙 Dark'], ['black', '⚫ Black']];
  const THEME_ACCENTS = [
    ['indigo', 'Indigo', '#3b2fc9', '#16163a'], ['castle', 'Castle pink', '#c2187a', '#3a1030'],
    ['ocean', 'Ocean', '#0a6fb8', '#0d2a45'], ['forest', 'Forest', '#1d7a46', '#12321f'],
    ['sunset', 'Sunset', '#c2410c', '#3d1a0a'], ['galaxy', 'Galaxy', '#7b2fbf', '#2a1240'],
    ['gold', 'Gold', '#9a5b05', '#33260a'], ['graphite', 'Graphite', '#3f4756', '#1f2430'],
  ];
  function setTheme(patch) {
    const t = { mode: 'auto', accent: 'indigo', ...store.get('theme', {}), ...patch };
    store.set('theme', t);
    window.ppTheme?.apply(t);
    renderView();
  }
  function themeSection() {
    const t = { mode: 'auto', accent: 'indigo', ...store.get('theme', {}) };
    return sec('🎨 Theme',
      h('div', { class: 'toggle-row', role: 'group', 'aria-label': 'Colour mode' },
        THEME_MODES.map(([k, label]) => chip(label, t.mode === k, () => setTheme({ mode: k })))),
      h('div', { class: 'swatches', role: 'group', 'aria-label': 'Accent colour' },
        THEME_ACCENTS.map(([k, label, c, top]) => {
          const b = h('button', {
            type: 'button', class: 'swatch', 'aria-pressed': String(t.accent === k), title: label,
            onclick: () => setTheme({ accent: k }),
          }, h('i', { 'aria-hidden': 'true' }), label);
          b.style.setProperty('--sw', c); // CSSOM, not a style attribute: the CSP forbids inline styles
          b.style.setProperty('--sw-top', top);
          return b;
        })),
      h('p', { class: 'spark-lbl' }, 'Auto follows your phone’s light/dark setting. Black saves battery on OLED screens. Saved on this phone only.'));
  }

  function viewMine() {
    const frag = document.createDocumentFragment();
    const { favourites = [] } = S.me || {};
    let { log = [] } = S.me || {};
    const oidc = !!(S.me?.user || S.boot.user); // per-person identity: SSO user or PIN profile
    if (oidc && S.justMe) log = log.filter((l) => l.mine);
    const t = today();
    // The picker scopes the history below. Today's count and must-do ticks always mean the current visit.
    const scope = mineScope();
    const inVisit = (v) => (l) => l.day >= v.start && l.day <= v.end;
    const everything = log;
    const currentLog = everything.filter(inVisit(S.boot.trip));
    if (scope) log = everything.filter(inVisit(scope));

    if (S.boot.auth !== 'none') {
      const u = S.me?.user || S.boot.user;
      add(frag, h('div', { class: 'card account' },
        u ? h('button', { type: 'button', class: 'av-btn', title: 'Change your picture', 'aria-label': 'Change your picture', onclick: openAvatarSheet }, avatarEl(u, 'pf-av'), h('span', { class: 'av-edit', 'aria-hidden': 'true' }, '✏️')) : null,
        h('span', { class: 'what' }, u ? h('b', null, u.name) : 'Signed in with PIN', u?.email ? h('small', null, u.email) : null),
        S.boot.auth === 'pin' ? h('button', { type: 'button', class: 'btn small', onclick: () => showProfilePicker({ switching: true }) }, '🔁 Switch') : null,
        h('button', { type: 'button', class: 'btn small', onclick: signOut }, 'Sign out')));
    }
    // Up top, and whether or not this person logged anything: the party's story still plays.
    add(frag, visitsSection(scope));
    if (scope && t > scope.end) {
      add(frag, h('section', { class: 'card wrapped wr-link' },
        h('h2', null, scope.id === S.boot.trip.id ? '🎉 Your Trip Wrapped' : `🎉 ${visitName(scope)} Wrapped`),
        h('div', { class: 'wr-actions' },
          h('button', { type: 'button', class: 'btn small wr-play', onclick: () => openWrapped({ visit: scope }) }, '▶ View your Wrapped'),
          h('button', { type: 'button', class: 'btn small wr-play', onclick: () => openWrapped({ badges: true, visit: scope }) }, '🏅 Badges'),
          wrappedLog(scope).some((l) => l.mine) ? h('button', { type: 'button', class: 'btn small wr-play', onclick: () => openWrapped({ summary: true, visit: scope }) }, '📸 Image to share') : null,
          h('button', { type: 'button', class: 'btn small wr-play', onclick: () => openMapHistory({ visit: scope }) }, '🗺️ Map history')),
        roastToggle()));
    }
    if (oidc) {
      add(frag, h('div', { class: 'toggle-row' },
        chip('Everyone', !S.justMe, () => { S.justMe = false; store.set('justMe', false); renderView(); }),
        chip('Just me', S.justMe, () => { S.justMe = true; store.set('justMe', true); renderView(); })));
    }
    const todays = everything.filter((l) => l.day === t);
    const queued = log.reduce((n, l) => n + (l.wait || 0), 0);

    add(frag, h('div', { class: 'stats' },
      h('div', { class: 'card stat' }, h('b', null, String(todays.length)), h('span', null, 'rides today')),
      h('div', { class: 'card stat' }, h('b', null, String(log.length)), h('span', null, 'rides total')),
      h('div', { class: 'card stat' }, h('b', null, queued >= 120 ? `${Math.floor(queued / 60)}h${String(queued % 60).padStart(2, '0')}` : `${queued}m`), h('span', null, 'queued'))));

    // Must-do list
    add(frag, h('h2', { class: 'group-h' }, `Must-do (${favourites.filter((f) => currentLog.some((l) => l.entityId === f.id)).length}/${favourites.length} done)`));
    if (!favourites.length) {
      add(frag, h('p', { class: 'empty' }, 'Tap a ride on Waits, then ☆ Must-do to build your list.'));
    } else {
      add(frag, h('ul', { class: 'list' }, favourites.map((f) => {
        const done = currentLog.some((l) => l.entityId === f.id);
        const it = liveItem(f.id);
        const right = favStatus(f, it);
        return h('li', { class: 'card' }, h('button', {
          type: 'button', class: 'fav-item ride-main',
          onclick: () => openFav(f),
        },
        h('span', { class: 'tick' }, done ? '✓' : ''),
        h('span', { class: 'what' }, f.name, h('div', { class: 'park-tag' }, parkShort(f.park))),
        h('span', { class: 'live' }, right)));
      })));
    }

    add(frag, bestTimesSection());
    add(frag, pushSection());
    add(frag, themeSection());

    const alerts = Object.entries(S.alerts);
    if (alerts.length) {
      add(frag, h('h2', { class: 'group-h' }, 'Alerts on this phone'));
      if ('Notification' in window && Notification.permission !== 'granted') {
        add(frag, h('p', { class: 'notice' },
          Notification.permission === 'denied'
            ? 'Notifications are blocked for this site, so alerts show as in-app pop-ups only.'
            : 'Allow notifications so alerts reach you while the app is in the background. ',
          Notification.permission === 'default'
            ? h('button', { type: 'button', class: 'btn small', onclick: async () => { await Notification.requestPermission(); renderView(); } }, 'Allow')
            : null));
      }
      add(frag, h('ul', { class: 'list' }, alerts.map(([id, a]) => {
        const what = [a.reopen ? 'reopens' : null, a.maxWait != null ? `≤ ${a.maxWait} min` : null, a.down ? 'goes down' : null].filter(Boolean).join(', ');
        return h('li', { class: 'card log-item' },
          h('span', { class: 'what' }, a.name, h('small', null, `${parkShort(a.park)} · when it ${what}`)),
          h('button', {
            type: 'button', class: 'btn small', 'aria-label': 'Remove alert',
            onclick: () => { delete S.alerts[id]; syncAlerts(); renderView(); },
          }, '✕'));
      })));
    }

    let watched = S.me?.shows || [];
    if (oidc && S.justMe) watched = watched.filter((w) => w.mine);
    if (scope) watched = watched.filter(inVisit(scope));

    let places = S.me?.places || [];
    if (oidc && S.justMe) places = places.filter((p) => p.mine);
    if (scope) places = places.filter(inVisit(scope));
    let metOrSeen = S.me?.characters || [];
    if (oidc && S.justMe) metOrSeen = metOrSeen.filter((m) => m.mine);
    if (scope) metOrSeen = metOrSeen.filter(inVisit(scope));

    const wr = wrappedCard(log, watched, scope, places, metOrSeen);
    if (wr) add(frag, wr);
    add(frag, spendSection(scope, oidc));
    add(frag, characterSection(scope, oidc));

    // Ride log grouped by day
    const loggedList = (title, rows, path, atOf) => {
      if (!rows.length) return;
      add(frag, h('h2', { class: 'group-h' }, `${title} · ${rows.length}`));
      add(frag, h('ul', { class: 'list' }, rows.map((w) => {
        const key = `${path}-${w.id}`;
        const confirming = S.deleting === key;
        return h('li', { class: 'card log-item' },
          h('span', { class: 'when' }, timeTs(atOf(w))),
          h('span', { class: 'what' }, w.name, h('small', null, [dayLabelY(w.day), oidc && w.by ? (w.mine ? 'You' : w.by) : null, parkShort(w.park), w.amountCents != null ? money(w.amountCents) : null, w.note].filter(Boolean).join(' · '))),
          h('button', {
            type: 'button', class: 'btn small' + (confirming ? ' danger' : ''), 'aria-label': confirming ? 'Confirm delete' : 'Delete entry',
            onclick: async () => {
              if (!confirming) { S.deleting = key; renderView(); return; }
              try {
                S.me = await api(`${path}/${w.id}`, { method: 'DELETE' });
                store.set('me', S.me);
                toast('Deleted');
              } catch (e) { toast(e.message); }
              S.deleting = null;
              renderView();
            },
          }, confirming ? 'Delete?' : '✕'));
      })));
    };
    loggedList('Shows watched', watched, 'watched', (w) => w.watchedAt);
    loggedList('Places you ate', places.filter((p) => p.kind === 'food'), 'places', (p) => p.visitedAt);
    loggedList('Shops you visited', places.filter((p) => p.kind === 'shop'), 'places', (p) => p.visitedAt);
    loggedList('Shops you perused', places.filter((p) => p.kind === 'browse'), 'places', (p) => p.visitedAt);

    add(frag, h('h2', { class: 'group-h' }, 'Ride log'));
    if (!log.length) {
      add(frag, h('p', { class: 'empty' }, scope && t > scope.end ? 'No rides logged on this visit.' : 'Nothing logged yet. Open a ride and tap “I rode it”.'));
    } else {
      const days = new Map();
      for (const l of log) {
        if (!days.has(l.day)) days.set(l.day, []);
        days.get(l.day).push(l);
      }
      for (const [day, list] of days) {
        add(frag, h('div', { class: 'group-h' }, `${dayLabelY(day)} · ${list.length} ride${list.length === 1 ? '' : 's'}`));
        add(frag, h('ul', { class: 'list' }, list.map((l) => {
          const type = QUEUE_TYPES.find(([k]) => k === l.queueType)?.[1] || l.queueType;
          const sub = [oidc && l.by ? (l.mine ? 'You' : l.by) : null, parkShort(l.park),
            l.wait != null ? `${l.wait} min ${type.toLowerCase()}` : type, l.posted != null ? `sign said ${l.posted}` : null, l.note].filter(Boolean).join(' · ');
          const confirming = S.deleting === l.id;
          return h('li', { class: 'card log-item' },
            h('span', { class: 'when' }, timeTs(l.riddenAt)),
            h('span', { class: 'what' }, l.name, h('small', null, sub)),
            h('button', {
              type: 'button', class: 'btn small' + (confirming ? ' danger' : ''), 'aria-label': confirming ? 'Confirm delete' : 'Delete entry',
              onclick: async () => {
                if (!confirming) { S.deleting = l.id; renderView(); return; }
                try {
                  S.me = await api('log/' + l.id, { method: 'DELETE' });
                  store.set('me', S.me);
                  const it = liveItem(l.entityId);
                  if (it && it.rides) it.rides--;
                  toast('Deleted');
                } catch (e) { toast(e.message); }
                S.deleting = null;
                renderView();
              },
            }, confirming ? 'Delete?' : '✕'));
        })));
      }
    }

    add(frag, h('p', { class: 'foot' },
      h('a', { href: 'api/export', target: '_blank', rel: 'noopener' }, 'Export my data (JSON)')));
    return frag;
  }

  // ---------------------------------------------------------------- visits

  /** The visit Mine is showing, or null for all of them. */
  function mineScope() {
    if (S.mineVisit === 'all') return null;
    return (S.boot.visits || []).find((v) => v.id === S.mineVisit) || S.boot.trip;
  }

  function visitsSection(scope) {
    const visits = S.boot.visits || [];
    const t = today();
    const stray = (S.me?.log || []).some((l) => !visits.some((v) => l.day >= v.start && l.day <= v.end));
    const pick = (id) => () => { S.mineVisit = id; renderView(); };
    const status = !scope ? 'Everything logged, on any date.'
      : t > scope.end ? `${tripRange(scope)} · past visit`
        : t < scope.start ? `${tripRange(scope)} · coming up`
          : `${tripRange(scope)} · happening now`;
    return h('section', { class: 'card visits' },
      h('h2', null, '🗓 Visits'),
      h('div', { class: 'toggle-row visit-chips' },
        visits.map((v) => chip(visitName(v), scope?.id === v.id, pick(v.id))),
        visits.length > 1 || stray ? chip('All', !scope, pick('all')) : null),
      h('p', { class: 'spark-lbl' }, status),
      h('div', { class: 'wr-actions' },
        visits.length > 1 ? h('button', { type: 'button', class: 'btn small', onclick: () => openCompareSheet(scope) }, '📊 Compare') : null,
        scope?.id ? h('button', { type: 'button', class: 'btn small', onclick: () => openVisitSheet(scope) }, '✏️ Edit') : null,
        h('button', { type: 'button', class: 'btn small', onclick: () => openVisitSheet() }, '＋ Add a visit')));
  }

  /** A new current visit changes dates all over the app, so start again from the server. */
  function applyVisits({ visits, current }) {
    const was = S.boot.trip;
    const changed = was.id !== current.id || was.start !== current.start || was.end !== current.end;
    S.boot.visits = visits;
    S.boot.trip = current;
    store.set('boot', S.boot);
    if (S.mineVisit !== 'all' && !visits.some((v) => v.id === S.mineVisit)) S.mineVisit = null;
    closeSheet();
    if (changed) {
      store.set('trip', null);
      location.reload();
      return;
    }
    renderView();
  }

  function openVisitSheet(visit = null) {
    const dlg = $('#sheet');
    const name = h('input', { type: 'text', maxlength: '60', value: visit?.name || '', placeholder: 'e.g. Christmas 2027', 'aria-label': 'Name (optional)' });
    const start = h('input', { type: 'date', required: true, value: visit?.start || '', 'aria-label': 'First day' });
    const end = h('input', { type: 'date', required: true, value: visit?.end || '', 'aria-label': 'Last day' });
    start.addEventListener('change', () => { if (!end.value || end.value < start.value) end.value = start.value; });
    let confirming = false;
    const del = visit?.id && (S.boot.visits || []).length > 1 ? h('button', {
      type: 'button',
      class: 'btn',
      onclick: async () => {
        if (!confirming) {
          confirming = true;
          del.classList.add('danger');
          del.textContent = 'Delete? Rides stay logged';
          return;
        }
        try {
          applyVisits(await api('visits/' + visit.id, { method: 'DELETE' }));
          toast('Visit deleted');
        } catch (err) { toast(err.message); }
      },
    }, 'Delete') : null;
    const form = h('form', {
      method: 'dialog',
      onsubmit: async (e) => {
        e.preventDefault();
        const btn = form.querySelector('button[type=submit]');
        btn.disabled = true;
        try {
          applyVisits(await api('visits', { method: 'POST', body: { id: visit?.id, name: name.value.trim(), start: start.value, end: end.value } }));
          toast(visit ? 'Visit saved' : 'Visit added');
        } catch (err) {
          btn.disabled = false;
          toast(err.message);
        }
      },
    },
    h('h2', null, visit ? `Edit ${visitName(visit)}` : 'Add a visit'),
    h('label', null, 'Name (optional)', name),
    h('label', null, 'First day', start),
    h('label', null, 'Last day', end),
    h('p', { class: 'spark-lbl' }, 'Rides and shows belong to a visit by their date.'),
    h('div', { class: 'actions' },
      del,
      h('button', { type: 'button', class: 'btn', onclick: closeSheet }, 'Cancel'),
      h('button', { type: 'submit', class: 'btn primary' }, 'Save')));

    dlg.replaceChildren(form);
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
  }

  // ----------------------------------------------------------- login gate

  function showLogin() {
    $('.dock').hidden = true;
    $('#parkSeg').hidden = true;
    $('#hours').replaceChildren();
    $('#status').textContent = '';
    if (S.boot?.auth === 'oidc') {
      $('#view').replaceChildren(h('div', { class: 'card pin' },
        h('h2', null, 'Sign in'),
        h('p', { class: 'spark-lbl' }, 'Park Pulse is private to our trip party.'),
        h('a', { class: 'btn primary', href: 'auth/login' }, 'Sign in')));
      return;
    }
    const input = h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'current-password', 'aria-label': 'PIN', required: true, size: '8', maxlength: '32' });
    const msg = h('p', { class: 'spark-lbl' });
    const form = h('form', {
      class: 'card pin',
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          await api('login', { method: 'POST', body: { pin: input.value } });
          $('.dock').hidden = false;
          start();
        } catch (err) {
          msg.textContent = err.message;
          input.select();
        }
      },
    }, h('h2', null, 'Enter PIN'), input, msg, h('button', { type: 'submit', class: 'btn primary' }, 'Unlock'));
    $('#view').replaceChildren(form);
    input.focus();
  }

  // ----------------------------------------------------------------- boot

  async function start() {
    try {
      S.boot = await api('bootstrap');
      store.set('boot', S.boot);
    } catch (e) {
      S.boot = store.get('boot', null);
      if (!S.boot) {
        $('#view').replaceChildren(h('p', { class: 'notice err' }, `Can’t reach Park Pulse: ${e.message}`));
        return;
      }
    }
    TZ = S.boot.timezone || TZ;
    if (S.boot.auth !== 'none' && !S.boot.authed && S.online) { showLogin(); return; }
    if (S.boot.needsProfile && S.online) { showProfilePicker(); return; }
    if (S.boot.error && !S.boot.parks.length) {
      $('#view').replaceChildren(h('p', { class: 'notice err' }, `Couldn’t look up the parks: ${S.boot.error}`));
      return;
    }
    if (!S.boot.parks.some((p) => p.key === S.park)) S.park = S.boot.parks[0].key;

    $('.dock').hidden = false;
    render();
    // Trip over: Wrapped is the first page. Links from notifications still go straight to their page.
    if (tripEnded() && !location.hash) openWrapped();
    await loadLive(S.park);
    loadMe();
    if (S.tab === 'food' && S.foodArea === 'village') loadVillage();
    else if (S.tab === 'food' && S.foodArea !== S.park) loadLive(S.foodArea);
    loadWeather();
    if (S.tab === 'trip') loadTransit();
    loadBookings();
    loadPlan();
    loadBest();
    loadCatalog();
    loadTouringPlans();
    if (S.tab === 'guide') { loadGuide(); loadRatings(); loadVillage(); }
    if (leavePending()) startGeo();
    if (S.pack && navigator.onLine && Date.now() - S.pack.at > 12 * 3600 * 1000) setTimeout(() => downloadPack({ quiet: true }), 8000);
    if (S.tab === 'food') { loadRatings(); loadMenus(); }
    refreshPush();
    if (S.share) { // resume location sharing silently
      startGeo();
      shareTimer = setInterval(shareTick, 60000);
    }
    handleHash();
    // Warm the other park so switching is instant.
    for (const p of S.boot.parks) if (p.key !== S.park) loadLive(p.key, { quiet: true });
    if (S.tab === 'trip') loadTrip();
  }

  /** iOS sometimes reports safe-area-inset-top = 0 in Home-Screen apps; then guess from the screen size. */
  function fixSafeArea() {
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    const portraitNow = window.matchMedia('(orientation: portrait)').matches;
    const screenH = portraitNow ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
    // iOS 26 Safari draws the page edge-to-edge (behind the status bar) — the viewport fills the screen.
    const edgeToEdge = screenH - window.innerHeight <= 12;
    if (!ios || !(standalone || edgeToEdge)) return;
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;top:0;left:0;visibility:hidden;padding-top:env(safe-area-inset-top,0px)';
    document.body.append(probe);
    const inset = parseFloat(getComputedStyle(probe).paddingTop) || 0;
    probe.remove();
    if (inset > 0) return;
    const tall = Math.max(screen.width, screen.height);
    const portrait = window.matchMedia('(orientation: portrait)').matches;
    // Dynamic Island / notch phones are ≥ 812 pt tall; older iPhones have a 20 pt status bar.
    const guess = !portrait ? 0 : tall >= 852 ? 59 : tall >= 812 ? 47 : 20;
    document.documentElement.style.setProperty('--safe-top', guess + 'px');
  }

  /** The header is position:fixed, so pad the page by its live height. */
  function trackHeader() {
    const top = document.querySelector('.top');
    if (!top) return;
    const set = () => document.documentElement.style.setProperty('--header-h', top.offsetHeight + 'px');
    set();
    if ('ResizeObserver' in window) new ResizeObserver(set).observe(top);
    else window.addEventListener('resize', set);
  }

  document.addEventListener('DOMContentLoaded', () => {
    fixSafeArea();
    trackHeader();
    window.addEventListener('orientationchange', () => setTimeout(fixSafeArea, 300));
    window.addEventListener('resize', () => setTimeout(fixSafeArea, 300));
    for (const b of document.querySelectorAll('#tabs button')) b.addEventListener('click', () => switchTab(b.dataset.tab));
    $('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); }); // tap backdrop
    $('#searchBtn').addEventListener('click', () => (S.searchOpen ? closeSearch() : openSearch()));
    $('#guideBtn').addEventListener('click', () => switchTab(S.tab === 'guide' ? 'now' : 'guide'));
    // Toolbar: mouse wheel scrolls sideways, and fades show when there's more to either side.
    const tb = $('#toolbar');
    const edges = () => {
      tb.classList.toggle('more-left', tb.scrollLeft > 4);
      tb.classList.toggle('more-right', tb.scrollLeft + tb.clientWidth < tb.scrollWidth - 4);
    };
    tb.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && tb.scrollWidth > tb.clientWidth) { tb.scrollLeft += e.deltaY; e.preventDefault(); }
    }, { passive: false });
    tb.addEventListener('scroll', edges, { passive: true });
    new MutationObserver(() => requestAnimationFrame(edges)).observe(tb, { childList: true });
    window.addEventListener('resize', edges);
    $('#whatNowBtn').addEventListener('click', openWhatNow);
    $('#searchClose').addEventListener('click', closeSearch);
    $('#searchInput').addEventListener('input', (e) => { S.q = e.target.value; renderView(); renderSearch(); });
    $('#searchInput').addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeSearch();
      if (e.key === 'Enter') e.target.blur(); // hide the phone keyboard, keep results
    });

    window.addEventListener('online', () => { S.online = true; renderStatus(); loadLive(S.park); });
    window.addEventListener('offline', () => { S.online = false; renderStatus(); });

    const stale = () => {
      const d = S.live[viewPark()];
      return !d || Date.now() / 1000 - d.meta.fetchedAt > 55;
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && S.boot?.authed && stale()) loadLive(viewPark(), { quiet: true });
    });
    setInterval(() => {
      if (!S.boot?.authed) return;
      checkLeaveAlerts();
      checkLastChance();
      if (document.visibilityState !== 'visible') {
        // In the background only poll for parks with alerts (browsers throttle this to ~1/min).
        for (const p of alertParks()) {
          const d = S.live[p];
          if (!d || Date.now() / 1000 - d.meta.fetchedAt > 55) loadLive(p, { quiet: true });
        }
        return;
      }
      if ((isLiveTab() || S.tab === 'mine') && stale()) loadLive(viewPark(), { quiet: true });
      else renderStatus(); // keep "updated x min ago" honest
      if (S.tab === 'shows' || S.tab === 'food') renderView(); // countdowns / open-now
      // Keep alert parks fresh even when looking at something else.
      for (const p of alertParks()) {
        const d = S.live[p];
        if (p !== viewPark() && (!d || Date.now() / 1000 - d.meta.fetchedAt > 90)) loadLive(p, { quiet: true });
      }
      if (S.tab === 'map') {
        for (const p of S.boot.parks) {
          const d = S.live[p.key];
          if (!d || Date.now() / 1000 - d.meta.fetchedAt > 60) loadLive(p.key, { quiet: true });
        }
      }
      if (!S.weather || Date.now() / 1000 - S.weather.fetchedAt > 1200) loadWeather();
      if (S.tab === 'trip' && S.boot.transit && (!S.transit || Date.now() / 1000 - S.transit.fetchedAt > 60)) loadTransit();
    }, 30000);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
      navigator.serviceWorker.addEventListener('message', (e) => {
        const m = e.data || {};
        if (m.type === 'open' && m.url) {
          const u = new URL(m.url);
          if (u.hash) { location.hash = u.hash; handleHash(); }
        } else if (m.type === 'prefetch-progress') {
          toast(m.done >= m.total ? `Offline map saved (${m.total} tiles)` : `Saving map… ${m.done}/${m.total}`);
        }
      });
    }
    window.addEventListener('hashchange', () => { if (S.boot?.authed) handleHash(); });

    start();
  });
})();
