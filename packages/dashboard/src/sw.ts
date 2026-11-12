/**
 * ADM-85: the service worker. It exists so a notification can carry buttons (Chrome and Edge show them) and so a click on one can act
 * even when the dashboard tab is in the background. It holds no data and caches nothing.
 */
export const SERVICE_WORKER = `
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  event.waitUntil((async () => {
    const headers = { 'x-cyborg-token': d.token || '', 'x-cyborg-operator': 'toast' };
    // A button on the notification acts on the item through its plug-in, then stays out of the way; a click on the notification itself opens it.
    if (d.key && event.action) { await fetch('/api/item/' + encodeURIComponent(d.key) + '/act/' + encodeURIComponent(event.action), { method: 'POST', headers }); return; }
    const url = '/' + (d.open || '');
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (open.length > 0) { await open[0].focus(); open[0].postMessage({ open: url }); } else { await self.clients.openWindow(url); }
  })());
});
`;
