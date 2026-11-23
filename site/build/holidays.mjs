// Juhlapyhät ja kauppojen kannalta tärkeät aatot. Palauttaa seuraavan esiintymän (tai tämän päivän).
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const D = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const add = (d, n) => new Date(d.getTime() + n * 86400000);

function easter(y) { // anonyymi gregoriaaninen algoritmi
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4,
    f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
    i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
    mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
  return D(y, mo, da);
}
function weekdayBetween(y, m, d1, d2, wd) { for (let d = d1; d <= d2; d++) { const x = D(y, m, d); if (x.getUTCDay() === wd) return x; } }
function pyhainpaiva(y) { for (let x = D(y, 10, 31); ; x = add(x, 1)) if (x.getUTCDay() === 6) return x; }

export const HOLIDAYS = [
  { slug: 'itsenaisyyspaivana', name: 'Itsenäisyyspäivä', when: 'itsenäisyyspäivänä', date: y => D(y, 12, 6), ph: true },
  { slug: 'jouluaattona', name: 'Jouluaatto', when: 'jouluaattona', date: y => D(y, 12, 24), top: true },
  { slug: 'joulupaivana', name: 'Joulupäivä', when: 'joulupäivänä', date: y => D(y, 12, 25), ph: true, top: true },
  { slug: 'tapaninpaivana', name: 'Tapaninpäivä', when: 'tapaninpäivänä', date: y => D(y, 12, 26), ph: true, top: true },
  { slug: 'uudenvuodenaattona', name: 'Uudenvuodenaatto', when: 'uudenvuodenaattona', date: y => D(y, 12, 31) },
  { slug: 'uudenvuodenpaivana', name: 'Uudenvuodenpäivä', when: 'uudenvuodenpäivänä', date: y => D(y, 1, 1), ph: true },
  { slug: 'loppiaisena', name: 'Loppiainen', when: 'loppiaisena', date: y => D(y, 1, 6), ph: true },
  { slug: 'pitkaperjantaina', name: 'Pitkäperjantai', when: 'pitkäperjantaina', date: y => add(easter(y), -2), ph: true },
  { slug: 'paasiaispaivana', name: 'Pääsiäispäivä', when: 'pääsiäispäivänä', date: y => easter(y), ph: true },
  { slug: 'toisena-paasiaispaivana', name: '2. pääsiäispäivä', when: 'toisena pääsiäispäivänä', date: y => add(easter(y), 1), ph: true },
  { slug: 'vappuaattona', name: 'Vappuaatto', when: 'vappuaattona', date: y => D(y, 4, 30) },
  { slug: 'vappuna', name: 'Vappu', when: 'vappuna', date: y => D(y, 5, 1), ph: true },
  { slug: 'helatorstaina', name: 'Helatorstai', when: 'helatorstaina', date: y => add(easter(y), 39), ph: true },
  { slug: 'juhannusaattona', name: 'Juhannusaatto', when: 'juhannusaattona', date: y => weekdayBetween(y, 6, 19, 25, 5) },
  { slug: 'juhannuspaivana', name: 'Juhannuspäivä', when: 'juhannuspäivänä', date: y => add(weekdayBetween(y, 6, 19, 25, 5), 1), ph: true },
  { slug: 'pyhainpaivana', name: 'Pyhäinpäivä', when: 'pyhäinpäivänä', date: y => pyhainpaiva(y), ph: true },
];

// Seuraava esiintymä annetusta päivästä (YYYY-MM-DD) alkaen
export function upcoming(todayIso) {
  const t = new Date(todayIso + 'T00:00:00Z'), y = t.getUTCFullYear();
  return HOLIDAYS.map(h => {
    let d = h.date(y); if (d < t) d = h.date(y + 1);
    return { ...h, iso: iso(d), year: d.getUTCFullYear() };
  }).sort((a, b) => a.iso.localeCompare(b.iso));
}
export { iso, add };
