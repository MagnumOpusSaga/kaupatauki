// Kaupat auki – selainpuoli: tila nyt (A), aikajana (B), alapalkin haku ja lähimmät (D). Ei evästeitä, ei seurantaa.
(function () {
  'use strict';
  const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Helsinki', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  function nowHel() { const p = fmt.format(new Date()).replace(',', ''); const [d, tm] = p.split(' '); return { d, m: +tm.slice(0, 2) * 60 + +tm.slice(3, 5) }; }
  const mins = s => +s.slice(0, 2) * 60 + +s.slice(3, 5);
  const tt = (s, close) => { if (close && s === '00:00') return '24'; const [h, m] = s.split(':'); return m === '00' ? String(+h) : `${+h}.${m}`; };
  const shift = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const ranges = v => v ? v.split(',').map(r => r.split('-')) : [];
  const WD = ['su', 'ma', 'ti', 'ke', 'to', 'pe', 'la'];
  // sama kuin build.mjs:n slugify
  const slugify = s => s.toLowerCase().replace(/[äå]/g, 'a').replace(/ö/g, 'o').normalize('NFKD').replace(/[^\w\s-]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const wd = d => WD[new Date(d + 'T12:00:00Z').getUTCDay()];

  // Tila: state open | soon | closed | unk; pill = iso sana; detail = loppu; short = listarivi
  function status(sched) {
    const { d, m } = nowHel();
    const mk = (state, pill, detail, short) => ({ state, pill, detail, short });
    const openUntil = (c, cm) => { const left = cm - m; return left <= 60 ? mk('soon', 'Sulkeutuu pian', `klo ${tt(c, 1)} (${left} min)`, `sulkeutuu ${left} min`) : mk('open', 'Auki', `sulkeutuu klo ${tt(c, 1)}`, `auki · ${tt(c, 1)} asti`); };
    for (const [o, c] of ranges(sched[shift(d, -1)])) if (mins(c) < mins(o) && m < mins(c)) return openUntil(c, mins(c));
    const today = sched[d];
    if (today === undefined) return mk('unk', 'Ei tietoa', 'tiedot päivitetään pian', 'ei tietoa');
    if (today === null) return mk('unk', 'Ei tietoa', 'aukioloaikaa ei ole julkaistu tälle päivälle', 'ei tietoa');
    for (const [o, c] of ranges(today)) {
      if (o === '?') return m < mins(c) ? mk('unk', 'Tänään', `auki klo ${tt(c, 1)} asti`, `klo ${tt(c, 1)} asti`) : mk('closed', 'Suljettu', '', 'suljettu');
      if (o === '00:00' && c === '24:00') return mk('open', 'Auki', 'ympäri vuorokauden', 'auki · 24 h');
      const cm = c === '24:00' || c === '00:00' ? 1440 : mins(c) <= mins(o) ? 1440 + mins(c) : mins(c);
      if (m >= mins(o) && m < cm) return openUntil(c, cm);
      if (m < mins(o)) return mk('closed', 'Suljettu', `aukeaa tänään klo ${tt(o)}`, `suljettu · aukeaa ${tt(o)}`);
    }
    for (let i = 1; i <= 6; i++) {
      const nd = shift(d, i), v = sched[nd];
      if (v === undefined || v === null) break;
      if (v) { const [o, c] = ranges(v)[0]; if (o === '?') return mk('closed', 'Suljettu', `${i === 1 ? 'huomenna' : wd(nd)} auki klo ${tt(c, 1)} asti`, `suljettu · ${i === 1 ? 'huom.' : wd(nd)} –${tt(c, 1)}`); return mk('closed', 'Suljettu', `aukeaa ${i === 1 ? 'huomenna' : wd(nd)} klo ${tt(o)}`, `suljettu · ${i === 1 ? 'huom.' : wd(nd)} ${tt(o)}`); }
    }
    return mk('closed', 'Suljettu', '', 'suljettu');
  }
  const setState = (el, st) => { el.classList.remove('open', 'soon', 'closed', 'unk'); el.classList.add(st); };

  // A: kauppasivun vastauskortti
  const art = document.querySelector('article.store');
  if (art) {
    const st = status(JSON.parse(art.dataset.s));
    const pill = document.getElementById('nowpill'), txt = document.getElementById('nowtxt');
    pill.textContent = st.pill; setState(pill, st.state); txt.textContent = st.detail;
    const { d } = nowHel();
    document.querySelectorAll('table.hours tr[data-d]').forEach(tr => tr.classList.toggle('today', tr.dataset.d === d));
  }

  // B: aikajanan rivit ja "nyt"-viiva
  function refreshRow(li) {
    if (li.dataset.fixed || !li.dataset.s) return;
    const st = status(JSON.parse(li.dataset.s)), hr = li.querySelector('.hr');
    setState(li, st.state); li.dataset.open = st.state === 'open' || st.state === 'soon' ? '1' : '0';
    if (hr) hr.textContent = st.short;
  }
  document.querySelectorAll('li.st').forEach(refreshRow);
  const { d: today, m: nowM } = nowHel();
  document.querySelectorAll('ul.tl-list[data-live]').forEach(ul => {
    const h = nowM / 60;
    if (ul.dataset.d === today && h >= 6) { ul.style.setProperty('--now', ((h - 6) / 18 * 100).toFixed(2) + '%'); ul.classList.add('live'); }
  });
  const only = document.getElementById('onlyopen');
  if (only) only.addEventListener('click', () => {
    const on = only.getAttribute('aria-pressed') !== 'true'; only.setAttribute('aria-pressed', String(on));
    document.querySelectorAll('#list li.st').forEach(li => { li.hidden = on && li.dataset.open !== '1'; });
    const pins = document.getElementById('map')?._pins; if (pins) pins.forEach((el, li) => { el.style.display = li.hidden ? 'none' : ''; });
  });
  // aktiivinen päivävälilehti näkyviin vaakavieritettävässä rivissä
  const tabs = document.querySelector('.tabs'), tabOn = tabs && tabs.querySelector('.tab.on');
  if (tabOn && tabs.scrollWidth > tabs.clientWidth) tabs.scrollLeft = tabOn.offsetLeft - tabs.offsetLeft - (tabs.clientWidth - tabOn.offsetWidth) / 2;

  function dist(a, b, c, d) { const k = Math.PI / 180, x = (d - b) * k * Math.cos((a + c) / 2 * k), y = (c - a) * k; return Math.sqrt(x * x + y * y) * 6371; }
  const km = d => d < 1 ? Math.round(d * 1000) + ' m' : d.toFixed(1).replace('.', ',') + ' km';
  function locate(cb) {
    if (!navigator.geolocation) return alertSheet('Selaimesi ei tue sijaintia.');
    navigator.geolocation.getCurrentPosition(p => cb(p.coords.latitude, p.coords.longitude), () => alertSheet('Sijaintia ei saatu. Salli sijainti selaimen asetuksista tai hae kauppaa nimellä.'), { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  }
  const sn = document.getElementById('sortnear');
  if (sn) sn.addEventListener('click', () => locate((la, lo) => {
    sn.setAttribute('aria-pressed', 'true');
    const ul = document.getElementById('list'), lis = [...ul.querySelectorAll('li.st')], adli = ul.querySelector('li.adli');
    lis.forEach(li => { li._d = dist(la, lo, +li.dataset.lat, +li.dataset.lon); const a = li.querySelector('.ad'); if (a && !a.dataset.k) { a.dataset.k = 1; a.textContent = km(li._d) + ' · ' + a.textContent; } });
    lis.sort((a, b) => a._d - b._d).forEach(li => ul.appendChild(li));
    if (adli && lis[11]) lis[11].after(adli);
  }));
  const cl = document.getElementById('consentlink');
  if (cl) cl.addEventListener('click', e => { e.preventDefault(); window.googlefc = window.googlefc || {}; (googlefc.callbackQueue = googlefc.callbackQueue || []).push({ 'CONSENT_API_READY': () => googlefc.showRevocationMessage() }); });

  // D: alapalkki – haku ja lähimmät paneeliin
  const sheet = document.getElementById('sheet'), res = document.getElementById('results'), title = document.getElementById('sheettitle'), q = document.getElementById('q');
  let data = null;
  async function load() { if (!data) { const r = await fetch('/data/stores.json'); data = (await r.json()).stores; } return data; }
  function openSheet(t) { title.textContent = t; sheet.hidden = false; }
  function alertSheet(t) { res.innerHTML = ''; openSheet(t); }
  function render(rows, la, lo) {
    res.innerHTML = '';
    if (!rows.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'Ei osumia. Kokeile kunnan tai ketjun nimeä.'; res.appendChild(li); return; }
    for (const [slug, name, kunta, lat, lon, street, sched, area] of rows) {
      const st = status(sched), li = document.createElement('li');
      li.className = 'st ' + st.state;
      li.innerHTML = '<a><span class="nm"></span><span class="hr"></span><span class="ad"></span></a>';
      li.querySelector('a').href = `/kauppa/${slug}/`;
      li.querySelector('.nm').textContent = name;
      const g = /^(Prisma|S-market|Sale|Alepa|ABC|Food Market Herkku)/.test(name) ? ['S', 's'] : /^K-/.test(name) ? ['K', 'k'] : /^Lidl/.test(name) ? ['L', 'l'] : /^Tokmanni/.test(name) ? ['T', 't'] : /^Alko/.test(name) ? ['A', 'a'] : /^M-/.test(name) ? ['M', 'm'] : /^Minimani/.test(name) ? ['Mi', 'mi'] : /^Halpa-Halli/.test(name) ? ['H', 'h'] : [(name.trim()[0] || '•').toUpperCase(), 'o'];
      const cb = document.createElement('b'); cb.className = 'cb cb-' + g[1]; cb.setAttribute('aria-hidden', 'true'); cb.dataset.t = g[0]; li.querySelector('.nm').prepend(cb);
      li.querySelector('.hr').textContent = st.short;
      li.querySelector('.ad').textContent = (la != null ? km(dist(la, lo, lat, lon)) + ' · ' : '') + [street, area && !area.includes(kunta) ? area : '', kunta].filter(Boolean).join(', ');
      res.appendChild(li);
    }
  }
  function nearMe() {
    openSheet('Haetaan sijaintia…'); res.innerHTML = '';
    locate(async (la, lo) => {
      const all = await load();
      const rows = all.map(r => [r, dist(la, lo, r[3], r[4])]).sort((a, b) => a[1] - b[1]).slice(0, 40).map(x => x[0]);
      const open = rows.filter(r => { const s = status(r[6]).state; return s === 'open' || s === 'soon'; });
      openSheet(`${open.length ? open.length : 'Ei'} auki olevaa kauppaa lähellä`);
      render([...open.slice(0, 15), ...rows.filter(r => !open.includes(r)).slice(0, 5)], la, lo);
    });
  }
  document.getElementById('nearme')?.addEventListener('click', nearMe);
  document.getElementById('nearbtn')?.addEventListener('click', nearMe);
  document.getElementById('sheetclose')?.addEventListener('click', () => { sheet.hidden = true; });
  if (q) {
    // Enter / Hae: kunnan nimi → kuntasivu, yksi osuma → kauppasivu, muuten tulokset auki
    const go = document.getElementById('qgo'), near = document.getElementById('nearme');
    const syncBtn = () => { const has = q.value.trim().length > 0; go.hidden = !has; near.hidden = has; };
    q.closest('form').addEventListener('submit', async e => {
      e.preventDefault();
      const v = q.value.trim().toLowerCase(); if (!v) return;
      const all = await load();
      const kunnat = [...new Set(all.map(r => r[2]))];
      const exact = kunnat.find(k => k.toLowerCase() === v || slugify(k) === slugify(v));
      const pref = kunnat.filter(k => k.toLowerCase().startsWith(v));
      if (exact || (pref.length === 1 && v.length >= 3)) { location.href = '/kaupat/' + slugify(exact || pref[0]) + '/'; return; }
      const links = res.querySelectorAll('li.st a, li.kunta a');
      if (links.length === 1) { location.href = links[0].href; return; }
      if (links.length) links[0].focus();
    });
    q.addEventListener('input', syncBtn); syncBtn();
    q.addEventListener('input', async () => {
      const v = q.value.trim().toLowerCase(); if (v.length < 2) { sheet.hidden = true; return; }
      const all = await load(), words = v.split(/\s+/);
      const score = r => { const n = r[1].toLowerCase(); return (words.every(w => n.includes(w)) ? 0 : 1) + (n.startsWith(words[0]) ? 0 : 0.5); };
      const hits = all.filter(r => { const h = (r[1] + ' ' + r[2] + ' ' + (r[5] || '') + ' ' + (r[7] || '')).toLowerCase(); return words.every(w => h.includes(w)); }).sort((a, b) => score(a) - score(b));
      // Kunnan nimi haussa → kuntasivu ensimmäiseksi riviksi
      const kc = {}; for (const r of all) if (!/^Alko /.test(r[1])) kc[r[2]] = (kc[r[2]] || 0) + 1;
      const kHits = v.length >= 3 ? Object.keys(kc).filter(k => k.toLowerCase().startsWith(v)).sort((a, b) => kc[b] - kc[a]).slice(0, 2) : [];
      openSheet(hits.length ? `${hits.length} kauppaa` : kHits.length ? 'Kunnat' : 'Ei osumia'); render(hits.slice(0, 30));
      if (kHits.length && res.firstChild?.classList.contains('empty')) res.innerHTML = '';
      kHits.reverse().forEach(k => {
        const li = document.createElement('li'); li.className = 'kunta';
        li.innerHTML = '<a><span class="nm"></span><span class="ad"></span></a>';
        li.querySelector('a').href = '/kaupat/' + slugify(k) + '/';
        li.querySelector('.nm').textContent = k + ' – kaikki kaupat →'; li.querySelector('.ad').textContent = kc[k] + ' ruokakauppaa, aukioloajat tänään ja pyhinä';
        res.prepend(li);
      });
    });
  }
  // Kartta: MapLibre + OpenFreeMap. Tietokoneella (≥1000 px) heti, puhelimella vasta "Näytä kartalla" -napista.
  // Merkit tulevat listasta (data-list): kauppasivulla "Lähellä tänään", kunta- ja juhlapyhäsivuilla koko lista.
  const mapEl = document.getElementById('map');
  let libP = null, mapObj = null;
  function loadLib() {
    if (!libP) libP = new Promise((res, rej) => {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/vendor/maplibre/maplibre-gl.css'; document.head.appendChild(css);
      const js = document.createElement('script'); js.src = '/vendor/maplibre/maplibre-gl.js'; js.async = true; js.onload = res; js.onerror = rej; document.head.appendChild(js);
    });
    return libP;
  }
  const touch = window.matchMedia('(hover: none)').matches;
  function pin(state, label, href, main) {
    const el = document.createElement(href ? 'a' : 'div');
    el.className = 'mpin ' + state + (main ? ' main' : ''); if (href) el.href = href;
    el.innerHTML = '<span class="dot"></span>' + (label ? '<span class="lb"></span>' : '');
    if (label) el.querySelector('.lb').textContent = label;
    return el;
  }
  function initMap() {
    if (mapEl._init) return; mapEl._init = 1; mapEl.hidden = false;
    loadLib().then(() => {
      const items = [...document.querySelectorAll('#' + (mapEl.dataset.list || 'near') + ' li.st')].filter(li => +li.dataset.lat);
      const c0 = art ? [+art.dataset.lon, +art.dataset.lat] : items.length ? [+items[0].dataset.lon, +items[0].dataset.lat] : [25.5, 62.5];
      const map = mapObj = new maplibregl.Map({ container: mapEl, style: 'https://tiles.openfreemap.org/styles/positron', center: c0, zoom: art ? 14.5 : 11, attributionControl: { compact: false }, cooperativeGestures: true });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      mapEl.querySelector('.maphint')?.remove();
      const bounds = new maplibregl.LngLatBounds(c0, c0);
      const pins = mapEl._pins = new Map();
      let armed = null; // kosketusnäytöllä 1. napautus näyttää nimen, 2. avaa kaupan
      items.forEach(li => {
        const la = +li.dataset.lat, lo = +li.dataset.lon;
        const st = ['open', 'soon', 'closed', 'unk'].find(c => li.classList.contains(c)) || 'unk';
        const nmEl = li.querySelector('.nm'), nm = nmEl.lastChild ? nmEl.lastChild.textContent : nmEl.textContent; // ketjumerkki ei mukaan
        const label = nm + ' · ' + li.querySelector('.hr').textContent;
        const el = pin(st, label, li.querySelector('a').getAttribute('href'));
        el.setAttribute('aria-label', label);
        const on = () => { el.classList.add('hl'); li.classList.add('hl'); }, off = () => { el.classList.remove('hl'); li.classList.remove('hl'); };
        el.addEventListener('mouseenter', on); el.addEventListener('mouseleave', off);
        li.addEventListener('mouseenter', on); li.addEventListener('mouseleave', off);
        if (touch) el.addEventListener('click', e => { if (armed !== el) { e.preventDefault(); if (armed) armed.classList.remove('hl'); armed = el; el.classList.add('hl'); } });
        new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([lo, la]).addTo(map);
        bounds.extend([lo, la]); pins.set(li, el);
        if (li.hidden) el.style.display = 'none';
      });
      if (art) {
        const st = status(JSON.parse(art.dataset.s));
        new maplibregl.Marker({ element: pin(st.state, art.dataset.name + ' · ' + st.short, '', true), anchor: 'bottom' }).setLngLat(c0).addTo(map);
      }
      // Kuntasivulla rajaus kauppojen ydinalueeseen (5.–95. persentiili), jotta muutama syrjäinen kauppa ei loitonna karttaa
      let fit = bounds;
      if (!art && items.length > 12) {
        const q = (arr, p) => arr[Math.min(arr.length - 1, Math.max(0, Math.round(p * (arr.length - 1))))];
        const las = items.map(li => +li.dataset.lat).sort((a, b) => a - b), los = items.map(li => +li.dataset.lon).sort((a, b) => a - b);
        fit = new maplibregl.LngLatBounds([q(los, .05), q(las, .05)], [q(los, .95), q(las, .95)]);
      }
      if (pins.size) map.fitBounds(fit, { padding: art ? { top: 70, bottom: 30, left: 40, right: 50 } : 40, maxZoom: art ? 15.5 : 14, duration: 0 });
    }).catch(() => { mapEl.hidden = true; document.querySelectorAll('.mapbtn').forEach(b => { b.hidden = true; }); });
  }
  if (mapEl) {
    if (window.matchMedia('(min-width:1000px)').matches) initMap();
    document.querySelectorAll('.mapbtn').forEach(b => b.addEventListener('click', () => {
      if (!mapEl._init) initMap(); else { mapEl.hidden = !mapEl.hidden; if (mapObj && !mapEl.hidden) mapObj.resize(); }
      b.setAttribute('aria-expanded', String(!mapEl.hidden));
      b.querySelector('span').textContent = mapEl.hidden ? 'Näytä kartalla' : 'Piilota kartta';
      if (!mapEl.hidden) mapEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }));
  }
})();
