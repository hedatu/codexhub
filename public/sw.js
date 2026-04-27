const CACHE_NAME = "codexhub-v21";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(["/", "/tv.html", "/styles.css", "/app.js", "/tv.js", "/manifest.webmanifest"])));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then((cached) => cached || caches.match("/"))));
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "CodexHub", body: event.data?.text() || "有新的待处理事项" };
  }
  event.waitUntil(self.registration.showNotification(payload.title || "CodexHub", {
    body: payload.body || payload.preview || "打开控制台查看详情",
    tag: payload.tag || payload.threadId || "codexhub",
    data: { url: payload.url || "/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
    const existing = clientList.find((client) => client.url.includes(self.location.origin));
    if (existing) {
      existing.focus();
      return existing.navigate(url);
    }
    return clients.openWindow(url);
  }));
});
