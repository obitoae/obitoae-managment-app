// Service worker de Obitoae Management — guarda en caché el "cascarón" de la
// app (HTML/CSS/JS) para que abra rápido y funcione algo sin conexión. Las
// llamadas a Supabase y a las funciones /api/* SIEMPRE van directo a la red
// (nunca se cachean), para que los datos siempre estén al día.

const CACHE_NAME = "obitoae-shell-v2";
const SHELL_FILES = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/config.js",
  "/manifest.json",
  "/portal.html",
  "/portal.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Nunca cachear llamadas a la API ni a Supabase — siempre datos frescos.
  if (url.pathname.startsWith("/api/") || url.hostname.includes("supabase.co")) {
    return; // deja pasar la petición normal, sin intervenir
  }

  // Solo intervenimos peticiones GET del mismo origen (el cascarón de la app).
  if (event.request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
