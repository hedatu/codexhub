self.addEventListener("install", (event) => {
  event.waitUntil(caches.open("codexhub-v2").then((cache) => cache.addAll(["/", "/tv.html", "/styles.css", "/app.js", "/tv.js", "/manifest.webmanifest"])));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then((cached) => cached || caches.match("/"))));
});
