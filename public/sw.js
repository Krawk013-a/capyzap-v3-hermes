// CapyZap Service Worker v4 — cache + push + navegação à prova de falha
const CACHE = "capyzap-v4";
const ASSETS = [
  "/icons/capy.svg",
  "/icons/capy-192.png",
  "/icons/capy-512.png",
  "/icons/capy-maskable-512.png",
  "/manifest.json",
  "/sounds/plim.wav",
  "/chat",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .catch(() => {})
      .then(() => self.skipWaiting())
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

function isSupabasePath(pathname) {
  return (
    pathname.startsWith("/rest/") ||
    pathname.startsWith("/realtime/") ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/functions/") ||
    pathname.includes("supabase")
  );
}

// ===== FETCH: network-first, mas JAMAIS devolve undefined =====
// (bug da v3: offline sem cache → respondWith(undefined) → TypeError
//  e a navegação pra /chat/<id> morria. Agora sempre existe resposta.)
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== "GET") return;
  if (url.origin !== self.location.origin) return;
  if (isSupabasePath(url.pathname)) return;

  event.respondWith(
    (async () => {
      try {
        const res = await fetch(req);
        const cacheable =
          res.ok &&
          (url.pathname.startsWith("/icons/") ||
            url.pathname.startsWith("/sounds/") ||
            url.pathname === "/manifest.json" ||
            url.pathname === "/chat");
        if (cacheable) {
          const copy = res.clone();
          const cache = await caches.open(CACHE);
          cache.put(req, copy).catch(() => {});
        }
        return res;
      } catch {
        // sem rede — cache, shell, ou aviso amigável (nunca undefined)
        const cached = await caches.match(req);
        if (cached) return cached;

        if (req.mode === "navigate") {
          const shell = await caches.match("/chat");
          if (shell) return shell;
          return new Response(
            "Sem internet 🦫 O CapyZap volta sozinho quando a conexão retornar.",
            { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }
          );
        }
        return new Response("", { status: 504 });
      }
    })()
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
    tag: data.tag || "capyzap-msg",
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
