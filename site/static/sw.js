// Kaupat auki – vain jouluaikojen ilmoitus (K2-B). Ei välimuistia sivuille, ei seurantaa.
// Ilmoituksessa ei kulje sisältöä: haetaan julkaistut ajat /data/xmas-ready.json:sta ja näytetään tilatut kaupat.
const STORE = 'ka-notify-v1';
const getW = async () => { const r = await (await caches.open(STORE)).match('/watch'); return r ? r.json() : {}; };
const setW = async w => (await caches.open(STORE)).put('/watch', new Response(JSON.stringify(w)));
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('message', e => e.waitUntil((async () => {
  const w = await getW(), d = e.data || {};
  if (d.watch) w[d.watch] = d.name || d.watch;
  if (d.unwatch) delete w[d.unwatch];
  await setW(w);
})()));
self.addEventListener('push', e => e.waitUntil((async () => {
  const w = await getW();
  let ready = {}; try { ready = (await (await fetch('/data/xmas-ready.json', { cache: 'no-store' })).json()).stores || {}; } catch (x) { /* */ }
  const hit = Object.keys(w).filter(s => ready[s]);
  if (!hit.length) return self.registration.showNotification('Jouluaikoja julkaistu', { body: 'Kauppojen jouluaikoja on päivitetty Kaupat auki -palvelussa.', icon: '/icon-192.png', data: { url: '/joulu/' } });
  for (const s of hit) { await self.registration.showNotification('Jouluajat julkaistu', { body: ready[s], icon: '/icon-192.png', tag: 'xmas-' + s, data: { url: '/kauppa/' + s + '/' } }); delete w[s]; }
  await setW(w);
})()));
self.addEventListener('notificationclick', e => { e.notification.close(); e.waitUntil(self.clients.openWindow(e.notification.data && e.notification.data.url || '/')); });
