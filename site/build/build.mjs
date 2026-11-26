// Kaupat auki – staattisen sivuston rakennus.
// node build/build.mjs <stores.json> <dist> [YYYY-MM-DD]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
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
// Postinumeroalueiden nimet (Tilastokeskus, CC BY 4.0) → haku kaupunginosilla, esim. "lidl hervanta"
const AREAS = JSON.parse(fs.readFileSync(path.join(ROOT, 'build', 'postialueet.json'), 'utf8')).areas;
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
const XMAS_MD = { jouluaattona: '12-24', joulupaivana: '12-25', tapaninpaivana: '12-26', uudenvuodenaattona: '12-31', uudenvuodenpaivana: '01-01', loppiaisena: '01-06' };
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
  'K-Citymarket': { group: 'K-ryhmä', site: 'https://www.k-ruoka.fi/', flyer: 'https://kcm-lehdet.k-ruoka.fi/tarjouslehti' },
  'K-Supermarket': { group: 'K-ryhmä', site: 'https://www.k-ruoka.fi/', flyer: 'https://www.k-ruoka.fi/k-supermarket/tarjouslehti' },
  'K-Market': { group: 'K-ryhmä', site: 'https://www.k-ruoka.fi/', flyer: 'https://www.k-ruoka.fi/k-market/tarjouslehti' },
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
// Parkpenny kattaa nämä kaupungit (seuranta-agentti N16, 25.11.). city= tarvitaan, muuten Parkpenny avaa viimeksi käytetyn kaupungin.
const PARK_CITIES = new Set(['Helsinki', 'Tampere']);
const XMAS_NAV = ['11', '12'].includes(TODAY.slice(5, 7)) || TODAY.slice(5) <= '01-06';
function layout({ title, desc, canonical, body, jsonld = [], extraHead = '', ads = true, wide = false }) {
  const noindex = CUR.index === false; if (noindex) ads = false; // spämmisuoja: ei mainoksia sivulle ilman omaa dataa
  // K2-C mittaus: sivutyyppi ja onko pyhäaika vahvistettu (kauppa: tärkein tuleva pyhä; pyhäsivut: portin datakynnys)
  const pv = CUR.v ?? (/^(pyha|pyhaKunta|alkoPyha)$/.test(CUR.type || '') ? +(CUR.index !== false) : null);
  const robots = SITE.preview ? '<meta name="robots" content="noindex,nofollow">' : noindex ? '<meta name="robots" content="noindex,follow">' : '';
  return `<!doctype html><html lang="fi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">${robots}
<link rel="canonical" href="${esc(url(canonical))}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(url(canonical))}"><meta property="og:type" content="website"><meta property="og:locale" content="fi_FI"><meta property="og:image" content="${url('/og.png')}">
<link rel="icon" href="/favicon.ico" sizes="48x48"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="icon" href="/icon-96.png" type="image/png" sizes="96x96"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#0b7a4b">
<link rel="stylesheet" href="/style.css?v=${SITE.version}">${SITE.bingVerify ? `<meta name="msvalidate.01" content="${esc(SITE.bingVerify)}">` : ''}${SITE.adsenseClient ? `<meta name="google-adsense-account" content="${esc(SITE.adsenseClient)}">` : ''}${ADS && ads ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${esc(SITE.adsenseClient)}" crossorigin="anonymous"></script>` : ''}
${jsonld.map(j => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('')}${extraHead}
</head><body data-pt="${esc(CUR.type || 'sisalto')}"${pv != null ? ` data-v="${pv}"` : ''}>
${SITE.preview ? '<div class="preview">Esikatselu – sivusto ei ole vielä julkinen eikä hakukoneissa.</div>' : ''}
<header class="top"><a class="logo" href="/"><img src="/favicon.svg" alt="" width="28" height="28">Kaupat auki</a>
<nav>${XMAS_NAV ? `<a href="/joulu/" class="xm">${ICON.snow}Joulu</a>` : `<a href="/auki/${HOL.find(h => h.top)?.slug || HOL[0].slug}/">${esc(HOL.find(h => h.top)?.name || HOL[0].name)}</a>`}<a href="/tarjouslehdet/">Tarjouslehdet</a><a href="/kaupungit/">Kaupungit</a></nav></header>
<main${wide ? ' class="wide"' : ''}>${body}${ads ? adUnit(AD_SLOTS.below) : ''}</main>
<div class="dock"><div class="sheet" id="sheet" hidden><div class="sheethead"><b id="sheettitle">Tulokset</b><button type="button" id="sheetclose" class="x" aria-label="Sulje tulokset">${ICON.x}</button></div><ul class="list" id="results"></ul></div>
<form class="bar" role="search" action="/kaupungit/"><label class="srch">${ICON.search}<input id="q" type="search" name="q" placeholder="Hae kauppaa tai kuntaa" autocomplete="off" aria-label="Hae kauppaa tai kuntaa"></label><button type="submit" id="qgo" class="loc go" hidden>Hae</button><button type="button" id="nearme" class="loc" aria-label="Näytä lähimmät auki olevat kaupat" title="Lähimmät auki olevat kaupat">${ICON.nav}<span class="loctx">Lähellä</span></button></form></div>
<footer><p><b>Kaupat auki</b> kokoaa ruokakauppojen aukioloajat ja juhlapyhien poikkeusajat ketjujen virallisista lähteistä. Palvelu ei ole kauppaketjujen virallinen palvelu – tarkista kiireellinen tieto kaupalta.</p>
<p>Lähteet: S-kaupat.fi, Lidl.fi, Tokmanni.fi sekä © <a href="https://www.openstreetmap.org/copyright">OpenStreetMapin tekijät</a> (ODbL). Kuntarajat ja postinumeroalueet © Tilastokeskus (CC BY 4.0). Päivitetty ${BUILD_STAMP}.</p>
<p><a href="/tietoa/">Tietoa ja lähteet</a> · <a href="/aukiololaki/">Aukiololaki</a> · <a href="/tietosuoja/">Tietosuoja</a>${ADS ? ' · <a href="#" id="consentlink">Evästeasetukset</a>' : ''} · ${esc(SITE.email)}</p>
<p>© ${TODAY.slice(0, 4)} ${esc(SITE.owner)}</p></footer>
<script src="/app.js?v=${SITE.version}" defer></script></body></html>`;
}
const crumbs = items => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map(([n, p], i) => ({ '@type': 'ListItem', position: i + 1, name: n, item: url(p) })) });
const crumbHtml = items => `<nav class="crumbs">${items.map(([n, p], i) => i < items.length - 1 ? `<a href="${p}">${esc(n)}</a>` : `<span>${esc(n)}</span>`).join(' › ')}</nav>`;

// kompakti aikataulu selaimelle: "YYYY-MM-DD": "07:00-22:00,..." | "" (suljettu) | null (ei tietoa)
function compact(s, ds) { const o = {}; for (const d of ds) { const v = s.sched[d]; o[d] = v.k === 'u' ? null : v.text ? (v.close ? '?-' + v.close : null) : v.r.map(r => r.join('-')).join(','); } return o; }
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
  bell: svgI('<path d="M6 16V11a6 6 0 0112 0v5l2 2H4z"/><path d="M10 21h4"/>'),
  paper: svgI('<path d="M6 3h9l5 5v13H6z"/><path d="M14 3v6h6M9 13h7M9 17h5"/>'),
  info: svgI('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  map: svgI('<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>'),
  snow: svgI('<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7"/><path d="M9.5 3.5L12 6l2.5-2.5M9.5 20.5L12 18l2.5 2.5M3.6 10.4L6.8 9.3 5.9 6M18.1 18l-.9-3.3 3.2-1.1M3.6 13.6l3.2 1.1-.9 3.3M18.1 6l-.9 3.3 3.2 1.1"/>'),
};
// Ketjumerkki: ryhmän kirjain ja tunnusväri (ei logoja). S-ryhmä (myös ABC), K-ryhmä, Lidl, Tokmanni, Alko, M-ketju…
const CB_GROUP = c => /^(Prisma|S-market|Sale|Alepa|ABC|Food Market Herkku)$/.test(c) ? ['S', 's'] : /^K-/.test(c) ? ['K', 'k'] : c === 'Lidl' ? ['L', 'l'] : c === 'Tokmanni' ? ['T', 't'] : c === 'Alko' ? ['A', 'a'] : c === 'M-ketju' ? ['M', 'm'] : c === 'Minimani' ? ['Mi', 'mi'] : c === 'Halpa-Halli' ? ['H', 'h'] : null;
const chainBadge = s => { const g = CB_GROUP(s.chain); const [t, c] = g || [(s.name.trim()[0] || '•').toUpperCase(), 'o']; return `<b class="cb cb-${c}" data-t="${esc(t)}" aria-hidden="true"></b>`; };
// Kartta: puhelimella napautuksella, tietokoneella aina (app.js)
const mapBox = (list, tall) => `<div class="mapbox${tall ? ' tall' : ''}" id="map" data-list="${list}" hidden><p class="maphint">Kartta ladataan…</p></div>`;
const mapBtn = `<button type="button" class="chip mapbtn" aria-controls="map" aria-expanded="false">${ICON.map}<span>Näytä kartalla</span></button>`;
// K2-B paluukanava: selainilmoitus, kun kaupan jouluaatto julkaistaan (vain kaupat, joilla on virallinen lähde)
const XMAS_EVE = HOL.find(h => h.slug === 'jouluaattona');
const notifyBox = s => (s.src.official && s.chain !== 'Alko' && XMAS_NAV && XMAS_EVE && TODAY <= XMAS_EVE.iso && s.sched[XMAS_EVE.iso]?.k === 'u')
  ? `<div class="notify" data-slug="${esc(s.slug)}" data-k="${esc(SITE.vapidPublic || '')}" hidden><button type="button" class="btn ghost">${ICON.bell}<span>Ilmoita, kun jouluajat julkaistaan</span></button><small>Yksi selainilmoitus, kun ${esc(s.src.name)} julkaisee tämän kaupan jouluaaton ajan. Ei sähköpostia eikä kirjautumista.</small></div>` : '';
const isXmas = slug => XMAS_NAV && !!XMAS_MD[slug];
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
// Poikkeus, jossa tiedetään vain sulkemisaika ("auki klo 13 asti"): raidoitettu palkki akselin alusta sulkemiseen
const upto = c => { const b = c === '00:00' ? 24 : toH(c); return b > AX0 ? `<i class="upto" style="left:0;width:${pct(b)}%"></i>` : ''; };
const TICKS = [6, 9, 12, 15, 18, 21, 24];
const tlHead = label => `<div class="tlhead"><span>${esc(label)}</span><div class="ticks" aria-hidden="true">${TICKS.map(h => `<b style="left:${pct(h)}%">${h}</b>`).join('')}</div></div>`;
function storeRow(s, date, opts = {}) {
  const v = s.sched[date];
  const cls = !v || v.k === 'u' ? 'unk' : isOpenV(v) ? 'open' : 'closed';
  const sd = JSON.stringify(compact(s, opts.holiday ? [date] : next7));
  const txt = esc(dayText(v)) + (v?.k === 'x' ? (opts.holiday ? ' <em class="ok">vahvistettu</em>' : ' <em>poikkeusaika</em>') : '');
  return `<li class="st tl ${cls}" data-s='${esc(sd)}' data-lat="${s.lat.toFixed(5)}" data-lon="${s.lon.toFixed(5)}"${opts.holiday ? ' data-fixed="1"' : ''}>
<a href="/kauppa/${s.slug}/"><span class="nm">${chainBadge(s)}${esc(dispName(s))}</span><span class="hr">${txt}</span><span class="ad">${esc([s.street, s.postname].filter(Boolean).join(', '))}</span></a>
<div class="track${cls === 'unk' ? ' none' : ''}" aria-hidden="true">${v && v.k !== 'u' ? (v.text && v.close ? upto(v.close) : bars(v.r)) : ''}</div></li>`;
}
const dispName = s => (slugify(s.name).replace(/-/g, '') === slugify(s.chain).replace(/-/g, '') && s.street) ? `${s.name} ${s.street}` : s.name;
const tlList = (arr, date, opts = {}) => `${tlHead(opts.label || 'Järjestys: auki pisimpään')}<ul class="list tl-list" id="${opts.id || 'list'}" data-d="${date}"${opts.holiday ? '' : ' data-live="1"'}>${arr.map((s, i) => storeRow(s, date, opts) + (opts.ad && i === 11 && arr.length > 20 ? adUnit(AD_SLOTS.list, 'adbox adli').replace(/^<aside/, '<li').replace(/<\/aside>$/, '</li>') : '')).join('')}</ul>`;

// ---------- sivut ----------
const pages = []; // {path, html}
// ---------- Indeksointiportti (spämmisuoja, Branun pysyvä sääntö 25.11.2026, claude/kirjasto/10-spamsuoja.md) ----------
// Indeksiin ja sivukarttaan vain sivut, joilla on omaa dataa. Jokaisella sivutyypillä oma datakynnys.
// Kynnyksen alittava sivu on olemassa käyttäjille, mutta saa noindexin, ei ole sivukartassa eikä siinä ole mainoksia.
const GATE_RULES = {
  kauppa: 'kaupan aukioloajat tiedossa kaikille tavallisille päiville seuraavat 2 viikkoa (kauppa/ketju tai OpenStreetMap)',
  kunta: 'vähintään 3 ruokakauppaa, joiden aukioloajat tiedossa',
  pyha: 'vähintään 20 kauppaa tai Alkoa on julkaissut tämän päivän ajan',
  pyhaKunta: 'vähintään 3 kunnan ruokakauppaa on julkaissut tämän päivän ajan',
  alkoPyha: 'vähintään 20 Alkoa, joille Alko on julkaissut tämän päivän ajan',
  ketju: 'oikea ketju ja vähintään 5 kauppaa, joiden aukioloajat tiedossa',
  lehti: 'vähintään 20 kauppakohtaista tarjouslehtilinkkiä (muuten sama kuin /tarjouslehdet/)',
  sisalto: 'toimituksellinen sivu, jolla omaa sisältöä (etusivu, joulu, aukiololaki, kunnat, tarjouslehdet, tietoa, tietosuoja)',
};
const GATE = {}; const META = new Map();
const sig = x => createHash('sha1').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex').slice(0, 12);
let CUR = {}; // seuraavan put-kutsun portti: { index, sig, type }
const gateMeta = (type, ok, dataSig) => { const g = (GATE[type] ||= { index: 0, noindex: 0 }); g[ok ? 'index' : 'noindex']++; return (CUR = { index: !!ok, sig: dataSig, type }); };
const put = (p, html) => {
  pages.push({ p, html });
  META.set(p, { index: CUR.index !== false, type: CUR.type || 'sisalto', sig: CUR.sig || sig(html.split(BUILD_STAMP).join('')) });
  if (!CUR.type) { const g = (GATE.sisalto ||= { index: 0, noindex: 0 }); if (!p.endsWith('.html')) g.index++; }
  CUR = {};
};
// Omaa dataa: kaupan ajat tiedossa kaikille tavallisille (ei-pyhä) päiville seuraavat 14 päivää
const REG_DAYS = dates.slice(0, 14).filter(d => !HOL.some(h => h.iso === d));
const hasHours = s => REG_DAYS.every(d => s.sched[d] && s.sched[d].k !== 'u');
// Datan tunniste: muuttuu vain, kun kaupan tiedot muuttuvat (ei päivän vaihtuessa) → rehellinen lastmod
const storeSig = s => sig([s.name, s.street, s.postcode, s.week || null, s.oh || null, s.exceptions || [], s.flyer?.url || null, s.url || null]);
const daySig = (arr, d) => sig([d, arr.map(s => [s.slug, s.sched[d]?.k === 'u' ? null : s.sched[d]])]);
const NOT_CHAINS = new Set(['Lähikauppa', 'Muu ruokakauppa']);

const alkoByKunta = {}; for (const s of alkos) (alkoByKunta[s.kunta] ||= []).push(s);
const alkoStrip = (k, d, hol) => {
  const arr = alkoByKunta[k]; if (!arr) return '';
  const vs = arr.map(s => s.sched[d]).filter(v => v && v.k !== 'u');
  const c = {}; for (const v of vs) c[dayText(v)] = (c[dayText(v)] || 0) + 1;
  const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
  const txt = hol ? (top ? `${top[0]}${top[1] < arr.length ? ` (${top[1]}/${arr.length})` : ''}` : 'ei vielä tietoa') : `${arr.length} myymälää`;
  return `<a class="strip" href="${hol ? `/alko/${hol.slug}/#${slugify(k)}` : `/ketju/alko/#${slugify(k)}`}">${ICON.cal}<span><b>Alko${hol ? ' ' + esc(hol.when) : ''}</b> · ${esc(txt)}</span>${ICON.chev}</a>`;
};

// Samannimiset kaupat samassa kunnassa → katuosoite otsikkoon (uniikit titlet)
const DUP_NAME = (() => { const c = {}; for (const s of allStores) { const k = s.name + '|' + s.kunta; c[k] = (c[k] || 0) + 1; } return new Set(Object.keys(c).filter(k => c[k] > 1)); })();
// Kauppasivut
for (const s of allStores) {
  const chainP = `/ketju/${chainSlug(s.chain)}/`;
  const kP = `/kaupat/${slugify(s.kunta)}/`;
  const week = dates.slice(0, 7).map(d => {
    const v = s.sched[d];
    return `<tr data-d="${d}"${d === TODAY ? ' class="today"' : ''}><th>${WD_FI_LONG[wdOf(d)]} ${fiDate(d)}${HOL_BY_DATE[d] ? ` (${esc(HOL_BY_DATE[d].name.toLowerCase())})` : ''}</th><td>${v.k === 'u' ? `<span class="unk">${esc(dayText(v))}</span>` : esc(dayText(v))}${v.hint ? ` <small>(${esc(v.hintSrc || 'OpenStreetMap')} näyttää nyt: ${esc(v.hint.length ? fmtR(v.hint) : 'suljettu')})</small>` : ''}${v.k === 'x' ? ' <em>poikkeusaika</em>' : ''}${v.note ? ` <small>${esc(v.note)}</small>` : ''}</td></tr>`;
  }).join('');
  // Pyhät, joista ei ole mitään tietoa, kootaan yhdelle riville (sama tieto, ei toistoa: spämmisuoja sääntö 3)
  const holBare = HOL.slice(0, 9).filter(h => { const v = s.sched[h.iso]; return v.k === 'u' && !v.hint && !v.note; });
  const holRows = HOL.slice(0, 9).filter(h => !holBare.includes(h)).map(h => {
    const v = s.sched[h.iso];
    let txt;
    if (v.k === 'u') {
      txt = `<span class="unk">${s.src.official ? 'ei vielä julkaistu' : 'ei vahvistettua tietoa'}</span>`;
      if (v.hint) txt += ` <small>(${esc(v.hintSrc || 'OpenStreetMap')} näyttää nyt: ${esc(v.hint.length ? fmtR(v.hint) : 'suljettu')})</small>`;
      if (v.note) txt += ` <small>${esc(v.note)}</small>`;
    } else txt = esc(dayText(v)) + (v.k === 'x' ? ' <em class="ok">vahvistettu</em>' : '') + (v.note ? ` <small>${esc(v.note)}</small>` : '');
    return `<tr><th><a href="/auki/${h.slug}/${slugify(s.kunta)}/">${esc(h.name)}</a> ${WD_FI[wdOf(h.iso)]} ${fiDate(h.iso)}</th><td>${txt}</td></tr>`;
  }).join('') + (holBare.length ? `<tr><th>${s.src.official ? 'Ei vielä julkaistu' : 'Ei vahvistettua tietoa'}</th><td class="holbare">${holBare.map(h => `<a href="/auki/${h.slug}/${slugify(s.kunta)}/">${esc(h.name)} ${fiDate(h.iso)}</a>`).join(', ')}</td></tr>` : '');
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
  const holStrip = `<a class="strip${isXmas(sh.slug) ? ' xmas' : ''}" href="${s.chain === 'Alko' ? `/alko/${sh.slug}/#${slugify(s.kunta)}` : `/auki/${sh.slug}/${slugify(s.kunta)}/`}">${ICON.cal}<span><b>${esc(sh.name)} ${WD_FI[wdOf(sh.iso)]} ${fiDate(sh.iso)}</b> · ${esc(shTxt)}</span>${ICON.chev}</a>`;
  gateMeta('kauppa', hasHours(s), storeSig(s)); CUR.v = +(shv.k !== 'u');
  put(`/kauppa/${s.slug}/`, layout({
    title: `${s.name} aukioloajat${s.kunta && !s.name.includes(s.kunta) ? ' ' + s.kunta : ''}${DUP_NAME.has(s.name + '|' + s.kunta) && s.street ? ', ' + s.street : ''} | Kaupat auki`,
    desc: `${s.name}, ${[s.street, s.postname].filter(Boolean).join(', ')}: aukioloajat tänään, juhlapyhien poikkeusajat (${nextHol.name.toLowerCase()} ${fiDate(nextHol.iso)})${s.flyer ? ' ja linkki tarjouslehteen' : ''}.`,
    canonical: `/kauppa/${s.slug}/`, jsonld: [ld, crumbs(cr)], wide: true,
    body: `${crumbHtml(cr)}<article class="store" data-s='${esc(JSON.stringify(compact(s, [...new Set([...dates, ...HOL.map(h => h.iso)])])))}' data-lat="${s.lat.toFixed(5)}" data-lon="${s.lon.toFixed(5)}" data-name="${esc(dispName(s))}">
<div class="store-grid"><div class="store-main">
<section class="answer">
<span class="eyebrow">${chainBadge(s)}<a href="${chainP}">${esc(s.chain)}</a> · ${esc(s.kunta)}</span>
<h1>${esc(s.name)}</h1><p class="addr">${esc([s.street, [s.postcode, s.postname].filter(Boolean).join(' ')].filter(Boolean).join(', '))}</p>
<div class="statusline"><span class="pill big unk" id="nowpill">Tänään</span><span class="nowtxt" id="nowtxt">${esc(dayText(s.sched[TODAY]))}</span></div>
<p class="trust${s.chain !== 'Alko' && !s.src.official ? ' unv' : ''}">${s.chain !== 'Alko' && !s.src.official ? ICON.info : ICON.shield}${s.chain === 'Alko' ? 'Pyhäpäivät: Alkon tiedotteet · arkiajat: OpenStreetMap' : s.src.official ? `Lähde ${esc(s.src.name)} · haettu ${fiDateY(s.src.fetched)}` : 'OpenStreetMap · ei kaupan vahvistama'}</p>
<div class="acts2"><a class="btn" href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}" rel="noopener" target="_blank">${ICON.nav}Reitti</a>${s.flyer ? `<a class="btn ghost" href="${esc(s.flyer.url)}" rel="noopener" target="_blank" title="${s.flyer.kind === 'store-offers' ? 'Kaupan tarjoukset S-kaupat.fi:ssä' : s.flyer.kind === 'store' ? 'Tämän kaupan tarjouslehti k-ruoka.fi:ssä' : esc(s.chain) + '-tarjouslehti'}">${ICON.paper}${s.flyer.kind === 'store-offers' ? 'Tarjoukset' : 'Tarjouslehti'}</a>` : s.chain === 'Alko' && s.url ? `<a class="btn ghost" href="${esc(s.url)}" rel="noopener" target="_blank">${ICON.paper}Alko.fi</a>` : `<a class="btn ghost" href="#viikko">${ICON.cal}Viikon ajat</a>`}</div>
${PARK_CITIES.has(s.kunta) ? `<p class="park"><a href="https://parkpenny.com/?city=${s.kunta.toLowerCase()}&amp;lat=${s.lat.toFixed(5)}&amp;lon=${s.lon.toFixed(5)}&amp;q=${encodeURIComponent(s.name)}&amp;dur=60" rel="noopener" target="_blank"><span class="pbadge" aria-hidden="true">P</span>Pysäköinti lähellä – hinnat Parkpennyssä ↗</a></p>` : ''}
</section>
${holStrip}${notifyBox(s)}
<div class="tables"><section><h2 id="viikko">Aukioloajat tällä viikolla</h2><table class="hours">${week}</table></section>
<section><h2>Juhlapyhät ja poikkeusajat</h2><table class="hours hol">${holRows}</table></section></div>
<p class="note">${s.chain === 'Alko' ? `Juhlapyhien ajat ovat Alkon itse tiedottamia (${(s.facts || []).map(f => `<a href="${esc(f.url)}" rel="noopener">${esc(f.name)}</a>`).join(', ')}). Myymäläkohtaiset arkiaukioloajat ovat OpenStreetMapista eivätkä Alkon vahvistamia – tarkista ne Alkon sivulta.` : s.src.official ? 'Poikkeusajat näytetään heti, kun kauppa julkaisee ne. Joulun ajat julkaistaan yleensä joulukuun alussa.' : 'Tälle kaupalle ei ole vielä virallista tietolähdettä.'}</p>
<p class="src">${srcTxt}</p>
</div>
<aside class="store-side" aria-label="Kartta ja lähimmät kaupat">
${near.length ? `<div class="chips maponly">${mapBtn}</div>` : ''}${mapBox('near', false)}
${near.length ? `<h2>Lähellä tänään</h2>${tlList(near, TODAY, { id: 'near' })}<a class="more" href="${kP}">Kaikki kaupat: ${esc(s.kunta)} →</a>` : ''}
</aside></div>
</article>`
  }));
}

// Kuntasivut
for (const k of kunnat) {
  const ks = slugify(k), arr = holSort(byKunta[k], TODAY);
  const cr = [['Kaupat auki', '/'], [k, `/kaupat/${ks}/`]];
  const chainsHere = [...new Set(arr.map(s => s.chain))];
  gateMeta('kunta', byKunta[k].filter(hasHours).length >= 3, sig(byKunta[k].map(storeSig)));
  put(`/kaupat/${ks}/`, layout({
    title: `Kaupat auki tänään – ${k} | Kaupungin ruokakaupat ja aukioloajat`,
    desc: `${k}: ${arr.length} ruokakauppaa (${chainsHere.slice(0, 5).join(', ')}). Mitkä kaupat ovat auki nyt, aukioloajat tänään ja juhlapyhinä.`,
    canonical: `/kaupat/${ks}/`, jsonld: [crumbs(cr)], wide: true,
    body: `${crumbHtml(cr)}<h1>Kaupat auki tänään – ${esc(k)}</h1>
