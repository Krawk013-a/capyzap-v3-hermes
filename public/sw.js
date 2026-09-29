// CapyZap Service Worker v2 — cache + notificações push
const CACHE = "capyzap-v3";
const ASSETS = [
  "/icons/capy.svg",
  "/icons/capy-192.png",
  "/icons/capy-512.png",
  "/icons/capy-maskable-512.png",
  "/manifest.json",
  "/sounds/plim.wav",
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
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

// Network-first com fallback de cache p/ assets estáticos
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (
    url.pathname.startsWith("/rest/") ||
    url.pathname.startsWith("/realtime/") ||
    url.pathname.startsWith("/auth/") ||
    url.pathname.includes("supabase")
  ) {
    return;
  }
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (
          response.ok &&
          (url.pathname.startsWith("/icons/") ||
            url.pathname.startsWith("/sounds/") ||
            url.pathname === "/manifest.json")
        ) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// ===== PUSH =====
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "CapyZap", body: "Nova mensagem 🌿" };
  }
  const title = data.title || "CapyZap";
  const options = {
    body: data.body || "Você recebeu uma mensagem",
    icon: "/icons/capy-192.png",
    badge: "/icons/capy-192.png",
    tag: data.tag || "capyzap-msg", // agrupa notificações repetidas
    data: { url: data.url || "/chat" },
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// clique na notificação → abre/foca a conversa certa
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/chat";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          client.navigate(target).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
