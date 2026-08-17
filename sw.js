// Service worker de Obitoae Management — guarda en caché el "cascarón" de la
// app (HTML/CSS/JS) como respaldo para cuando no hay conexión. Las llamadas a
// Supabase y a las funciones /api/* SIEMPRE van directo a la red (nunca se
// cachean), para que los datos siempre estén al día.
//
// Importante: sube este número (v3, v4, ...) cada vez que subas un cambio de
// código, para que los navegadores/celulares que ya tenían la app instalada
// se enteren de que hay una versión nueva.
const CACHE_NAME = "obitoae-shell-v3";
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
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
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

  // Red primero, caché solo como respaldo (sin conexión) — así cada cambio
  // que subas se ve de inmediato, sin tener que recargar varias veces.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