<p class="lead">${arr.length} ruokakauppaa. Palkki näyttää aukiolon klo 6–24, sininen viiva on kellonaika nyt.</p>
<div class="tabs"><span class="tab on">Tänään ${WD_FI[wdOf(TODAY)]} ${fiDate(TODAY)}</span>${HOL.slice(0, 5).map(h => `<a class="tab" href="/auki/${h.slug}/${ks}/">${esc(h.name)} ${fiDate(h.iso)}</a>`).join('')}</div>
<div class="chips"><button type="button" class="chip" id="onlyopen" aria-pressed="false">Vain auki nyt</button><button type="button" class="chip" id="sortnear" aria-pressed="false">Lähimmät ensin</button>${mapBtn}</div>
<div class="split"><div class="split-list">${alkoStrip(k, TODAY, null)}
${tlList(arr, TODAY, { ad: CUR.index })}</div><aside class="split-map" aria-label="Kartta">${mapBox('list', true)}</aside></div>`
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
    return `<tr><th><a href="${c === 'Alko' ? `/alko/${h.slug}/` : `/ketju/${chainSlug(c)}/`}">${esc(c)}</a></th><td>${common ? `yleisimmin ${esc(common)} <small>(${sample.length}/${chains[c].length} kauppaa julkaissut)</small>` : '<span class="unk">ei vielä julkaistu</span>'}</td></tr>`;
  }).join('');
  gateMeta('pyha', allStores.filter(s => s.sched[d] && s.sched[d].k !== 'u').length >= 20, daySig(allStores, d));
  put(`/auki/${h.slug}/`, layout({
    title: `Kaupat auki ${h.when} ${h.year} (${wd} ${fiDate(d)}) | Kaupat auki`,
    desc: `Mitkä kaupat ovat auki ${h.when} ${fiDateY(d)}? Prisman, K-Citymarketin, Lidlin, S-marketin ja K-Marketin aukioloajat kunnittain virallisista lähteistä.`,
    canonical: `/auki/${h.slug}/`, jsonld: [crumbs(cr)],
    body: `${crumbHtml(cr)}<h1${isXmas(h.slug) ? ' class="xm"' : ''}>${isXmas(h.slug) ? ICON.snow : ''}Kaupat auki ${esc(h.when)} ${h.year}</h1>
