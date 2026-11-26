// K2-C: evästeetön mittaus. Tallentaa vain päiväkohtaisia summia (päivä, laji, avain, n).
// Ei evästeitä, ei IP-osoitetta, ei käyttäjätunnistetta, ei selaintietoja.
const KINDS = new Set(['view', 'entry', 'click', 'exit']);
const KEY = /^[a-z0-9_:-]{1,40}$/;
const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|playwright/i;
export const day = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Helsinki' }).format(new Date());

export async function onRequestPost({ request, env }) {
  const ok = new Response(null, { status: 204 });
  if (!env.DB || BOT.test(request.headers.get('user-agent') || '')) return ok;
  const host = (() => { try { return new URL(request.headers.get('origin') || request.headers.get('referer') || '').hostname; } catch { return ''; } })();
  if (host && host !== 'kaupatauki.fi' && !host.endsWith('.kaupatauki.pages.dev')) return ok;
  let b; try { b = JSON.parse((await request.text()).slice(0, 2000)); } catch { return ok; }
  const evs = (Array.isArray(b) ? b : [b]).slice(0, 4).filter(e => e && KINDS.has(e.k) && KEY.test(e.key || ''));
  if (!evs.length) return ok;
  const d = day();
  const st = env.DB.prepare('INSERT INTO counters (day, kind, key, n) VALUES (?, ?, ?, 1) ON CONFLICT(day, kind, key) DO UPDATE SET n = n + 1');
  await env.DB.batch(evs.map(e => st.bind(d, e.k, e.key)));
  return ok;
}
export const onRequestGet = () => new Response('POST only', { status: 405 });
