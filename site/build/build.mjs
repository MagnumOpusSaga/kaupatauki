// Kaupat auki – staattisen sivuston rakennus.
// node build/build.mjs <stores.json> <dist> [YYYY-MM-DD]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { upcoming, iso, add } from './holidays.mjs';
const require = createRequire(import.meta.url);
const OH = require('opening_hours');
process.env.TZ = 'Europe/Helsinki';

const [, , STORES, DIST, TODAY_ARG] = process.argv;
const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const SITE = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.json'), 'utf8'));
const helsinkiToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Helsinki' }).format(new Date());
const TODAY = TODAY_ARG || helsinkiToday();
const DAYS_AHEAD = 28;
const HOL = upcoming(TODAY);
const HOL_BY_DATE = Object.fromEntries(HOL.map(h => [h.iso, h]));
const allStores = JSON.parse(fs.readFileSync(STORES, 'utf8'));
// Ruokakauppalistat ja -tilastot ilman Alkoa; Alkolla omat sivut (/ketju/alko/, /alko/<pyhä>/)
const stores = allStores.filter(s => s.chain !== 'Alko');
const alkos = allStores.filter(s => s.chain === 'Alko');

// ---------- apurit ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slugify = s => s.toLowerCase().replace(/[äå]/g, 'a').replace(/ö/g, 'o').normalize('NFKD').replace(/[^\w\s-]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const WD = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'];
const WD_FI = ['ma', 'ti', 'ke', 'to', 'pe', 'la', 'su'];
const WD_FI_LONG = ['maanantai', 'tiistai', 'keskiviikko', 'torstai', 'perjantai', 'lauantai', 'sunnuntai'];
const wdOf = isoDate => (new Date(isoDate + 'T12:00:00Z').getUTCDay() + 6) % 7;
const fiDate = isoDate => { const [y, m, d] = isoDate.split('-'); return `${+d}.${+m}.`; };
const fiDateY = isoDate => { const [y, m, d] = isoDate.split('-'); return `${+d}.${+m}.${y}`; };
const t = s => { const [h, m] = s.split(':'); return m === '00' ? String(+h) : `${+h}.${m}`; };
const fmtR = r => r.map(([o, c]) => (o === '00:00' && c === '24:00') ? 'ympäri vuorokauden' : `${t(o)}–${c === '00:00' ? '24' : t(c)}`).join(', ');
const dates = []; for (let i = 0; i < DAYS_AHEAD; i++) dates.push(iso(add(new Date(TODAY + 'T00:00:00Z'), i)));
const allDates = [...new Set([...dates, ...HOL.map(h => h.iso)])].sort();

