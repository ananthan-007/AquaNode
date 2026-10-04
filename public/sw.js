// Minimal service worker: caches only the static app shell, never live
// device telemetry. Per Phase 15/22: cached data must never be shown as if
// it were current — device_state/commands responses are intentionally
// excluded from the cache below.
//
// HTML navigations are network-first so a new deploy is not hydrated against
// a stale cached document (that mismatch looks like a React hydration error).
const SHELL_CACHE = "aquaguard-shell-v3";
const SHELL_ASSETS = ["/login", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never intercept API/data or auth-callback calls — those must always hit
  // the network so stale data is never silently served as live.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;

  const accept = event.request.headers.get("accept") ?? "";
  const isDocument =
    event.request.mode === "navigate" || accept.includes("text/html");

  if (isDocument) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((res) => res)
      .catch(() => caches.match(event.request))
  );
});
