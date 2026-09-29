// CapyZap Service Worker — cache de shell + ícones
const CACHE = "capyzap-v1";
const ASSETS = [
  "/icons/capy.svg",
  "/icons/capy-192.png",
  "/icons/capy-512.png",
  "/icons/capy-maskable-512.png",
  "/manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first com fallback de cache (mantém app usável offline p/ assets estáticos)
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  // nunca cachear Supabase/Realtime/APIs
  if (url.pathname.startsWith("/rest/") || url.pathname.startsWith("/realtime/") || url.pathname.startsWith("/auth/") || url.pathname.includes("supabase")) {
    return;
  }
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && (url.pathname.startsWith("/icons/") || url.pathname === "/manifest.json")) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
