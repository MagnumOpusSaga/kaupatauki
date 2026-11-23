// Tarkistukset: aikataulut järkeviä, ei tyhjiä nimiä, slugit uniikkeja, lähteet mukana.
import fs from 'node:fs';
const st = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } };
const slugs = new Set();
const re = /^([01]\d|2[0-4]):[0-5]\d$/;
let noHours = 0;
for (const s of st) {
  ok(s.name && s.slug && s.kunta, 'nimi/slug/kunta ' + s.id);
  ok(!slugs.has(s.slug), 'slug tuplana ' + s.slug); slugs.add(s.slug);
  ok(s.lat > 59.4 && s.lat < 70.2 && s.lon > 19 && s.lon < 31.7, 'sijainti ' + s.slug);
  ok(s.src && s.src.name && s.src.url && s.src.fetched, 'lähde ' + s.slug);
  const wk = s.week || {};
  for (const [d, r] of Object.entries(wk)) for (const [o, c] of r) ok(re.test(o) && re.test(c), `aika ${s.slug} ${d} ${o}-${c}`);
  for (const e of s.exceptions || []) for (const [o, c] of e.r) ok(re.test(o) && re.test(c), `poikkeus ${s.slug} ${e.date}`);
  if (s.src.official && Object.keys(wk).length < 7) noHours++;
  if (!s.src.official && !s.oh) noHours++;
  if (s.flyer) ok(/^https:\/\//.test(s.flyer.url), 'lehtilinkki ' + s.slug);
}
console.log(JSON.stringify({ stores: st.length, fail, withoutFullHours: noHours }));
process.exit(fail ? 1 : 0);
