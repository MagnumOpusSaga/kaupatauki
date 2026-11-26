// K2-B: "Ilmoita, kun kauppasi jouluajat julkaistaan". Tallennetaan vain selaimen push-osoite ja kaupan tunniste.
// Ilmoituksessa ei ole sisältöä: palvelutyöntekijä (sw.js) hakee julkaistut ajat /data/xmas-ready.json:sta.
// Rivi poistetaan heti ilmoituksen jälkeen, perumisen yhteydessä ja viimeistään jouluaaton jälkeen.
const PUSH_HOSTS = /^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.notify\.windows\.com|web\.push\.apple\.com|[a-z0-9.-]+\.push\.apple\.com)$/;
const SLUG = /^[a-z0-9-]{2,90}$/;
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
const check = b => { try { const u = new URL(b.endpoint); return u.protocol === 'https:' && PUSH_HOSTS.test(u.hostname) && b.endpoint.length < 1000 && SLUG.test(b.slug || ''); } catch { return false; } };

export async function onRequestPost({ request, env }) {
  let b; try { b = await request.json(); } catch { return json({ ok: false }, 400); }
  if (!check(b)) return json({ ok: false }, 400);
  const { n } = await env.DB.prepare('SELECT count(*) n FROM subs').first();
  if (n > 50000) return json({ ok: false, full: true }, 503);
  const d = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Helsinki' }).format(new Date());
  await env.DB.prepare('INSERT OR IGNORE INTO subs (endpoint, slug, created) VALUES (?, ?, ?)').bind(b.endpoint, b.slug, d).run();
  return json({ ok: true });
}
export async function onRequestDelete({ request, env }) {
  let b; try { b = await request.json(); } catch { return json({ ok: false }, 400); }
  if (!check(b)) return json({ ok: false }, 400);
  await env.DB.prepare('DELETE FROM subs WHERE endpoint = ? AND slug = ?').bind(b.endpoint, b.slug).run();
  return json({ ok: true });
}