<p class="lead">${esc(h.name)} on ${wd} ${fiDateY(d)}. ${esc(statusTxt)}</p>
<h2>Valitse kunta</h2><div class="hols big">${BIG.map(k => `<a href="/auki/${h.slug}/${slugify(k)}/">${esc(k)}</a>`).join('')}<a href="#kaikki">Kaikki kunnat ↓</a></div>
<h2>Ketjut ${esc(h.when)}</h2><table class="hours">${chainRows}</table>
<h2 id="kaikki">Kaikki kunnat</h2><ul class="cols">${kunnat.map(k => `<li><a href="/auki/${h.slug}/${slugify(k)}/">${esc(k)}</a></li>`).join('')}</ul>
${XMAS_MD[h.slug] ? `<p><a href="/joulu/">Kaikki joulun ja uudenvuoden aukioloajat ketjuittain →</a></p>` : ''}
<h2>Muut juhlapyhät</h2><div class="hols">${HOL.filter(x => x !== h).map(x => `<a href="/auki/${x.slug}/">${esc(x.name)} ${fiDate(x.iso)}</a>`).join('')}</div>`
  }));
  for (const k of kunnat) {
    const ks = slugify(k), arr = holSort(byKunta[k], d), s3 = holStats(arr, d);
    const cr2 = [['Kaupat auki', '/'], [`${h.name} ${h.year}`, `/auki/${h.slug}/`], [k, `/auki/${h.slug}/${ks}/`]];
    const pub = s3.open + s3.closed;
    gateMeta('pyhaKunta', pub >= 3, daySig(arr, d));
    put(`/auki/${h.slug}/${ks}/`, layout({
      title: `Kaupat auki ${h.when} – ${k} ${h.year} | Kaupat auki`,
      desc: `${k}: mitkä kaupat ovat auki ${h.when} ${fiDateY(d)}? ${arr.length} ruokakaupan aukioloajat${pub ? ` – ${s3.open} kauppaa auki` : ''}. Päivittyy, kun kaupat julkaisevat poikkeusajat.`,
      canonical: `/auki/${h.slug}/${ks}/`, jsonld: [crumbs(cr2)], wide: true,
      body: `${crumbHtml(cr2)}<h1${isXmas(h.slug) ? ' class="xm"' : ''}>${isXmas(h.slug) ? ICON.snow : ''}Kaupat auki ${esc(h.when)} – ${esc(k)}</h1>
