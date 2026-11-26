// Lähettää ilmoitukset tilaajille, joiden kaupan jouluajat on julkaistu. Aamuajo kutsuu tätä julkaisun jälkeen.
// Turvallinen kutsua kenen tahansa: lähettää vain valmiille kaupoille, kerran, ja poistaa rivin. Korkeintaan kerran 5 minuutissa.
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = o => b64u(new TextEncoder().encode(JSON.stringify(o)));
async function vapid(endpoint, env) {
  const jwk = JSON.parse(env.VAPID_JWK);
  const key = await crypto.subtle.importKey('jwk', { ...jwk, key_ops: ['sign'] }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const u = enc({ typ: 'JWT', alg: 'ES256' }) + '.' + enc({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:' + env.VAPID_SUB });
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(u));
  return `vapid t=${u}.${b64u(sig)}, k=${env.VAPID_PUBLIC}`;
}
export async function onRequest({ request, env }) {
  if (!['POST', 'GET'].includes(request.method)) return new Response(null, { status: 405 });
  if (!env.VAPID_JWK) return Response.json({ ok: false, why: 'no key' }, { status: 503 });
  const now = Date.now();
  const last = await env.DB.prepare("SELECT v FROM meta WHERE k = 'push_run'").first();
  if (last && now - Number(last.v) < 300000) return Response.json({ ok: true, skipped: 'recent' });
  await env.DB.prepare("INSERT INTO meta (k, v) VALUES ('push_run', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(String(now)).run();
  const ready = await (await env.ASSETS.fetch(new URL('/data/xmas-ready.json', request.url))).json();
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Helsinki' }).format(new Date());
  if (ready.until && today > ready.until) { await env.DB.prepare('DELETE FROM subs').run(); return Response.json({ ok: true, cleared: true }); }
  const { results } = await env.DB.prepare('SELECT endpoint, slug FROM subs').all();
  const due = results.filter(r => ready.stores[r.slug]);
  const byEp = new Map(); for (const r of due) byEp.set(r.endpoint, [...(byEp.get(r.endpoint) || []), r.slug]);
  let sent = 0, gone = 0, fail = 0;
  for (const [ep, slugs] of [...byEp].slice(0, 400)) {
    const res = await fetch(ep, { method: 'POST', headers: { Authorization: await vapid(ep, env), TTL: '172800', Urgency: 'normal', 'Content-Length': '0' } });
    if (res.status === 201 || res.status === 200 || res.status === 202) sent++; else if (res.status === 404 || res.status === 410) gone++; else { fail++; continue; }
    await env.DB.batch(slugs.map(s => env.DB.prepare('DELETE FROM subs WHERE endpoint = ? AND slug = ?').bind(ep, s)));
  }
  return Response.json({ ok: true, subs: results.length, due: due.length, sent, gone, fail });
}
