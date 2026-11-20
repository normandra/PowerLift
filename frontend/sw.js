const CACHE_NAME = "pairlift-shell-v9";
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/styles.css?v=9",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon.svg",
  "./assets/companions/cat-squat.png",
  "./assets/companions/cat-bench.png",
  "./assets/companions/cat-deadlift.png",
  "./assets/companions/dog-squat.png",
  "./assets/companions/dog-bench.png",
  "./assets/companions/dog-deadlift.png",
  "./assets/companions/gorilla-squat.png",
  "./assets/companions/gorilla-bench.png",
  "./assets/companions/gorilla-deadlift.png",
  "./assets/companions/cat-squat.gif",
  "./assets/companions/cat-bench.gif",
  "./assets/companions/cat-deadlift.gif",
  "./assets/companions/dog-squat.gif",
  "./assets/companions/dog-bench.gif",
  "./assets/companions/dog-deadlift.gif",
  "./assets/companions/gorilla-squat.gif",
  "./assets/companions/gorilla-bench.gif",
  "./assets/companions/gorilla-deadlift.gif",
  "./js/app.js?v=9",
  "./js/api.js",
  "./js/cloud.js",
  "./js/localStore.js",
  "./js/plansEngine.js",
  "./js/state.js",
  "./js/charts.js",
  "./js/modals.js",
  "./js/share.js",
  "./js/views/auth.js",
  "./js/views/today.js",
  "./js/views/weekly.js",
  "./js/views/progress.js",
  "./js/views/partner.js",
  "./js/views/setup.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).catch(() => {})
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
  if (event.request.method !== "GET" || url.pathname.includes("/api/")) {
    return;
  }

  if (event.request.mode === "navigate") {
    if (url.search.includes("code=") || url.search.includes("error=")) {
      event.respondWith(fetch(event.request));
      return;
    }
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy));
          return res;
        })
        .catch(() => caches.match("./index.html").then((r) => r || caches.match("./")))
    );
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return res;
        })
        .catch(() => caches.match(event.request))
    );
  }
});