<p class="lead">${esc(h.name)} ${wd} ${fiDateY(d)}. ${pub ? `${s3.open} kauppaa auki, ${s3.closed} suljettu, ${s3.unk} ei vielä tietoa.` : `Kaupat eivät ole vielä julkaisseet tämän päivän aukioloaikoja. Sivu päivittyy automaattisesti, kun tieto julkaistaan.`}</p>
<div class="tabs"><a class="tab" href="/kaupat/${ks}/">Tänään</a>${HOL.slice(0, 5).map(x => x === h ? `<span class="tab on">${esc(x.name)} ${fiDate(x.iso)}</span>` : `<a class="tab" href="/auki/${x.slug}/${ks}/">${esc(x.name)} ${fiDate(x.iso)}</a>`).join('')}</div>
<div class="chips maponly">${mapBtn}</div>
<div class="split"><div class="split-list">${alkoStrip(k, d, h)}
${tlList(arr, d, { holiday: true, ad: CUR.index, label: `${h.name} ${fiDate(d)} · auki pisimpään ensin` })}</div><aside class="split-map" aria-label="Kartta">${mapBox('list', true)}</aside></div>
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
  gateMeta('alkoPyha', st.open + st.closed >= 20, daySig(alkos, d));
  put(`/alko/${h.slug}/`, layout({
    title: `Alko auki ${h.when} ${h.year} (${WD_FI[wdOf(d)]} ${fiDate(d)}) | Kaupat auki`,
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
// ---------- Joulukooste /joulu/ – laskee joka yö ketjujen julkaisemat jouluajat ----------
const XMAS = (() => {
  const [ty, tm, td] = TODAY.split('-').map(Number);
  const inSeason = (tm === 12 && td >= 25) || (tm === 1 && td <= 6);
  const y = inSeason ? (tm === 1 ? ty - 1 : ty) : HOL.find(h => h.slug === 'jouluaattona').year;
  const days = Object.entries(XMAS_MD).map(([sl, md]) => {
    const h = HOL.find(x => x.slug === sl), d = `${md.startsWith('01') ? y + 1 : y}-${md}`;
    return { ...h, iso: d, year: +d.slice(0, 4) };
  }).filter(x => x.iso >= TODAY);
  return { year: y, days, season: (tm === 11) || (tm === 12) || inSeason };
})();
const XMAS_CHAINS = ['Prisma', 'K-Citymarket', 'S-market', 'K-Supermarket', 'Lidl', 'K-Market', 'Sale', 'Alepa', 'Tokmanni', 'Alko'].filter(c => chains[c]);
const K_CHAINS = new Set(['K-Citymarket', 'K-Supermarket', 'K-Market']);
function chainDay(c, d) {
  const arr = chains[c] || [], sample = arr.map(s => s.sched[d]).filter(v => v && v.k !== 'u');
  if (!sample.length) return null;
  const cnt = {}; for (const v of sample) { const t = dayText(v); cnt[t] = (cnt[t] || 0) + 1; }
  const [top, topN] = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
  return { n: sample.length, N: arr.length, top, topN, open: sample.filter(isOpenV).length };
}
function chainDayTxt(c, d) {
  const x = chainDay(c, d);
  if (!x) return K_CHAINS.has(c) ? '<span class="unk">ei virallista tietoa – tarkista kaupan sivulta</span>' : '<span class="unk">ei vielä julkaistu</span>';
  if (c === 'Alko') return x.n === x.N && x.topN === x.N ? `kaikki ${esc(x.top)}` : /sunnuntaisin/.test(x.top) ? 'sunnuntaisin avoinna olevat myymälät auki' : `${x.n} myymälää: ${esc(x.top)}`;
  return x.n === x.N && x.topN === x.N ? `kaikki ${esc(x.top)}` : `yleisimmin ${esc(x.top)} <small>(${x.n}/${x.N} kauppaa julkaissut)</small>`;
}
const alkoDayTxt = d => { const x = chainDay('Alko', d); if (!x) return ''; return x.n === x.N && x.topN === x.N ? `kaikki Alkot ${x.top}` : /sunnuntaisin/.test(x.top) ? 'sunnuntaisin avoinna olevat Alkot auki' : ''; };
const ALKO_Q3 = ALKO_FACTS.find(f => /14\.10\.2026/.test(f.name));
if (XMAS.days.length) {
  const Y = XMAS.year, cr = [['Kaupat auki', '/'], [`Joulu ${Y}`, '/joulu/']];
  const dayStats = XMAS.days.map(h => ({ h, st: holStats(stores, h.iso) }));
  const anyGrocery = dayStats.some(({ st }) => st.open + st.closed > 0);
  const eve = XMAS.days.find(h => h.slug === 'jouluaattona'), xday = XMAS.days.find(h => h.slug === 'joulupaivana');
  const alkoLine = [eve && alkoDayTxt(eve.iso) && `jouluaattona ${alkoDayTxt(eve.iso)}`, xday && alkoDayTxt(xday.iso) && `joulupäivänä ${alkoDayTxt(xday.iso)}`].filter(Boolean).join(', ');
  const sFirst = eve ? fiDate(iso(add(new Date(eve.iso + 'T00:00:00Z'), -21))) : '';
  const big = anyGrocery
    ? `${dayStats.map(({ h, st }) => st.open + st.closed ? `${h.name}: ${st.open + st.closed} kauppaa julkaissut ajan` : null).filter(Boolean).join(' · ')}. Lista päivittyy joka yö.`
    : `Ruokakauppaketjut eivät ole vielä julkaisseet joulun aukioloaikoja. Alkon ajat ovat jo tiedossa – katso taulukko.`;
  // UKK: jouluaatto ja joulupäivä yhdessä vastauksessa, jotta sama teksti ei toistu
  const pubTxt = h => { const st = holStats(stores, h.iso), pub = st.open + st.closed; return pub ? `${h.when} ${fiDate(h.iso)} ${pub} ruokakauppaa on julkaissut aikansa (${st.open} auki, ${st.closed} suljettu)` : null; };
  const xmasDays = [eve, xday].filter(Boolean), pubs = xmasDays.map(pubTxt).filter(Boolean);
  const notYet = xmasDays.filter(h => !pubTxt(h)).map(h => h.when);
  const faq = [];
  if (xmasDays.length) faq.push([`Ovatko kaupat auki jouluna ${Y}?`, [
    pubs.length ? `${pubs.join('; ')}.` : '',
    notYet.length ? `Ketjut eivät ole vielä julkaisseet aikoja ${notYet.join(' eivätkä ')}.` : '',
    'Kaupat saavat olla auki myös pyhinä, sillä kauppojen aukioloja rajoittava laki kumottiin vuonna 2016 – aukiolo on jokaisen kaupan oma päätös. Päivitämme ajat heti, kun kaupat julkaisevat ne.'
  ].filter(Boolean).join(' ')]);
  if (eve && alkoDayTxt(eve.iso)) faq.push([`Onko Alko auki jouluaattona ${Y}?`, `Alkon tiedotteen mukaan ${alkoLine}.`]);
  const SRC_ROWS = [
    ['S-ryhmä', `Prisman, S-marketin, Salen ja Alepan ajat tulevat S-kaupat.fi:n myymäläsivuilta, joilla ajat näkyvät noin kolme viikkoa etukäteen${eve ? ` – jouluaaton ajat siis noin ${sFirst} alkaen` : ''}.`],
    ['Lidl', 'Lidl.fi:n myymäläsivujen poikkeusaukioloajat. Näkyvät, kun Lidl merkitsee ne myymäläsivuille.'],
    ['Tokmanni', 'Tokmanni.fi:n myymälähaun poikkeusaukioloajat.'],
    ['K-ryhmä', 'K-kauppojen joulun ajoille meillä ei vielä ole virallista lähdettä, koska K-kauppiaat päättävät ajoista kauppakohtaisesti. Tarkista K-Citymarketin, K-Supermarketin ja K-Marketin aika kaupan omalta sivulta.'],
    ['Alko', 'Alkon omat tiedotteet.'],
  ];
  const srcQ = 'Milloin ja mistä joulun ajat tulevat?';
  const ldFaq = [...faq, [srcQ, `${SRC_ROWS.map(([k, v]) => `${k}: ${v}`).join(' ')} Tarkistamme lähteet joka yö.`]];
  const groceryCell = (h, st) => `<a href="#${h.slug}">${[st.open && `${st.open} auki`, st.closed && `${st.closed} kiinni`].filter(Boolean).join(', ')}</a>`;
  const alkoCell = d => { const x = chainDay('Alko', d); if (!x) return 'ei vielä julkaistu'; return x.n === x.N && x.topN === x.N ? `kaikki ${x.top}` : /sunnuntaisin/.test(x.top) ? 'sunnuntaisin avoinna olevat auki' : `${x.n} myymälää: ${x.top}`; };
  // Peräkkäiset tyhjät ruokakauppasolut yhdistetään yhdeksi soluksi (rowspan), ettei sama teksti toistu riveittäin
  const empt = dayStats.map(({ st }) => !(st.open + st.closed));
  const runLen = i => { let n = 0; while (empt[i + n]) n++; return n; };
  const groceryTd = (i, h, st) => !empt[i] ? `<td>${groceryCell(h, st)}</td>` : (i > 0 && empt[i - 1]) ? '' : `<td rowspan="${runLen(i)}" class="unk mid">ei vielä julkaistu${eve && i === 0 ? `<small>S-ryhmän jouluaatto näkyy noin ${sFirst} alkaen</small>` : ''}</td>`;
  const detailed = dayStats.filter(({ st }) => st.open + st.closed);
  put('/joulu/', layout({
    title: `Kaupat auki jouluna ${Y} – joulun aukioloajat ketjuittain | Kaupat auki`,
    desc: `Joulun aukioloajat ${Y}: Prisma, K-Citymarket, S-market, Lidl, Tokmanni ja Alko jouluaattona, joulupäivänä, tapaninpäivänä ja uutena vuotena.`,
    canonical: '/joulu/',
    jsonld: [crumbs(cr), { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: ldFaq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) }],
    body: `${crumbHtml(cr)}
<section class="answer xmas"><span class="eyebrow">${ICON.snow}Joulu ja uusi vuosi ${Y} · päivitetty ${BUILD_STAMP}</span><h1>Kaupat auki jouluna ${Y}</h1>
<p class="big-ans">${esc(big)}</p>
<p class="trust">${ICON.shield}Näytämme vain kauppojen ja ketjujen itse julkaisemat ajat. Emme arvaa.</p></section>
<h2>Joulun ja uudenvuoden päivät</h2>
<table class="hours xt"><thead><tr><th>Päivä</th><th>Ruokakaupat</th>${chains.Alko ? '<th>Alko</th>' : ''}</tr></thead><tbody>
${dayStats.map(({ h, st }, i) => `<tr><th><a href="/auki/${h.slug}/">${esc(h.name)}</a><small>${WD_FI[wdOf(h.iso)]} ${fiDate(h.iso)}</small></th>${groceryTd(i, h, st)}${chains.Alko ? `<td><a href="/alko/${h.slug}/">${esc(alkoCell(h.iso))}</a></td>` : ''}</tr>`).join('\n')}
</tbody></table>
<p class="note">Päivän nimestä aukeaa kunnittainen lista, Alkon ajasta päivän kaikki Alkot.${ALKO_Q3 ? ` Alkon ajat: <a href="${esc(ALKO_Q3.url)}" rel="noopener">${esc(ALKO_Q3.name)}</a>${TODAY <= `${Y}-12-20` ? '; sen mukaan sunnuntaina 20.12. auki on yli 140 Alkoa' : ''}.` : ''} Alko saa alkoholilain mukaan olla auki joka päivä klo 9–21 – <a href="/aukiololaki/">lue lisää aukiolosäännöistä</a>.</p>
${detailed.map(({ h, st }) => `<h2 id="${h.slug}">${esc(h.name)} – ${WD_FI_LONG[wdOf(h.iso)]} ${fiDateY(h.iso)}</h2>
<table class="hours">${XMAS_CHAINS.map(c => `<tr><th><a href="${c === 'Alko' ? `/alko/${h.slug}/` : `/ketju/${chainSlug(c)}/`}">${esc(c)}</a></th><td>${chainDayTxt(c, h.iso)}</td></tr>`).join('')}</table>
<p><a href="/auki/${h.slug}/">Kaupat auki ${esc(h.when)} kunnittain →</a></p>`).join('\n')}
${eve ? `<h2>Jouluaatto suurimmissa kaupungeissa</h2><div class="hols">${BIG.slice(0, 16).map(k => `<a href="/auki/jouluaattona/${slugify(k)}/">${esc(k)}</a>`).join('')}<a href="/auki/jouluaattona/#kaikki">Kaikki kunnat →</a></div>` : ''}
<h2>Usein kysyttyä</h2>
${faq.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join('')}
<h3>${srcQ}</h3>
<table class="hours srct">${SRC_ROWS.map(([k, v]) => `<tr><th>${k}</th><td>${esc(v)}</td></tr>`).join('')}</table>
<p class="note">Tarkistamme lähteet joka yö. <a href="/aukiololaki/">Saavatko kaupat olla auki pyhinä? Aukiololaki ja Alkon säännöt →</a></p>`
  }));
}

// ---------- Aukiololaki /aukiololaki/ – lähteistetty selitys, päivitetään käsin ----------
const LAW_UPDATED = '24.11.2026';
const LAW_SRC = [
  ['Laki vähittäiskaupan sekä parturi- ja kampaamoliikkeen aukioloajoista annetun lain kumoamisesta 1618/2015 (Finlex)', 'https://data.finlex.fi/api/media/statute/59831/mainPdf/main.pdf'],
  ['Hallituksen esitys alkoholilaiksi 2017 – taustaosio kauppojen aukiolosääntelyn historiasta (STM)', 'https://stm.fi/documents/1271139/4390384/HE_ALKOHOLILAKI_FI_1209.pdf/16ccead6-3116-483b-8a0f-404917d9161d'],
  ['STM: Alkoholilaki tulee kokonaisuudessaan voimaan maaliskuussa (28.12.2017)', 'https://valtioneuvosto.fi/-/1271139/alkoholilaki-tulee-kokonaisuudessaan-voimaan-maaliskuussa'],
  ['STM: Uudistettu alkoholilaki mahdollistaa alkoholijuomien toimitukset asiakkaille (25.6.2026)', 'https://valtioneuvosto.fi/-/1271139/uudistettu-alkoholilaki-mahdollistaa-alkoholijuomien-toimitukset-asiakkaille-ja-sallii-vakevien-verkkomainonnan-'],
  ['Eduskunta hyväksyi alkoholilain muutoksen äänin 98–77 (eduskunta.fi)', 'https://www.eduskunta.fi/tiedotteet/eduskunta-hyvaksyi-alkoholilain-muutoksen-aanin-98-77'],
  ['STT: Uusi alkoholilaki tulee voimaan 3.7.2026 (Suomenmaa 26.6.2026)', 'https://www.suomenmaa.fi/uutiset/uusi-alkoholilaki-tulee-voimaan-ensi-viikolla-alkojen-aukioloajat-laajenevat-3/'],
  ['Alkon tiedote 23.6.2026: Alkoholilain muutos mahdollistaa Alkon myymälöiden laajemmat aukioloajat', 'https://www.sttinfo.fi/tiedote/72153818/alkoholilain-muutos-mahdollistaa-alkon-myymaloiden-laajemmat-aukioloajat-108-myymalan-aukioloajat-laajenevat-lauantaista-47-alkaen?lang=fi'],
  ['Kaleva: K-kauppiaat päättävät itse kauppansa aukioloajoista', 'https://www.kaleva.fi/juhannuksen-aukioloajat-kaupat-saavat-olla-auki-va/3728105'],
  ['MTV Uutiset: Lidl pitää kaikki myymälänsä kiinni joulupäivänä 2020', 'https://www.mtvuutiset.fi/makuja/artikkeli/lidl-teki-yllatyspaatoksen-jouluun-liittyen-paatimme-pitaa-kaikki-myymalat-kiinni-nain-muut-kaupat-ovat-auki/7999526'],
];
{
  const cr = [['Kaupat auki', '/'], ['Aukiololaki', '/aukiololaki/']];
  // Kysymykset ovat itse väliotsikoita → UKK-JSON-LD samasta tekstistä, ei erillistä toistavaa UKK-osiota
  const LAW_QA = [
    ['Milloin kauppojen aukiololaki kumottiin?', [
      'Kauppojen aukioloista säädettiin aiemmin vähittäiskaupan sekä parturi- ja kampaamoliikkeen aukioloajoista annetussa laissa (945/2009). Eduskunta kumosi sen lailla 1618/2015, joka tuli voimaan 1.1.2016.',
      'Sääntely oli purettu vähitellen jo ennen sitä: vuonna 2009 pienten kauppojen aukioloajat vapautettiin kokonaan, ja kaikki kaupat saivat olla auki sunnuntaisin klo 12–21.']],
    ['Miksi jotkin kaupat ovat silti kiinni pyhinä?', [
      'Koska aukiolo on kaupan oma päätös, ajat vaihtelevat ketjuittain ja usein myös kaupoittain. Esimerkiksi Lidl kertoi vuonna 2020 pitävänsä kaikki Suomen myymälänsä kiinni joulupäivänä, jotta henkilökunta voi viettää joulua. K-kauppojen ajoista päättävät kauppiaat kauppakohtaisesti, ja S-ryhmän kaupat julkaisevat ajat myymäläkohtaisesti.',
      `Siksi oman kaupan pyhäaika kannattaa aina tarkistaa erikseen. Kokoamme kauppojen itse julkaisemat ajat <a href="/joulu/">joulun koostesivulle</a> ja juhlapyhäsivuille: ${HOL.slice(0, 6).map(h => `<a href="/auki/${h.slug}/">${esc(h.name)}</a>`).join(', ')}.`]],
    ['Mihin aikaan ruokakaupasta saa ostaa alkoholia?', [
      'Alkoholijuomien myyntiä rajoittaa edelleen alkoholilaki (1102/2017). Ruokakaupat ja muut vähittäismyyntiluvan saaneet saavat myydä alkoholijuomia joka päivä klo 9–21, myös sunnuntaisin ja pyhinä. Vaikka kauppa olisi auki ympäri vuorokauden, alkoholia ei voi ostaa klo 21:n jälkeen eikä ennen klo 9:ää.',
      'Ruokakauppa saa myydä enintään 8-prosenttisia käymisteitse valmistettuja juomia, kuten oluita ja siidereitä, sekä enintään 5,5-prosenttisia muulla tavoin valmistettuja juomia. Vahvemmat juomat myy Alko.']],
    ['Saako Alko olla auki sunnuntaina ja pyhinä?', [
      'Kyllä, 3.7.2026 alkaen. Eduskunta hyväksyi alkoholilain muutoksen kesäkuussa 2026, ja sen jälkeen Alko saa olla auki vuoden jokaisena päivänä klo 9–21. Laki ei velvoita pitämään myymälöitä auki, vaan Alko päättää ajat myymäläkohtaisesti. Heinäkuusta 2026 alkaen osa Alkoista on ollut auki myös sunnuntaisin.',
      'Ennen muutosta Alko sai olla auki maanantaista perjantaihin klo 9–21 ja lauantaisin klo 9–18, mutta ei sunnuntaisin eikä arkipyhinä.',
      `Alkojen pyhäajat: ${HOL.slice(0, 6).map(h => `<a href="/alko/${h.slug}/">Alko ${esc(h.when)}</a>`).join(', ')}.`]],
  ];
  const plain = t => t.replace(/<[^>]+>/g, '');
  put('/aukiololaki/', layout({
    title: 'Saavatko kaupat olla auki pyhinä? Aukiololaki ja Alko | Kaupat auki',
    desc: 'Kauppojen aukiololaki kumottiin 2016, joten kauppa päättää aukiolostaan myös pyhinä. Alkoholia saa myydä klo 9–21, ja Alko saa olla auki joka päivä.',
    canonical: '/aukiololaki/',
    jsonld: [crumbs(cr), { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: [
      { '@type': 'Question', name: 'Saavatko kaupat olla auki pyhäpäivinä?', acceptedAnswer: { '@type': 'Answer', text: 'Kyllä. Suomessa ei ole 1.1.2016 jälkeen ollut lakia, joka rajoittaisi kauppojen aukioloaikoja. Kauppa päättää itse, onko se auki jouluna, pääsiäisenä tai juhannuksena.' } },
      ...LAW_QA.map(([q, ps]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: plain(ps[0]) } }))] }],
    body: `${crumbHtml(cr)}
<section class="answer"><span class="eyebrow">Päivitetty ${LAW_UPDATED}</span><h1>Saavatko kaupat olla auki pyhinä?</h1>
<p class="big-ans">Kyllä. Suomessa ei ole 1.1.2016 jälkeen ollut lakia, joka rajoittaisi kauppojen aukioloaikoja. Kauppa päättää itse, onko se auki jouluna, pääsiäisenä tai juhannuksena.</p>
<p class="trust">${ICON.shield}Lähteet: Finlex, sosiaali- ja terveysministeriö, eduskunta ja Alko – lista sivun lopussa.</p></section>
${LAW_QA.map(([q, ps]) => `<h2>${esc(q)}</h2>\n${ps.map(t => `<p>${t}</p>`).join('\n')}`).join('\n')}
<h2>Lähteet</h2>
<ul class="srcs">${LAW_SRC.map(([n, u]) => `<li><a href="${esc(u)}" rel="noopener">${esc(n)}</a></li>`).join('')}</ul>
<p class="note">Tämä sivu on yleiskatsaus, ei oikeudellinen neuvo. Säädösten ajantasainen teksti on Finlexissä.</p>`
  }));
}

