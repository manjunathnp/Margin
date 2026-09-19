const CACHE = "margin-review-v1.0.0";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=1.0.0",
  "./storage.js?v=1.0.0",
  "./parsers.js?v=1.0.0",
  "./pdf-structure.js?v=1.0.0",
  "./document-lifecycle.js?v=1.0.0",
  "./file-importers.js?v=1.0.0",
  "./app.js?v=1.0.0",
  "./vendor/pdfjs/pdf.js?v=1.0.0",
  "./vendor/pdfjs/pdf.worker.js?v=1.0.0",
  "./assets/margin-logo-square.png?v=1.0.0",
  "./manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    return response;
  }).catch(async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    if (event.request.mode === "navigate") return caches.match("./index.html");
    return Response.error();
  }));
});
