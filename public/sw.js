self.addEventListener('push', (event) => {
  let payload = { title: 'ArseniiCoach', body: 'Новое уведомление', url: '/' };
  try { if (event.data) payload = { ...payload, ...event.data.json() }; } catch (_) {}
  event.waitUntil(
    self.registration.showNotification(payload.title || 'ArseniiCoach', {
      body: payload.body || 'Новое уведомление',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: payload.url || '/' },
    })
  );
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url || '/'));
});