// Ketjusivut + tarjouslehtisivut
for (const c of chainList) {
  const cs = chainSlug(c), arr = chains[c], info = CHAIN_INFO[c] || {};
  const per = {}; for (const s of arr) (per[s.kunta] ||= []).push(s);
  const cr = [['Kaupat auki', '/'], [c, `/ketju/${cs}/`]];
  const official = arr.filter(s => s.src.official).length;
  gateMeta('ketju', !NOT_CHAINS.has(c) && arr.filter(hasHours).length >= 5, sig(arr.map(storeSig)));
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
  ['K-Citymarket', 'k-citymarket', 'https://kcm-lehdet.k-ruoka.fi/tarjouslehti', 'K-Citymarketilla on yksi valtakunnallinen tarjouslehti.', ['K-Citymarket']],
  ['K-Supermarket', 'k-supermarket', 'https://www.k-ruoka.fi/k-supermarket/tarjouslehti', 'Jokaisella K-Supermarketilla on oma tarjouslehti. Kauppasivuillamme on suora linkki kaupan omaan lehteen.', ['K-Supermarket']],
  ['K-Market', 'k-market', 'https://www.k-ruoka.fi/k-market/tarjouslehti', 'Jokaisella K-Marketilla on oma tarjouslehti. Kauppasivuillamme on suora linkki kaupan omaan lehteen.', ['K-Market']],
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
  gateMeta('lehti', withStore.length >= 20, sig([u, txt, withStore.map(s => s.flyer.url)]));
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
<button type="button" class="btn big" id="nearbtn">${ICON.nav}Lähimmät auki olevat kaupat</button>
<p class="hint">Tai hae kauppaa tai kuntaa alareunan hakukentästä.</p></section>
${XMAS_NAV ? `<a class="card xmas" href="/joulu/"><b>${ICON.snow}Kaupat auki jouluna ${XMAS.year}</b><span>Ketjujen joulun ja uudenvuoden aukioloajat yhdellä sivulla →</span></a>` : ''}
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
<p>Miksi kaupat saavat olla auki pyhinä? Katso <a href="/aukiololaki/">aukiololaki ja Alkon säännöt</a>.</p>
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
<p><b>Kartta:</b> tietokoneella kauppasivujen kartta ladataan OpenFreeMap-palvelusta (tiles.openfreemap.org, kartta-aineisto © OpenMapTiles ja OpenStreetMapin tekijät). Palvelu ei käytä evästeitä eikä tunnuksia, mutta karttakuvia ladattaessa selaimesi IP-osoite välittyy sille kuten mille tahansa verkkopalvelulle. Puhelimella karttaa ei ladata.</p>
<p><b>Omat käyttölaskurit:</b> sivu lähettää palvelimellemme lyhyen merkinnän sivun latauksesta (sivun tyyppi, esim. "kauppasivu", ja onko pyhäaika vahvistettu), napautuksista reitti-, tarjouslehti-, Alko- ja Parkpenny-linkkeihin sekä siitä, poistuiko kävijä alle 10 sekunnissa. Tallennamme vain päiväkohtaiset yhteismäärät (esim. "26.11. kauppasivu 1 520"). Emme tallenna IP-osoitetta, evästeitä, laitetunnistetta emmekä mitään, millä yksittäisen kävijän voisi tunnistaa tai yhdistää käynnit toisiinsa.</p>
<p><b>Jouluaikojen ilmoitus:</b> jos painat kauppasivulla "Ilmoita, kun jouluajat julkaistaan" ja sallit ilmoitukset, tallennamme selaimesi ilmoitusosoitteen (selaimen valmistajan push-palvelun antama tunniste) ja kaupan nimen. Ilmoitus lähetetään kerran, kun kauppa julkaisee jouluaaton aukioloajan, ja tieto poistetaan heti sen jälkeen – viimeistään jouluaattona. Voit perua tilauksen samasta painikkeesta. Emme kysy nimeä emmekä sähköpostia.</p>
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
  stores: allStores.map(s => [s.slug, dispName(s), s.kunta, +s.lat.toFixed(5), +s.lon.toFixed(5), s.street, compact(s, next7), AREAS[s.postcode] || ''])
}));
// Sivukartta = vain portin läpäisevät sivut. lastmod vaihtuu vain, kun sivun datan tunniste muuttuu (edellinen tila /data/lastmod.json).
let PREV = {};
try {
  PREV = process.env.LASTMOD_PREV ? JSON.parse(fs.readFileSync(process.env.LASTMOD_PREV, 'utf8')) : await (await fetch(`${SITE.origin}/data/lastmod.json`, { signal: AbortSignal.timeout(15000) })).json();
} catch { PREV = {}; }
const LASTMOD = {};
for (const [p, m] of META) { const old = PREV[p]; LASTMOD[p] = old && old[0] === m.sig ? old : [m.sig, TODAY]; }
fs.writeFileSync(path.join(DIST, 'data/lastmod.json'), JSON.stringify(LASTMOD));
const sitemapUrls = pages.filter(x => !x.p.endsWith('.html') && META.get(x.p).index).map(x => x.p);
const chunks = []; for (let i = 0; i < sitemapUrls.length; i += 40000) chunks.push(sitemapUrls.slice(i, i + 40000));
chunks.forEach((c, i) => fs.writeFileSync(path.join(DIST, `sitemap-${i + 1}.xml`), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${c.map(p => `<url><loc>${url(p)}</loc><lastmod>${LASTMOD[p][1]}</lastmod></url>`).join('')}</urlset>`));
fs.writeFileSync(path.join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${chunks.map((c, i) => `<sitemap><loc>${url(`/sitemap-${i + 1}.xml`)}</loc><lastmod>${c.map(p => LASTMOD[p][1]).sort().pop()}</lastmod></sitemap>`).join('')}</sitemapindex>`);
if (SITE.adsenseClient) fs.writeFileSync(path.join(DIST, 'ads.txt'), `google.com, ${SITE.adsenseClient.replace('ca-', '')}, DIRECT, f08c47fec0942fa0\n`);
fs.writeFileSync(path.join(DIST, 'robots.txt'), SITE.preview ? 'User-agent: *\nDisallow: /\n' : `User-agent: *\nAllow: /\n\nSitemap: ${url('/sitemap.xml')}\n`);
if (XMAS_EVE) fs.writeFileSync(path.join(DIST, 'data/xmas-ready.json'), JSON.stringify({ until: XMAS_EVE.iso, stores: Object.fromEntries(stores.filter(s => s.src.official && s.chain !== 'Alko' && s.sched[XMAS_EVE.iso] && s.sched[XMAS_EVE.iso].k !== 'u').map(s => [s.slug, `${s.name}: jouluaatto ${dayText(s.sched[XMAS_EVE.iso])}`])) }));
fs.writeFileSync(path.join(DIST, 'data/holidays.json'), JSON.stringify(HOL.map(h => ({ iso: h.iso, slug: h.slug, name: h.name }))));
fs.writeFileSync(path.join(DIST, 'data/gate.json'), JSON.stringify({ built: TODAY, rules: GATE_RULES, counts: GATE }, null, 1));
console.log(JSON.stringify({ gate: GATE }));
console.log(JSON.stringify({ today: TODAY, stores: stores.length, kunnat: kunnat.length, pages: pages.length, sitemap: sitemapUrls.length, ohErrors, holidays: HOL.slice(0, 4).map(h => h.slug + ' ' + h.iso) }));