// ---------- aikataulu jokaiselle kaupalle ----------
// k: x = virallinen poikkeusaika, w = virallinen normaali aika, o = OpenStreetMap, u = ei tietoa / ei vielä julkaistu
function hm(d) { return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
function osmDay(o, date) {
  const a = new Date(date + 'T00:00:00'), b = new Date(a.getTime() + 86400000);
  return o.getOpenIntervals(a, b).map(([s, e]) => [hm(s), e.getTime() >= b.getTime() ? '24:00' : hm(e)]);
}
let ohErrors = 0;
for (const s of allStores) {
  const exc = Object.fromEntries((s.exceptions || []).map(e => [e.date, e]));
  let o = null;
  if (s.oh) { try { o = new OH(s.oh, { lat: s.lat, lon: s.lon, address: { country_code: 'fi', state: '' } }, { mode: 0 }); } catch { ohErrors++; } }
  s.sched = {};
  for (const d of allDates) {
    const hol = HOL_BY_DATE[d];
    if (exc[d]) {
      const e = exc[d];
      if (e.level === 'u') s.sched[d] = { k: 'u', note: e.note };
      else if (e.text) s.sched[d] = { k: 'x', r: [], text: e.text, close: e.close, note: e.note };
      else s.sched[d] = { k: 'x', r: e.r, note: e.note };
      continue;
    }
    if (s.src.official) {
      // Juhlapyhänä näytetään vahvistettuna vain kaupan merkitsemä poikkeusaika; muu tieto vihjeenä
      if (hol) { s.sched[d] = { k: 'u', hint: s.days?.[d], hintSrc: s.src.name }; continue; }
      if (s.days && s.days[d]) { s.sched[d] = { k: 'w', r: s.days[d] }; continue; }
      const w = s.week?.[WD[wdOf(d)]];
      s.sched[d] = w ? { k: 'w', r: w } : { k: 'u' };
    } else {
      if (!o) { s.sched[d] = { k: 'u' }; continue; }
      const r = osmDay(o, d);
      if (hol) {
        // OSM:n pyhäpäiväsäännöt eivät ole kaupan vahvistamia → näytetään vain vihjeenä
        s.sched[d] = { k: 'u', hint: /PH|Dec|Jan|Jun|Apr|May|Mar/.test(s.oh) ? r : undefined };
      } else s.sched[d] = { k: 'o', r };
    }
  }
}

// ---------- ryhmittely ----------
const byKunta = {}; for (const s of stores) (byKunta[s.kunta] ||= []).push(s);
const kunnat = Object.keys(byKunta).sort((a, b) => a.localeCompare(b, 'fi'));
const CHAIN_ORDER = ['Prisma', 'K-Citymarket', 'S-market', 'K-Supermarket', 'Lidl', 'K-Market', 'Sale', 'Alepa', 'Food Market Herkku', 'Tokmanni', 'Halpa-Halli', 'Minimani', 'M-ketju', 'Eurospar', 'ABC', 'Lähikauppa', 'Muu ruokakauppa', 'Alko'];
const chains = {}; for (const s of allStores) (chains[s.chain] ||= []).push(s);
const chainSlug = c => slugify(c);
const CHAIN_INFO = {
  'Prisma': { group: 'S-ryhmä', site: 'https://www.s-kaupat.fi/myymalat', flyer: null },
  'S-market': { group: 'S-ryhmä', site: 'https://www.s-kaupat.fi/myymalat', flyer: null },
  'Sale': { group: 'S-ryhmä', site: 'https://www.s-kaupat.fi/myymalat', flyer: null },
  'Alepa': { group: 'S-ryhmä', site: 'https://www.s-kaupat.fi/myymalat', flyer: null },
  'Food Market Herkku': { group: 'S-ryhmä', site: 'https://www.s-kaupat.fi/myymalat', flyer: null },
  'ABC': { group: 'S-ryhmä', site: 'https://www.s-kaupat.fi/myymalat', flyer: null },
  'K-Citymarket': { group: 'K-ryhmä', site: 'https://www.k-ruoka.fi/kauppa', flyer: 'https://www.k-ruoka.fi/tarjouslehdet' },
  'K-Supermarket': { group: 'K-ryhmä', site: 'https://www.k-ruoka.fi/kauppa', flyer: 'https://www.k-ruoka.fi/tarjouslehdet' },
  'K-Market': { group: 'K-ryhmä', site: 'https://www.k-ruoka.fi/kauppa', flyer: 'https://www.k-ruoka.fi/tarjouslehdet' },
  'Lidl': { group: 'Lidl', site: 'https://www.lidl.fi/s/fi-FI/myymaelaet/', flyer: 'https://www.lidl.fi/c/tarjouslehdet/s10019134' },
  'Tokmanni': { group: 'Tokmanni', site: 'https://www.tokmanni.fi/stores', flyer: 'https://www.tokmanni.fi/tarjouslehti' },
  'Minimani': { group: 'Minimani', site: 'https://www.minimani.fi/', flyer: 'https://www.minimani.fi/lehti-ilmoitukset-mainoslehti' },
  'M-ketju': { group: 'M-ketju', site: 'https://www.m-ketju.fi/', flyer: 'https://www.m-ketju.fi/tarjoukset' },
  'Halpa-Halli': { group: 'Halpa-Halli', site: 'https://www.halpahalli.fi/', flyer: null },
  'Alko': { group: 'Alko', site: 'https://www.alko.fi/myymalat-palvelut', flyer: null },
};
const chainList = Object.keys(chains).sort((a, b) => (CHAIN_ORDER.indexOf(a) + 1 || 99) - (CHAIN_ORDER.indexOf(b) + 1 || 99));
const sortStores = arr => arr.slice().sort((a, b) => ((CHAIN_ORDER.indexOf(a.chain) + 1 || 99) - (CHAIN_ORDER.indexOf(b.chain) + 1 || 99)) || a.name.localeCompare(b.name, 'fi'));

// ---------- HTML-runko ----------
const url = p => SITE.origin + p;
const BUILD_STAMP = fiDateY(TODAY);
// ---------- AdSense: kytketään päälle site.json "adsEnabled": true (vasta hyväksynnän jälkeen) ----------
const ADS = !!(SITE.adsEnabled && SITE.adsenseClient);
const AD_SLOTS = SITE.adSlots || {};
const adUnit = (slot, cls = 'adbox') => ADS && slot ? `<aside class="${cls}" aria-label="Mainos"><span class="adlabel">Mainos</span><ins class="adsbygoogle" style="display:block" data-ad-client="${esc(SITE.adsenseClient)}" data-ad-slot="${esc(slot)}" data-ad-format="auto" data-full-width-responsive="true"></ins><script>(adsbygoogle=window.adsbygoogle||[]).push({});</script></aside>` : '';
function layout({ title, desc, canonical, body, jsonld = [], extraHead = '', ads = true }) {
  const robots = SITE.preview ? '<meta name="robots" content="noindex,nofollow">' : '';
  return `<!doctype html><html lang="fi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">${robots}
<link rel="canonical" href="${esc(url(canonical))}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(url(canonical))}"><meta property="og:type" content="website"><meta property="og:locale" content="fi_FI"><meta property="og:image" content="${url('/og.png')}">
<link rel="icon" href="/favicon.ico" sizes="48x48"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="icon" href="/icon-96.png" type="image/png" sizes="96x96"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#0b7a4b">
<link rel="stylesheet" href="/style.css?v=${SITE.version}">${SITE.bingVerify ? `<meta name="msvalidate.01" content="${esc(SITE.bingVerify)}">` : ''}${SITE.adsenseClient ? `<meta name="google-adsense-account" content="${esc(SITE.adsenseClient)}">` : ''}${ADS && ads ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${esc(SITE.adsenseClient)}" crossorigin="anonymous"></script>` : ''}
${jsonld.map(j => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('')}${extraHead}
</head><body>
${SITE.preview ? '<div class="preview">Esikatselu – sivusto ei ole vielä julkinen eikä hakukoneissa.</div>' : ''}
<header class="top"><a class="logo" href="/"><img src="/favicon.svg" alt="" width="28" height="28">Kaupat auki</a>
<nav><a href="/auki/${HOL.find(h => h.top)?.slug || HOL[0].slug}/">${esc(HOL.find(h => h.top)?.name || HOL[0].name)}</a><a href="/tarjouslehdet/">Tarjouslehdet</a><a href="/kaupungit/">Kaupungit</a></nav></header>
<main>${body}${ads ? adUnit(AD_SLOTS.below) : ''}</main>
<div class="dock"><div class="sheet" id="sheet" hidden><div class="sheethead"><b id="sheettitle">Tulokset</b><button type="button" id="sheetclose" class="x" aria-label="Sulje tulokset">${ICON.x}</button></div><ul class="list" id="results"></ul></div>
<form class="bar" role="search" action="/kaupungit/"><label class="srch">${ICON.search}<input id="q" type="search" name="q" placeholder="Hae kauppaa tai kuntaa" autocomplete="off" aria-label="Hae kauppaa tai kuntaa"></label><button type="button" id="nearme" class="loc" aria-label="Näytä lähimmät auki olevat kaupat">${ICON.nav}</button></form></div>
<footer><p><b>Kaupat auki</b> kokoaa ruokakauppojen aukioloajat ja juhlapyhien poikkeusajat ketjujen virallisista lähteistä. Palvelu ei ole kauppaketjujen virallinen palvelu – tarkista kiireellinen tieto kaupalta.</p>
<p>Lähteet: S-kaupat.fi, Lidl.fi, Tokmanni.fi sekä © <a href="https://www.openstreetmap.org/copyright">OpenStreetMapin tekijät</a> (ODbL). Kuntarajat © Tilastokeskus (CC BY 4.0). Päivitetty ${BUILD_STAMP}.</p>
<p><a href="/tietoa/">Tietoa ja lähteet</a> · <a href="/tietosuoja/">Tietosuoja</a>${ADS ? ' · <a href="#" id="consentlink">Evästeasetukset</a>' : ''} · ${esc(SITE.email)}</p>
<p>© ${TODAY.slice(0, 4)} ${esc(SITE.owner)}</p></footer>
<script src="/app.js?v=${SITE.version}" defer></script></body></html>`;
}
const crumbs = items => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map(([n, p], i) => ({ '@type': 'ListItem', position: i + 1, name: n, item: url(p) })) });
const crumbHtml = items => `<nav class="crumbs">${items.map(([n, p], i) => i < items.length - 1 ? `<a href="${p}">${esc(n)}</a>` : `<span>${esc(n)}</span>`).join(' › ')}</nav>`;

// kompakti aikataulu selaimelle: "YYYY-MM-DD": "07:00-22:00,..." | "" (suljettu) | null (ei tietoa)
function compact(s, ds) { const o = {}; for (const d of ds) { const v = s.sched[d]; o[d] = v.k === 'u' ? null : v.r.map(r => r.join('-')).join(','); } return o; }
const next7 = dates.slice(0, 8);
function dayText(v) {
  if (!v || v.k === 'u') return v?.hint !== undefined ? 'ei vahvistettu' : 'ei tietoa';
  if (v.text) return v.text;
  return v.r.length ? fmtR(v.r) : 'suljettu';
}
const isOpenV = v => !!v && v.k !== 'u' && (!!v.text || v.r.length > 0);
const closeOf = v => v?.text ? (v.close || '') : v?.r?.length ? v.r[v.r.length - 1][1] : '';
const svgI = (d, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  x: svgI('<path d="M18 6L6 18M6 6l12 12"/>'), search: svgI('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
  nav: svgI('<path d="M3 11l18-8-8 18-2-8-8-2z"/>'), cal: svgI('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  chev: svgI('<path d="M9 6l6 6-6 6"/>'), shield: svgI('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>'),
  paper: svgI('<path d="M6 3h9l5 5v13H6z"/><path d="M14 3v6h6M9 13h7M9 17h5"/>'),
};
// Aikajana (B): akseli klo 6–24
const AX0 = 6, AX1 = 24;
const toH = t => +t.slice(0, 2) + +t.slice(3, 5) / 60;
const pct = h => +(((Math.min(Math.max(h, AX0), AX1) - AX0) / (AX1 - AX0)) * 100).toFixed(2);
function bars(r) {
  return r.map(([o, c]) => {
    let a = toH(o), b = toH(c);
    if (o === '00:00' && c === '24:00') { a = AX0; b = AX1; } else if (b <= a) b = 24;
    if (Math.min(b, AX1) <= Math.max(a, AX0)) return '';
    return `<i style="left:${pct(a)}%;width:${(pct(b) - pct(a)).toFixed(2)}%"></i>`;
  }).join('');
}
const TICKS = [6, 9, 12, 15, 18, 21, 24];
const tlHead = label => `<div class="tlhead"><span>${esc(label)}</span><div class="ticks" aria-hidden="true">${TICKS.map(h => `<b style="left:${pct(h)}%">${h}</b>`).join('')}</div></div>`;
function storeRow(s, date, opts = {}) {
  const v = s.sched[date];
  const cls = !v || v.k === 'u' ? 'unk' : isOpenV(v) ? 'open' : 'closed';
  const sd = JSON.stringify(compact(s, opts.holiday ? [date] : next7));
  const txt = esc(dayText(v)) + (v?.k === 'x' ? (opts.holiday ? ' <em>vahvistettu</em>' : ' <em>poikkeusaika</em>') : '');
  return `<li class="st tl ${cls}" data-s='${esc(sd)}' data-lat="${s.lat.toFixed(5)}" data-lon="${s.lon.toFixed(5)}"${opts.holiday ? ' data-fixed="1"' : ''}>
<a href="/kauppa/${s.slug}/"><span class="nm">${esc(s.name)}</span><span class="hr">${txt}</span><span class="ad">${esc([s.street, s.postname].filter(Boolean).join(', '))}</span></a>
<div class="track${cls === 'unk' ? ' none' : ''}" aria-hidden="true">${v && v.k !== 'u' ? bars(v.r) : ''}</div></li>`;
}
const tlList = (arr, date, opts = {}) => `${tlHead(opts.label || 'Järjestys: auki pisimpään')}<ul class="list tl-list" id="${opts.id || 'list'}" data-d="${date}"${opts.holiday ? '' : ' data-live="1"'}>${arr.map((s, i) => storeRow(s, date, opts) + (opts.ad && i === 11 && arr.length > 20 ? adUnit(AD_SLOTS.list, 'adbox adli').replace(/^<aside/, '<li').replace(/<\/aside>$/, '</li>') : '')).join('')}</ul>`;

// ---------- sivut ----------
const pages = []; // {path, html}
const put = (p, html) => pages.push({ p, html });

const alkoByKunta = {}; for (const s of alkos) (alkoByKunta[s.kunta] ||= []).push(s);
const alkoStrip = (k, d, hol) => {
  const arr = alkoByKunta[k]; if (!arr) return '';
  const vs = arr.map(s => s.sched[d]).filter(v => v && v.k !== 'u');
  const c = {}; for (const v of vs) c[dayText(v)] = (c[dayText(v)] || 0) + 1;
  const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
  const txt = hol ? (top ? `${top[0]}${top[1] < arr.length ? ` (${top[1]}/${arr.length})` : ''}` : 'ei vielä tietoa') : `${arr.length} myymälää`;
  return `<a class="strip" href="${hol ? `/alko/${hol.slug}/#${slugify(k)}` : `/ketju/alko/#${slugify(k)}`}">${ICON.cal}<span><b>Alko${hol ? ' ' + esc(hol.when) : ''}</b> · ${esc(txt)}</span>${ICON.chev}</a>`;
};

// Kauppasivut
for (const s of allStores) {
  const chainP = `/ketju/${chainSlug(s.chain)}/`;
  const kP = `/kaupat/${slugify(s.kunta)}/`;
  const week = dates.slice(0, 7).map(d => {
    const v = s.sched[d];
    return `<tr data-d="${d}"${d === TODAY ? ' class="today"' : ''}><th>${WD_FI_LONG[wdOf(d)]} ${fiDate(d)}${HOL_BY_DATE[d] ? ` (${esc(HOL_BY_DATE[d].name.toLowerCase())})` : ''}</th><td>${esc(dayText(v))}${v.hint ? ` <small>(${esc(v.hintSrc || 'OpenStreetMap')} näyttää nyt: ${esc(v.hint.length ? fmtR(v.hint) : 'suljettu')})</small>` : ''}${v.k === 'x' ? ' <em>poikkeusaika</em>' : ''}${v.note ? ` <small>${esc(v.note)}</small>` : ''}</td></tr>`;
  }).join('');
  const holRows = HOL.slice(0, 9).map(h => {
    const v = s.sched[h.iso];
    let txt;
    if (v.k === 'u') {
      txt = s.src.official ? 'ei vielä julkaistu' : 'ei vahvistettua tietoa';
      if (v.hint) txt += ` <small>(${esc(v.hintSrc || 'OpenStreetMap')} näyttää nyt: ${esc(v.hint.length ? fmtR(v.hint) : 'suljettu')})</small>`;
      if (v.note) txt += ` <small>${esc(v.note)}</small>`;
    } else txt = esc(dayText(v)) + (v.k === 'x' ? ' <em>vahvistettu</em>' : '') + (v.note ? ` <small>${esc(v.note)}</small>` : '');
    return `<tr><th><a href="/auki/${h.slug}/${slugify(s.kunta)}/">${esc(h.name)}</a> ${WD_FI[wdOf(h.iso)]} ${fiDate(h.iso)}</th><td>${txt}</td></tr>`;
  }).join('');
  const near = (s.chain === 'Alko' ? alkos : stores).filter(o => o !== s && o.kunta === s.kunta).map(o => [o, (o.lat - s.lat) ** 2 + ((o.lon - s.lon) * Math.cos(s.lat * Math.PI / 180)) ** 2]).sort((a, b) => a[1] - b[1]).slice(0, 6).map(x => x[0]);
  const flyer = s.flyer ? `<a class="btn" href="${esc(s.flyer.url)}" rel="noopener" target="_blank">${s.flyer.kind === 'store-offers' ? 'Kaupan tarjoukset (S-kaupat.fi)' : s.flyer.kind === 'store' ? 'Tämän kaupan tarjouslehti (k-ruoka.fi)' : `${esc(s.chain)}-tarjouslehti`} ↗</a>` : '';
  const srcTxt = s.src.official
    ? `Lähde: <a href="${esc(s.src.url)}" rel="noopener">${esc(s.src.name)}</a> (kaupan virallinen sivu), haettu ${fiDateY(s.src.fetched)}.`
    : `Lähde: <a href="${esc(s.src.url)}" rel="noopener">OpenStreetMap</a>, haettu ${fiDateY(s.src.fetched)}${s.src.checked ? `, tieto tarkistettu ${esc(s.src.checked)}` : ''}. Tieto ei tule ketjulta – tarkista kaupan omalta sivulta${s.url ? `: <a href="${esc(s.url)}" rel="noopener">${esc(s.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 50))}</a>` : ''}.`;
  const ld = { '@context': 'https://schema.org', '@type': 'GroceryStore', name: s.name, url: url(`/kauppa/${s.slug}/`),
    address: { '@type': 'PostalAddress', streetAddress: s.street, postalCode: s.postcode, addressLocality: s.postname || s.kunta, addressCountry: 'FI' },
    geo: { '@type': 'GeoCoordinates', latitude: s.lat, longitude: s.lon } };
  if (s.src.official && s.week) {
    ld.openingHoursSpecification = WD.flatMap((w, i) => (s.week[w] || []).map(([o, c]) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: 'https://schema.org/' + ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][i], opens: o, closes: c === '24:00' ? '23:59' : c })));
    const sp = (s.exceptions || []).filter(e => e.date >= TODAY && Array.isArray(e.r) && e.level !== 'u').map(e => e.r.length ? e.r.map(([o, c]) => ({ '@type': 'OpeningHoursSpecification', validFrom: e.date, validThrough: e.date, opens: o, closes: c === '24:00' ? '23:59' : c })) : [{ '@type': 'OpeningHoursSpecification', validFrom: e.date, validThrough: e.date, opens: '00:00', closes: '00:00' }]).flat();
    if (sp.length) ld.specialOpeningHoursSpecification = sp;
  }
  const cr = [['Kaupat auki', '/'], [s.kunta, kP], [s.name, `/kauppa/${s.slug}/`]];
  const nextHol = HOL[0];
  const sh = HOL.find(h => h.top) || HOL[0], shv = s.sched[sh.iso];
  const shTxt = shv.k !== 'u' ? `${dayText(shv)} · vahvistettu` : (s.src.official ? (sh.slug.match(/joulu|tapani|uudenvuoden/) ? 'ajat julkaistaan yleensä joulukuun alussa' : 'ei vielä julkaistu') : 'ei vahvistettua tietoa');
  const holStrip = `<a class="strip" href="${s.chain === 'Alko' ? `/alko/${sh.slug}/#${slugify(s.kunta)}` : `/auki/${sh.slug}/${slugify(s.kunta)}/`}">${ICON.cal}<span><b>${esc(sh.name)} ${WD_FI[wdOf(sh.iso)]} ${fiDate(sh.iso)}</b> · ${esc(shTxt)}</span>${ICON.chev}</a>`;
  put(`/kauppa/${s.slug}/`, layout({
    title: `${s.name} aukioloajat${s.kunta && !s.name.includes(s.kunta) ? ' ' + s.kunta : ''} | Kaupat auki`,
    desc: `${s.name}, ${[s.street, s.postname].filter(Boolean).join(', ')}: aukioloajat tänään, juhlapyhien poikkeusajat (${nextHol.name.toLowerCase()} ${fiDate(nextHol.iso)})${s.flyer ? ' ja linkki tarjouslehteen' : ''}.`,
    canonical: `/kauppa/${s.slug}/`, jsonld: [ld, crumbs(cr)],
    body: `${crumbHtml(cr)}<article class="store" data-s='${esc(JSON.stringify(compact(s, dates)))}'>
<section class="answer">
<span class="eyebrow"><a href="${chainP}">${esc(s.chain)}</a> · ${esc(s.kunta)}</span>
<h1>${esc(s.name)}</h1><p class="addr">${esc([s.street, [s.postcode, s.postname].filter(Boolean).join(' ')].filter(Boolean).join(', '))}</p>
<div class="statusline"><span class="pill big unk" id="nowpill">Tänään</span><span class="nowtxt" id="nowtxt">${esc(dayText(s.sched[TODAY]))}</span></div>
<p class="trust">${ICON.shield}${s.chain === 'Alko' ? 'Pyhäpäivät: Alkon tiedotteet · arkiajat: OpenStreetMap' : s.src.official ? `Lähde ${esc(s.src.name)} · haettu ${fiDateY(s.src.fetched)}` : 'OpenStreetMap · ei kaupan vahvistama'}</p>
<div class="acts2"><a class="btn" href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}" rel="noopener" target="_blank">${ICON.nav}Reitti</a>${s.flyer ? `<a class="btn ghost" href="${esc(s.flyer.url)}" rel="noopener" target="_blank" title="${s.flyer.kind === 'store-offers' ? 'Kaupan tarjoukset S-kaupat.fi:ssä' : s.flyer.kind === 'store' ? 'Tämän kaupan tarjouslehti k-ruoka.fi:ssä' : esc(s.chain) + '-tarjouslehti'}">${ICON.paper}${s.flyer.kind === 'store-offers' ? 'Tarjoukset' : 'Tarjouslehti'}</a>` : s.chain === 'Alko' && s.url ? `<a class="btn ghost" href="${esc(s.url)}" rel="noopener" target="_blank">${ICON.paper}Alko.fi</a>` : `<a class="btn ghost" href="#viikko">${ICON.cal}Viikon ajat</a>`}</div>
</section>
${holStrip}
<h2 id="viikko">Aukioloajat tällä viikolla</h2><table class="hours">${week}</table>
<h2>Juhlapyhät ja poikkeusajat</h2><table class="hours hol">${holRows}</table>
<p class="note">${s.chain === 'Alko' ? `Juhlapyhien ajat ovat Alkon itse tiedottamia (${(s.facts || []).map(f => `<a href="${esc(f.url)}" rel="noopener">${esc(f.name)}</a>`).join(', ')}). Myymäläkohtaiset arkiaukioloajat ovat OpenStreetMapista eivätkä Alkon vahvistamia – tarkista ne Alkon sivulta.` : s.src.official ? 'Poikkeusajat näytetään heti, kun kauppa julkaisee ne. Joulun ajat julkaistaan yleensä joulukuun alussa.' : 'Tälle kaupalle ei ole vielä virallista tietolähdettä.'}</p>
<p class="src">${srcTxt}</p>
${near.length ? `<h2>Lähellä tänään</h2>${tlList(near, TODAY, { id: 'near' })}` : ''}
</article>`
  }));
}

// Kuntasivut
for (const k of kunnat) {
  const ks = slugify(k), arr = holSort(byKunta[k], TODAY);
  const cr = [['Kaupat auki', '/'], [k, `/kaupat/${ks}/`]];
  const chainsHere = [...new Set(arr.map(s => s.chain))];
  put(`/kaupat/${ks}/`, layout({
    title: `Kaupat auki tänään – ${k} | Kaupungin ruokakaupat ja aukioloajat`,
    desc: `${k}: ${arr.length} ruokakauppaa (${chainsHere.slice(0, 5).join(', ')}). Mitkä kaupat ovat auki nyt, aukioloajat tänään ja juhlapyhinä.`,
    canonical: `/kaupat/${ks}/`, jsonld: [crumbs(cr)],
    body: `${crumbHtml(cr)}<h1>Kaupat auki tänään – ${esc(k)}</h1>
<p class="lead">${arr.length} ruokakauppaa. Palkki näyttää aukiolon klo 6–24, sininen viiva on kellonaika nyt.</p>
<div class="tabs"><span class="tab on">Tänään ${WD_FI[wdOf(TODAY)]} ${fiDate(TODAY)}</span>${HOL.slice(0, 5).map(h => `<a class="tab" href="/auki/${h.slug}/${ks}/">${esc(h.name)} ${fiDate(h.iso)}</a>`).join('')}</div>
<div class="chips"><button type="button" class="chip" id="onlyopen" aria-pressed="false">Vain auki nyt</button><button type="button" class="chip" id="sortnear" aria-pressed="false">Lähimmät ensin</button></div>
${alkoStrip(k, TODAY, null)}
${tlList(arr, TODAY, { ad: true })}`
  }));
}
// Kaupunkiluettelo
put('/kaupungit/', layout({
  title: 'Kaupat kunnittain – aukioloajat | Kaupat auki', desc: `Ruokakauppojen aukioloajat kaikissa ${kunnat.length} kunnassa.`, canonical: '/kaupungit/',
  body: `<h1>Kaupat kunnittain</h1><ul class="cols">${kunnat.map(k => `<li><a href="/kaupat/${slugify(k)}/">${esc(k)}</a> <small>${byKunta[k].length}</small></li>`).join('')}</ul>`
}));

// Juhlapyhäsivut
const BIG = kunnat.slice().sort((a, b) => byKunta[b].length - byKunta[a].length).slice(0, 24);
function holStats(arr, d) {
  let open = 0, closed = 0, unk = 0;
  for (const s of arr) { const v = s.sched[d]; if (v.k === 'u') unk++; else if (isOpenV(v)) open++; else closed++; }
  return { open, closed, unk };
}
function holSort(arr, d) {
  const rank = s => { const v = s.sched[d]; return v.k === 'u' ? 2 : isOpenV(v) ? 0 : 1; };
  const close = s => closeOf(s.sched[d]);
  return sortStores(arr).sort((a, b) => rank(a) - rank(b) || close(b).localeCompare(close(a)));
}
for (const h of HOL) {
  const d = h.iso, wd = WD_FI_LONG[wdOf(d)];
  const st = holStats(stores, d);
  const published = st.open + st.closed;
  const statusTxt = published === 0
    ? `Kaupat eivät ole vielä julkaisseet tämän päivän aukioloaikoja. Päivitämme sivun heti, kun ketjut julkaisevat ne${h.slug.includes('joulu') || h.slug.includes('tapani') || h.slug.includes('uudenvuoden') ? ' – yleensä joulukuun alussa' : ''}.`
    : `Aukioloaika on julkaistu ${published} kaupalle ${stores.length}:stä (${st.open} auki, ${st.closed} suljettu).`;
  const cr = [['Kaupat auki', '/'], [`${h.name} ${h.year}`, `/auki/${h.slug}/`]];
  const chainRows = chainList.filter(c => chains[c].length >= 3).map(c => {
    const s2 = holStats(chains[c], d);
    const sample = chains[c].map(s => s.sched[d]).filter(v => v.k !== 'u');
    const common = sample.length ? Object.entries(sample.reduce((m, v) => (m[dayText(v)] = (m[dayText(v)] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1])[0][0] : null;
    return `<tr><th><a href="${c === 'Alko' ? `/alko/${h.slug}/` : `/ketju/${chainSlug(c)}/`}">${esc(c)}</a></th><td>${common ? `yleisimmin ${esc(common)} <small>(${sample.length}/${chains[c].length} kauppaa julkaissut)</small>` : 'ei vielä julkaistu'}</td></tr>`;
  }).join('');
  put(`/auki/${h.slug}/`, layout({
    title: `Kaupat auki ${h.when} ${h.year} (${wd} ${fiDate(d)}) – aukioloajat | Kaupat auki`,
    desc: `Mitkä kaupat ovat auki ${h.when} ${fiDateY(d)}? Prisman, K-Citymarketin, Lidlin, S-marketin ja K-Marketin aukioloajat kunnittain virallisista lähteistä.`,
    canonical: `/auki/${h.slug}/`, jsonld: [crumbs(cr)],
    body: `${crumbHtml(cr)}<h1>Kaupat auki ${esc(h.when)} ${h.year}</h1>
<p class="lead">${esc(h.name)} on ${wd} ${fiDateY(d)}. ${esc(statusTxt)}</p>
<h2>Valitse kunta</h2><div class="hols big">${BIG.map(k => `<a href="/auki/${h.slug}/${slugify(k)}/">${esc(k)}</a>`).join('')}<a href="#kaikki">Kaikki kunnat ↓</a></div>
<h2>Ketjut ${esc(h.when)}</h2><table class="hours">${chainRows}</table>
<h2 id="kaikki">Kaikki kunnat</h2><ul class="cols">${kunnat.map(k => `<li><a href="/auki/${h.slug}/${slugify(k)}/">${esc(k)}</a></li>`).join('')}</ul>
<h2>Muut juhlapyhät</h2><div class="hols">${HOL.filter(x => x !== h).map(x => `<a href="/auki/${x.slug}/">${esc(x.name)} ${fiDate(x.iso)}</a>`).join('')}</div>`
  }));
  for (const k of kunnat) {
    const ks = slugify(k), arr = holSort(byKunta[k], d), s3 = holStats(arr, d);
    const cr2 = [['Kaupat auki', '/'], [`${h.name} ${h.year}`, `/auki/${h.slug}/`], [k, `/auki/${h.slug}/${ks}/`]];
    const pub = s3.open + s3.closed;
    put(`/auki/${h.slug}/${ks}/`, layout({
      title: `Kaupat auki ${h.when} – ${k} ${h.year} | Kaupat auki`,
      desc: `${k}: mitkä kaupat ovat auki ${h.when} ${fiDateY(d)}? ${arr.length} ruokakaupan aukioloajat${pub ? ` – ${s3.open} kauppaa auki` : ''}. Päivittyy, kun kaupat julkaisevat poikkeusajat.`,
      canonical: `/auki/${h.slug}/${ks}/`, jsonld: [crumbs(cr2)],
      body: `${crumbHtml(cr2)}<h1>Kaupat auki ${esc(h.when)} – ${esc(k)}</h1>
<p class="lead">${esc(h.name)} ${wd} ${fiDateY(d)}. ${pub ? `${s3.open} kauppaa auki, ${s3.closed} suljettu, ${s3.unk} ei vielä tietoa.` : `Kaupat eivät ole vielä julkaisseet tämän päivän aukioloaikoja. Sivu päivittyy automaattisesti, kun tieto julkaistaan.`}</p>
<div class="tabs"><a class="tab" href="/kaupat/${ks}/">Tänään</a>${HOL.slice(0, 5).map(x => x === h ? `<span class="tab on">${esc(x.name)} ${fiDate(x.iso)}</span>` : `<a class="tab" href="/auki/${x.slug}/${ks}/">${esc(x.name)} ${fiDate(x.iso)}</a>`).join('')}</div>
${alkoStrip(k, d, h)}
${tlList(arr, d, { holiday: true, ad: true, label: `${h.name} ${fiDate(d)} · auki pisimpään ensin` })}
<p class="note">Näytämme vain kauppojen itse julkaisemat poikkeusajat. "Ei tietoa" tarkoittaa, ettei kauppa ole vielä julkaissut aikaa tai sille ei ole virallista lähdettä.</p>
<div class="hols"><a href="/kaupat/${ks}/">${esc(k)}: aukioloajat tänään</a>${HOL.filter(x => x !== h).slice(0, 6).map(x => `<a href="/auki/${x.slug}/${ks}/">${esc(x.name)}</a>`).join('')}</div>`
    }));
  }
}

// Alko-sivut: /alko/<pyhä>/ – Alkon tiedottamat pyhäajat kaikille myymälöille
const alkoSummary = d => {
  const c = {}; for (const s of alkos) { const v = s.sched[d]; if (v.k !== 'u') { const t = dayText(v); c[t] = (c[t] || 0) + 1; } }
  return Object.entries(c).sort((a, b) => b[1] - a[1]);
};
const ALKO_FACTS = (() => { const m = new Map(); for (const s of alkos) for (const f of s.facts || []) m.set(f.url, f); return [...m.values()]; })();
const alkoNote = d => { const n = alkos.map(s => s.sched[d]?.note).find(Boolean); return n || ''; };
for (const h of HOL) {
  if (!alkos.length) break;
  const d = h.iso, wd = WD_FI_LONG[wdOf(d)], sum = alkoSummary(d), st = holStats(alkos, d);
  const head = sum.length
    ? (sum.length === 1 && sum[0][1] === alkos.length ? `Kaikki Alkot: ${sum[0][0]}.` : sum.map(([t, n]) => `${n} myymälää: ${t}`).join(' · ') + (st.unk ? ` · ${st.unk}: ei vahvistettua tietoa` : ''))
    : 'Alko ei ole vielä tiedottanut tämän päivän aukioloista.';
  const cr = [['Kaupat auki', '/'], ['Alko', '/ketju/alko/'], [`${h.name} ${h.year}`, `/alko/${h.slug}/`]];
  const ks = Object.keys(alkoByKunta).sort((a, b) => a.localeCompare(b, 'fi'));
  put(`/alko/${h.slug}/`, layout({
    title: `Alko auki ${h.when} ${h.year} (${WD_FI[wdOf(d)]} ${fiDate(d)}) – aukioloajat | Kaupat auki`,
    desc: `Onko Alko auki ${h.when} ${fiDateY(d)}? ${head} Kaikki ${alkos.length} Alkoa kunnittain.`.slice(0, 300),
    canonical: `/alko/${h.slug}/`, jsonld: [crumbs(cr)],
    body: `${crumbHtml(cr)}<h1>Alko auki ${esc(h.when)} ${h.year}</h1>
<section class="answer"><span class="eyebrow">${esc(h.name)} · ${wd} ${fiDateY(d)}</span><p class="big-ans">${esc(head)}</p>
<p class="trust">${ICON.shield}${alkoNote(d) ? `Lähde: ${esc(alkoNote(d))}` : 'Ei vielä Alkon tiedotetta'}</p></section>
<div class="hols">${ks.filter(k => BIG.includes(k)).map(k => `<a href="#${slugify(k)}">${esc(k)}</a>`).join('')}</div>
${ks.map(k => `<h3 id="${slugify(k)}"><a href="/auki/${h.slug}/${slugify(k)}/">${esc(k)}</a></h3>${tlList(holSort(alkoByKunta[k], d), d, { holiday: true, id: 'a-' + slugify(k), label: `${h.name} ${fiDate(d)}` })}`).join('')}
<p class="note">Pyhäpäivien ajat perustuvat Alkon omiin tiedotteisiin: ${ALKO_FACTS.map(f => `<a href="${esc(f.url)}" rel="noopener">${esc(f.name)}</a>`).join(', ')}. Myymäläkohtaiset arkiajat ovat OpenStreetMapista. Tarkista oman myymäläsi aika aina myös Alkon sivulta.</p>
<h2>Alko muina pyhinä</h2><div class="hols">${HOL.filter(x => x !== h).slice(0, 8).map(x => `<a href="/alko/${x.slug}/">${esc(x.name)} ${fiDate(x.iso)}</a>`).join('')}</div>`
  }));
}
// Ketjusivut + tarjouslehtisivut
for (const c of chainList) {
  const cs = chainSlug(c), arr = chains[c], info = CHAIN_INFO[c] || {};
  const per = {}; for (const s of arr) (per[s.kunta] ||= []).push(s);
  const cr = [['Kaupat auki', '/'], [c, `/ketju/${cs}/`]];
  const official = arr.filter(s => s.src.official).length;
  put(`/ketju/${cs}/`, layout({
    title: `${c} aukioloajat – kaikki ${arr.length} kauppaa | Kaupat auki`,
    desc: `${c}: aukioloajat tänään ja juhlapyhinä kaikissa ${arr.length} kaupassa${info.flyer ? ' sekä linkki tämän viikon tarjouslehteen' : ''}.`,
    canonical: `/ketju/${cs}/`, jsonld: [crumbs(cr)],
    body: `${crumbHtml(cr)}<h1>${esc(c)} aukioloajat</h1>
<p class="lead">${arr.length} kauppaa ${Object.keys(per).length} kunnassa.${official ? '' : ' Tiedot OpenStreetMapista – virallinen lähde puuttuu vielä.'}</p>
<div class="acts">${info.flyer ? `<a class="btn" href="${esc(info.flyer)}" rel="noopener" target="_blank">${esc(c)}-tarjouslehti ↗</a>` : ''}${info.site ? `<a class="btn ghost" href="${esc(info.site)}" rel="noopener" target="_blank">Ketjun myymälähaku ↗</a>` : ''}</div>
<div class="hols">${HOL.slice(0, 6).map(h => `<a href="${c === 'Alko' ? '/alko' : '/auki'}/${h.slug}/">${c === 'Alko' ? 'Alko ' + esc(h.when) : esc(h.name)} ${fiDate(h.iso)}</a>`).join('')}</div>
${Object.keys(per).sort((a, b) => a.localeCompare(b, 'fi')).map(k => `<h3 id="${slugify(k)}"><a href="/kaupat/${slugify(k)}/">${esc(k)}</a></h3>${tlList(holSort(per[k], TODAY), TODAY, { id: 'c-' + slugify(k) })}`).join('')}`
  }));
}
const FLYER_CHAINS = [
  ['K-Citymarket, K-Supermarket ja K-Market', 'k-ryhma', 'https://www.k-ruoka.fi/tarjouslehdet', 'Jokaisella K-ruokakaupalla on oma tarjouslehti. Kauppasivuillamme on suora linkki kaupan omaan lehteen.', ['K-Citymarket', 'K-Supermarket', 'K-Market']],
  ['Lidl', 'lidl', 'https://www.lidl.fi/c/tarjouslehdet/s10019134', 'Lidlillä on yksi valtakunnallinen tarjouslehti.', ['Lidl']],
  ['Tokmanni', 'tokmanni', 'https://www.tokmanni.fi/tarjouslehti', 'Tokmannin tarjouslehti on sama kaikissa myymälöissä.', ['Tokmanni']],
  ['Minimani', 'minimani', 'https://www.minimani.fi/lehti-ilmoitukset-mainoslehti', 'Minimanin lehti-ilmoitukset ja mainoslehti.', ['Minimani']],
  ['M-ketju', 'm-ketju', 'https://www.m-ketju.fi/tarjoukset', 'M-ketjun kauppojen tarjoukset.', ['M-ketju']],
  ['Prisma, S-market, Sale ja Alepa', 's-ryhma', 'https://www.s-kaupat.fi/myymalat', 'S-ryhmä ei julkaise verkossa kauppakohtaista tarjouslehteä. Kaupan tarjoukset näkyvät kaupan S-kaupat-sivulla, ja alueosuuskaupat ilmoittavat tarjouksista paikallislehdissä.', ['Prisma', 'S-market', 'Sale', 'Alepa']],
];
put('/tarjouslehdet/', layout({
  title: 'Tarjouslehdet tällä viikolla – K-ruoka, Lidl, Tokmanni | Kaupat auki',
  desc: 'Linkit ruokakauppojen tämän viikon virallisiin tarjouslehtiin: K-Citymarket, K-Supermarket, K-Market, Lidl, Tokmanni, Minimani, M-ketju ja S-ryhmän kauppojen tarjoukset.',
  canonical: '/tarjouslehdet/',
  body: `<h1>Tarjouslehdet tällä viikolla</h1><p class="lead">Linkit kauppojen virallisiin tarjouslehtiin. Emme kopioi lehtien sisältöä – lehti avautuu aina kaupan omalle sivulle.</p>
${FLYER_CHAINS.map(([n, sl, u, txt]) => `<section class="card"><h2><a href="/tarjouslehti/${sl}/">${esc(n)}</a></h2><p>${esc(txt)}</p><a class="btn" href="${esc(u)}" rel="noopener" target="_blank">Avaa tarjouslehti ↗</a></section>`).join('')}`
}));
for (const [n, sl, u, txt, cl] of FLYER_CHAINS) {
  const arr = sortStores(cl.flatMap(c => chains[c] || []));
  const withStore = arr.filter(s => s.flyer && s.flyer.kind !== 'chain');
  const cr = [['Kaupat auki', '/'], ['Tarjouslehdet', '/tarjouslehdet/'], [n, `/tarjouslehti/${sl}/`]];
  put(`/tarjouslehti/${sl}/`, layout({
    title: `${n.split(',')[0]} tarjouslehti tällä viikolla | Kaupat auki`,
    desc: `${n}: linkki tämän viikon viralliseen tarjouslehteen${withStore.length ? ` – ${withStore.length} kaupan oma lehti` : ''}. Myös kauppojen aukioloajat.`,
    canonical: `/tarjouslehti/${sl}/`, jsonld: [crumbs(cr)],
    body: `${crumbHtml(cr)}<h1>${esc(n)} – tarjouslehti tällä viikolla</h1><p class="lead">${esc(txt)}</p>
<a class="btn" href="${esc(u)}" rel="noopener" target="_blank">Avaa virallinen tarjouslehti ↗</a>
${withStore.length ? `<h2>Kauppakohtaiset lehdet</h2><ul class="list">${withStore.map(s => `<li class="st"><a href="${esc(s.flyer.url)}" rel="noopener" target="_blank"><span class="nm">${esc(s.name)} ↗</span><span class="ad">${esc(s.kunta)}</span></a><span class="hr"><a href="/kauppa/${s.slug}/">aukioloajat</a></span></li>`).join('')}</ul>` : ''}`
  }));
}

// Etusivu
const topHol = HOL.find(h => h.top) || HOL[0];
put('/', layout({
  title: 'Kaupat auki – mitkä kaupat ovat auki nyt? Aukioloajat ja tarjouslehdet',
  desc: `Kaikkien Suomen ruokakauppojen aukioloajat tänään, juhlapyhien poikkeusajat (${topHol.name.toLowerCase()} ${fiDate(topHol.iso)}) ja linkit tämän viikon tarjouslehtiin.`,
  canonical: '/', jsonld: [{ '@context': 'https://schema.org', '@type': 'WebSite', name: 'Kaupat auki', alternateName: 'kaupatauki.fi', url: url('/') }, { '@context': 'https://schema.org', '@type': 'Organization', name: 'Kaupat auki', url: url('/'), logo: url('/logo.png'), email: SITE.email }],
  body: `<section class="hero"><h1>Mitkä kaupat ovat auki nyt?</h1>
<p>${stores.length.toLocaleString('fi')} ruokakaupan aukioloajat ja juhlapyhien poikkeusajat.</p>
<button type="button" class="btn big" id="nearbtn">${ICON.nav}Näytä lähimmät auki olevat kaupat</button>
<p class="hint">Tai hae kauppaa tai kuntaa alareunan hakukentästä.</p></section>
<h2>Juhlapyhät</h2><div class="hols big">${HOL.slice(0, 8).map(h => `<a href="/auki/${h.slug}/">${esc(h.name)} <small>${WD_FI[wdOf(h.iso)]} ${fiDate(h.iso)}</small></a>`).join('')}</div>
<p><a href="/alko/${topHol.slug}/">Alko ${esc(topHol.when)} – kaikkien Alkojen aukioloajat →</a></p>
<h2>Suurimmat kaupungit</h2><div class="hols">${BIG.slice(0, 16).map(k => `<a href="/kaupat/${slugify(k)}/">${esc(k)}</a>`).join('')}<a href="/kaupungit/">Kaikki kunnat →</a></div>
<h2>Ketjut</h2><div class="hols">${chainList.filter(c => chains[c].length >= 3 && !['Lähikauppa', 'Muu ruokakauppa'].includes(c)).map(c => `<a href="/ketju/${chainSlug(c)}/">${esc(c)} <small>${chains[c].length}</small></a>`).join('')}</div>
<h2>Tarjouslehdet</h2><p><a href="/tarjouslehdet/">Tämän viikon tarjouslehdet: K-ruoka, Lidl, Tokmanni ja muut →</a></p>`
}));

// Tietoa + tietosuoja
const srcCount = g => stores.filter(s => s.group === g).length;
put('/tietoa/', layout({ ads: false,
  title: 'Tietoa ja lähteet | Kaupat auki', desc: 'Mistä Kaupat auki -palvelun tiedot tulevat ja miten ne päivittyvät.', canonical: '/tietoa/',
  body: `<h1>Tietoa ja lähteet</h1>
<p>Kaupat auki kokoaa ruokakauppojen aukioloajat yhteen paikkaan. Keräämme vain tosiasiat – kaupan nimen, osoitteen, sijainnin ja aukioloajat – ja näytämme jokaisella sivulla lähteen ja hakupäivän. Tarjouslehtien sisältöä emme kopioi: linkki vie aina kaupan omaan, viralliseen lehteen.</p>
<table class="hours"><tr><th>S-ryhmä (Prisma, S-market, Sale, Alepa, Herkku, ABC)</th><td>S-kaupat.fi:n myymäläsivut – ${srcCount('S-ryhmä')} kauppaa</td></tr>
<tr><th>Lidl</th><td>Lidl.fi:n myymäläsivut – ${srcCount('Lidl')} kauppaa</td></tr>
<tr><th>Tokmanni</th><td>Tokmanni.fi:n myymälähaku – ${srcCount('Tokmanni')} kauppaa</td></tr>
<tr><th>Alko</th><td>Juhlapyhien ja viikonlopun ajat Alkon omista tiedotteista (${ALKO_FACTS.map(f => `<a href="${esc(f.url)}" rel="noopener">${esc(f.name)}</a>`).join(', ')}); myymälät ja arkiajat OpenStreetMapista – ${alkos.length} myymälää</td></tr>
<tr><th>K-ryhmä, M-ketju, Minimani, Halpa-Halli, lähikaupat</th><td>OpenStreetMap (© OpenStreetMapin tekijät, ODbL) – ${stores.filter(s => !s.src.official).length} kauppaa. Näille haemme virallista lähdettä.</td></tr></table>
<p>Juhlapyhien poikkeusajat näytetään vain silloin, kun kauppa on ne itse julkaissut. Jos tietoa ei vielä ole, kerromme sen – emme arvaa.</p>
<p>Kunnat: Tilastokeskuksen kuntarajat (CC BY 4.0). Koneluettava kauppadata (/data/) sisältää OpenStreetMapista johdettua tietoa ja on saatavilla ODbL-lisenssillä.</p>
<p>Palaute ja korjaukset: ${esc(SITE.email)}</p>`
}));
put('/tietosuoja/', layout({
  title: 'Tietosuojaseloste | Kaupat auki', desc: 'Kaupat auki -palvelun tietosuojaseloste.', canonical: '/tietosuoja/', ads: false,
  body: `<h1>Tietosuojaseloste</h1><p>Päivitetty ${esc(SITE.privacyUpdated)}.</p>
<h2>Rekisterinpitäjä</h2><p>${esc(SITE.owner)}, Y-tunnus ${esc(SITE.businessId)}. Yhteydenotot: ${esc(SITE.email)}.</p>
<h2>Mitä tietoja käsittelemme</h2>${ADS ? `<p>Palvelussa ei ole kirjautumista. Emme kerää nimiä, sähköpostiosoitteita emmekä IP-osoitteita omaan käyttöömme.</p>
<p><b>Mainokset ja evästeet:</b> palvelun kulut katetaan Google AdSense -mainoksilla. Google ja sen kumppanit voivat käyttää evästeitä ja laitetunnisteita mainosten näyttämiseen, mittaamiseen ja – suostumuksellasi – mainosten kohdentamiseen. Suostumus kysytään Googlen sertifioidulla suostumusikkunalla (IAB TCF) ensimmäisellä käynnillä; voit kieltäytyä, jolloin näytetään vain rajoitettuja, ei-personoituja mainoksia. Voit muuttaa valintaasi milloin tahansa sivun alareunan linkistä "Evästeasetukset". Lisätietoja: <a href="https://policies.google.com/technologies/partner-sites?hl=fi" rel="noopener">Miten Google käyttää tietoja kumppanisivustoilla</a>.</p>` : `<p>Palvelu ei käytä evästeitä, kirjautumista eikä mainosseurantaa. Emme kerää nimiä, sähköpostiosoitteita emmekä IP-osoitteita omaan käyttöömme.</p>`}
<p><b>Kävijätilastot:</b> käytämme Cloudflare Web Analyticsia, joka laskee sivujen latauksia ja sivun latausnopeutta ilman evästeitä ja ilman yksittäisen kävijän tunnistamista tai seurantaa sivustolta toiselle. Näemme vain koostetut luvut (esim. sivulataukset, maa, selain).</p>
<p><b>Sijainti:</b> jos painat "Näytä lähimmät", selain kysyy luvan sijaintiisi. Sijainti käsitellään vain laitteellasi lähimpien kauppojen järjestämiseen, eikä sitä lähetetä meille.</p>
<p><b>Palvelin:</b> sivusto toimii Cloudflaren palvelussa (Cloudflare, Inc.), joka käsittelee teknisiä lokitietoja (esim. IP-osoite) palvelun toimittamiseksi ja suojaamiseksi Cloudflaren omien ehtojen mukaisesti.</p>
<p><b>Ulkoiset linkit:</b> tarjouslehti- ja kauppalinkit avautuvat kauppojen omille sivuille, joiden tietosuojasta vastaavat kaupat itse. Reittilinkki avaa Google Mapsin.</p>
<h2>Oikeutesi</h2><p>Voit kysyä meiltä käsittelystä osoitteessa ${esc(SITE.email)}. Sinulla on oikeus tehdä valitus tietosuojavaltuutetulle (tietosuoja.fi).</p>`
}));
put('/404.html', layout({ ads: false, title: 'Sivua ei löytynyt | Kaupat auki', desc: 'Sivua ei löytynyt.', canonical: '/404.html', body: '<h1>Sivua ei löytynyt</h1><p><a href="/">Etusivulle</a> tai <a href="/kaupungit/">kunnat</a>.</p>' }));

// ---------- kirjoitus ----------
fs.rmSync(DIST, { recursive: true, force: true });
for (const { p, html } of pages) {
  const f = p.endsWith('.html') ? path.join(DIST, p) : path.join(DIST, p, 'index.html');
  fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, html);
}
fs.cpSync(path.join(ROOT, 'static'), DIST, { recursive: true });
fs.mkdirSync(path.join(DIST, 'data'), { recursive: true });
fs.writeFileSync(path.join(DIST, 'data/stores.json'), JSON.stringify({
  license: 'Sisältää OpenStreetMap-tietoa © OpenStreetMapin tekijät, ODbL 1.0. Lähteet: S-kaupat.fi, Lidl.fi, Tokmanni.fi, Alkon tiedotteet.', built: TODAY,
  stores: allStores.map(s => [s.slug, s.name, s.kunta, +s.lat.toFixed(5), +s.lon.toFixed(5), s.street, compact(s, next7)])
}));
const sitemapUrls = pages.filter(x => !x.p.endsWith('.html')).map(x => x.p);
const chunks = []; for (let i = 0; i < sitemapUrls.length; i += 40000) chunks.push(sitemapUrls.slice(i, i + 40000));
chunks.forEach((c, i) => fs.writeFileSync(path.join(DIST, `sitemap-${i + 1}.xml`), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${c.map(p => `<url><loc>${url(p)}</loc><lastmod>${TODAY}</lastmod></url>`).join('')}</urlset>`));
fs.writeFileSync(path.join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${chunks.map((_, i) => `<sitemap><loc>${url(`/sitemap-${i + 1}.xml`)}</loc><lastmod>${TODAY}</lastmod></sitemap>`).join('')}</sitemapindex>`);
if (SITE.adsenseClient) fs.writeFileSync(path.join(DIST, 'ads.txt'), `google.com, ${SITE.adsenseClient.replace('ca-', '')}, DIRECT, f08c47fec0942fa0\n`);
fs.writeFileSync(path.join(DIST, 'robots.txt'), SITE.preview ? 'User-agent: *\nDisallow: /\n' : `User-agent: *\nAllow: /\n\nSitemap: ${url('/sitemap.xml')}\n`);
console.log(JSON.stringify({ today: TODAY, stores: stores.length, kunnat: kunnat.length, pages: pages.length, sitemap: sitemapUrls.length, ohErrors, holidays: HOL.slice(0, 4).map(h => h.slug + ' ' + h.iso) }));
