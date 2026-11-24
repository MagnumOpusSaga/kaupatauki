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
      if (o === '00:00' && c === '24:00') return mk('open', 'Auki', 'ympäri vuorokauden', 'auki · 24 h');
      const cm = c === '24:00' || c === '00:00' ? 1440 : mins(c) <= mins(o) ? 1440 + mins(c) : mins(c);
      if (m >= mins(o) && m < cm) return openUntil(c, cm);
      if (m < mins(o)) return mk('closed', 'Suljettu', `aukeaa tänään klo ${tt(o)}`, `suljettu · aukeaa ${tt(o)}`);
    }
    for (let i = 1; i <= 6; i++) {
      const nd = shift(d, i), v = sched[nd];
      if (v === undefined || v === null) break;
      if (v) { const o = ranges(v)[0][0]; return mk('closed', 'Suljettu', `aukeaa ${i === 1 ? 'huomenna' : wd(nd)} klo ${tt(o)}`, `suljettu · ${i === 1 ? 'huom.' : wd(nd)} ${tt(o)}`); }
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
  });

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
    for (const [slug, name, kunta, lat, lon, street, sched] of rows) {
      const st = status(sched), li = document.createElement('li');
      li.className = 'st ' + st.state;
      li.innerHTML = '<a><span class="nm"></span><span class="hr"></span><span class="ad"></span></a>';
      li.querySelector('a').href = `/kauppa/${slug}/`;
      li.querySelector('.nm').textContent = name;
      li.querySelector('.hr').textContent = st.short;
      li.querySelector('.ad').textContent = (la != null ? km(dist(la, lo, lat, lon)) + ' · ' : '') + [street, kunta].filter(Boolean).join(', ');
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
    q.closest('form').addEventListener('submit', e => e.preventDefault());
    q.addEventListener('input', async () => {
      const v = q.value.trim().toLowerCase(); if (v.length < 2) { sheet.hidden = true; return; }
      const all = await load(), words = v.split(/\s+/);
      const score = r => { const n = r[1].toLowerCase(); return (words.every(w => n.includes(w)) ? 0 : 1) + (n.startsWith(words[0]) ? 0 : 0.5); };
      const hits = all.filter(r => { const h = (r[1] + ' ' + r[2] + ' ' + (r[5] || '')).toLowerCase(); return words.every(w => h.includes(w)); }).sort((a, b) => score(a) - score(b));
      openSheet(hits.length ? `${hits.length} kauppaa` : 'Ei osumia'); render(hits.slice(0, 30));
    });
  }
})();
