/* ═══════════════════════════════════════════════════════════════
   ZENITH — Service Worker  v5
   Root cause of "Response body is already used":
     Every fire-and-forget cache.put() was a detached Promise with
     no .catch(). When Chrome surfaced its rejection, it pointed to
     the nearest synchronous line above it — the response.clone() call.
     Fix: every cache.put() is caught; every strategy has a top-level
     .catch() so nothing becomes "Uncaught (in promise)".
═══════════════════════════════════════════════════════════════ */

var CACHE_VER     = "zenith-v5";   // bumped: fonts async, audio preload=none, cache headers
var STATIC_CACHE  = CACHE_VER + "-static";
var RUNTIME_CACHE = CACHE_VER + "-runtime";
var FONT_CACHE    = CACHE_VER + "-fonts";

/* ─── Cache lifetime constants ────────────────────────────────
   Lighthouse "Use efficient cache lifetimes": the browser's HTTP
   cache ignores SW caches, so we wrap cached responses in a new
   Response that carries Cache-Control headers — this satisfies
   repeat-visit latency savings AND the audit.
─────────────────────────────────────────────────────────────── */
var ONE_YEAR   = 31536000;   // immutable versioned assets (icons, audio, fonts)
var ONE_WEEK   = 604800;     // semi-static (CSS, JS without hash)
var ONE_DAY    = 86400;      // HTML documents

/**
 * Clone a Response and attach a Cache-Control header so the
 * browser's own HTTP cache benefits on the next request.
 * @param {Response} response
 * @param {number}   maxAge   seconds
 */
function _withCacheHeaders(response, maxAge) {
  var headers = new Headers(response.headers);
  // Don't overwrite explicit no-store directives
  var existing = headers.get('Cache-Control') || '';
  if (existing.indexOf('no-store') !== -1) return response;
  headers.set('Cache-Control', 'public, max-age=' + maxAge + ', stale-while-revalidate=86400');
  // Clone first so the original response body is not consumed here.
  // Callers that need to both cache AND return the response to the browser
  // must clone *before* calling this function, then pass the clone.
  var cloned = response.clone();
  return new Response(cloned.body, {
    status:     cloned.status,
    statusText: cloned.statusText,
    headers:    headers,
  });
}

var PRECACHE_URLS = [
  /* ── App shell ── */
  "/",
  "/index.html",
  "/offline.html",
  "/manifest.json",

  /* ── CSS (9) ──────────────────────────────────────────────────
     All stylesheets must be precached so the UI renders correctly
     offline. The stale-while-revalidate fetch strategy updates
     them in the background on subsequent visits, but precaching
     here guarantees they exist from the very first install.     */
  "/analytics.css",
  "/app.css",
  "/music-ai.css",
  "/phase1-glass.css",
  "/phase3.css",
  "/phase4.css",
  "/phase6.css",
  "/phase-sync-challenges.css",
  "/pipeline.css",

  /* ── JavaScript (17) ──────────────────────────────────────────
     service-worker.js is intentionally excluded — the browser
     manages SW script fetching outside the cache API.
     main.js and preload.js are Electron-only; not served on web. */
  "/adaptive-focus.js",
  "/ai-coach.js",
  "/analytics-engine.js",
  "/analytics-ui.js",
  "/app.js",
  "/cognitive-dashboard.js",
  "/distraction-lock.js",
  "/focus-music-ai.js",
  "/phase1-electron.js",
  "/phase4-gamification.js",
  "/session-replay.js",
  "/zenith-bridge.js",
  "/zenith-challenges.js",
  "/zenith-db.js",
  "/zenith-notifications.js",
  "/zenith-sync.js",
  "/zenith-updater.js",

  /* ── Icons ── */
  "/assets/icons/favicon-72.png",
  "/assets/icons/favicon-96.png",
  "/assets/icons/favicon-128.png",
  "/assets/icons/favicon-192.png",
  "/assets/icons/favicon-256.png",
  "/assets/icons/favicon-384.png",
  "/assets/icons/favicon-512.png",
  "/assets/icons/logo.webp",
  "/assets/icons/app.ico",

  /* ── Splash ── */
  "/assets/splash/splash-640x1136.png",
  "/assets/splash/splash-1125x2436.png",
  "/assets/splash/splash-1242x2688.png",

  /* ── Screenshots ── */
  "/assets/screenshots/focus-mobile.png",
  "/assets/screenshots/task-mobile.png",
  "/assets/screenshots/home-desk.png",
  "/assets/screenshots/focus-desk.png",
  "/assets/screenshots/task-desk.png",
  "/assets/screenshots/home-desk.png",

  /* ── Audio ── (NOT precached at install — loaded lazily on first play.
     Precaching ~3 MB of audio at install time cancels out the LCP
     benefit of preload="none" on the <audio> elements in index.html.
     The cacheFirst fetch strategy will cache each file on first request.) */
];

/* Audio files that get cached on-demand via cacheFirst, not at install. */
var AUDIO_URLS = [
  "/assets/sounds/session-end.mp3",
  "/assets/sounds/break-end.mp3",
  "/assets/sounds/long-break-end.mp3",
  "/assets/sounds/meditation-soft.mp3",
  "/assets/sounds/focus.mp3",
  "/assets/sounds/rain.mp3",
  "/assets/sounds/forest.mp3",
  "/assets/sounds/noise.mp3",
  "/assets/sounds/library.mp3"
];

var STATIC_RE = /\.(png|jpg|jpeg|svg|webp|ico|woff2?|ttf|otf|mp3|ogg|wav)$/i;

/* ── INSTALL ── */
self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(function (cache) {
      /*
       * Promise.allSettled — one missing file never aborts the whole install.
       * redirect:'follow' prevents a redirect response from being cached
       * (which would cause the "Avoid multiple page redirects" audit to flag
       * every page load served from the SW cache).
       * We also inject long-lived cache headers so the browser's own HTTP
       * cache benefits too (fixes "Use efficient cache lifetimes" audit).
       */
      return Promise.allSettled(
        PRECACHE_URLS.map(function (url) {
          return fetch(url, { cache: 'no-cache', redirect: 'follow' })
            .then(function (res) {
              if (res.ok) {
                var withHeaders = _withCacheHeaders(res, ONE_YEAR);
                return cache.put(url, withHeaders);
              }
            })
            .catch(function () {
              /* silently skip missing assets (e.g. screenshots not deployed yet) */
            });
        })
      );
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

/* ── ACTIVATE ── */
self.addEventListener("activate", function (event) {
  var KEEP = [STATIC_CACHE, RUNTIME_CACHE, FONT_CACHE];
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (k) { return KEEP.indexOf(k) === -1; })
            .map(function (k) { return caches.delete(k); })
        );
      })
      .then(function () { return self.clients.claim(); })
      .then(function () {
        /* Cache audio files in the background AFTER activate so they never
           block install or LCP. Uses STATIC_CACHE so cacheFirst serves them
           on subsequent requests without hitting the network. */
        return caches.open(STATIC_CACHE).then(function (cache) {
          return Promise.allSettled(
            AUDIO_URLS.map(function (url) {
              return cache.match(url).then(function (hit) {
                if (hit) return; // already cached — skip
                return fetch(url, { cache: 'no-cache', redirect: 'follow' })
                  .then(function (res) {
                    if (res && res.ok) {
                      return cache.put(url, _withCacheHeaders(res, ONE_YEAR));
                    }
                  })
                  .catch(function () { /* network unavailable — will cache on first play */ });
              });
            })
          );
        });
      })
  );
});

/* ── FETCH ── */
self.addEventListener("fetch", function (event) {
  var req = event.request;
  var url;

  /* Only intercept GET over http/https */
  if (req.method !== "GET") return;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  /* Google Font binary files → cache-first, 1 year (immutable) */
  if (url.hostname === "fonts.gstatic.com") {
    event.respondWith(cacheFirst(req, FONT_CACHE, ONE_YEAR));
    return;
  }
  /* Google Font CSS → stale-while-revalidate, 1 day */
  if (url.hostname === "fonts.googleapis.com") {
    event.respondWith(staleWhileRevalidate(req, FONT_CACHE, ONE_DAY));
    return;
  }
  /* Local static assets (icons, audio, images) → cache-first, 1 year */
  if (STATIC_RE.test(url.pathname)) {
    event.respondWith(cacheFirst(req, STATIC_CACHE, ONE_YEAR));
    return;
  }
  /* CSS / JS → stale-while-revalidate, 1 week */
  if (/\.(css|js)$/i.test(url.pathname) && url.hostname === self.location.hostname) {
    event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE, ONE_WEEK));
    return;
  }
  /* HTML navigation → stale-while-revalidate + offline fallback */
  if (req.mode === "navigate") {
    event.respondWith(navigationHandler(req));
    return;
  }
  /* Everything else → network-first */
  event.respondWith(networkFirst(req, RUNTIME_CACHE));
});

/* ── MESSAGES ── */
self.addEventListener("message", function (event) {
  /* VEERFLOW.html sends "SKIP_WAITING" when a new SW is waiting */
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  /* showSWNotification() sends { type: "SHOW_NOTIFICATION", title, body, url } */
  if (event.data && event.data.type === "SHOW_NOTIFICATION") {
    event.waitUntil(
      self.registration.showNotification(event.data.title || "ZENITH", {
        body:     event.data.body  || "",
        icon:     "/assets/icons/favicon-192.png",
        badge:    "/assets/icons/favicon-96.png",
        tag:      "zenith-notif",
        renotify: true,
        vibrate:  [120, 60, 120],
        data:     { url: event.data.url || "/" }
      })
    );
  }
});

/* ── NOTIFICATION CLICK ── */
self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true })
      .then(function (wins) {
        var existing = wins.find(function (w) {
          return w.url.indexOf(self.location.origin) === 0;
        });
        if (existing) return existing.focus();
        return clients.openWindow(target);
      })
  );
});

/* ════════════════════════════════════════════════════════════════
   STRATEGY IMPLEMENTATIONS
════════════════════════════════════════════════════════════════ */

function noop() {}

/* ── Cache-First ──────────────────────────────────────────────
   Serve from cache; fetch + store on miss.
   Best for: icons, audio, font files — assets that never change. */
function cacheFirst(req, cacheName, maxAge) {
  maxAge = maxAge || ONE_YEAR;
  return caches.match(req)
    .then(function (cached) {
      if (cached) return cached; // already has injected headers from previous store

      return fetch(req, { redirect: 'follow' })
        .then(function (response) {
          if (response && (response.ok || response.type === 'opaque')) {
            var withHeaders = _withCacheHeaders(response.clone(), maxAge);
            caches.open(cacheName)
              .then(function (cache) { return cache.put(req, withHeaders); })
              .catch(noop);
          }
          return response;
        })
        .catch(function () {
          return offlinePlaceholder(req);
        });
    })
    .catch(function () {
      return offlinePlaceholder(req);
    });
}

/* ── Stale-While-Revalidate ── */
function staleWhileRevalidate(req, cacheName, maxAge) {
  maxAge = maxAge || ONE_WEEK;
  return caches.open(cacheName)
    .then(function (cache) {
      return cache.match(req)
        .then(function (cached) {

          /* Fire a background revalidation; always catch so the
             detached Promise never becomes an unhandled rejection. */
          var networkUpdate = fetch(req, { redirect: 'follow' })
            .then(function (response) {
              if (response && (response.ok || response.type === 'opaque')) {
                var withHeaders = _withCacheHeaders(response.clone(), maxAge);
                cache.put(req, withHeaders).catch(noop);
              }
              return response;
            })
            .catch(function () {
              /* Network failed — return placeholder so this branch
                 never resolves to null when used as a fallback. */
              return offlinePlaceholder(req);
            });

          if (cached) {
            /* Serve stale immediately; let networkUpdate finish in bg. */
            networkUpdate.catch(noop);
            return cached;
          }

          /* No cached copy — wait for the network result (already
             guaranteed to be a Response, never null). */
          return networkUpdate;
        });
    })
    .catch(function () {
      /* caches.open() or cache.match() threw — fall back gracefully. */
      return fetch(req, { redirect: 'follow' })
        .catch(function () { return offlinePlaceholder(req); });
    });
}

/* ── Network-First ── */
function networkFirst(req, cacheName) {
  return fetch(req, { redirect: 'follow' })
    .then(function (response) {
      if (response && response.ok) {
        var withHeaders = _withCacheHeaders(response.clone(), ONE_DAY);
        caches.open(cacheName)
          .then(function (cache) { return cache.put(req, withHeaders); })
          .catch(noop);
      }
      return response;
    })
    .catch(function () {
      return caches.match(req)
        .then(function (cached) {
          return cached || offlinePlaceholder(req);
        })
        .catch(function () { return offlinePlaceholder(req); });
    });
}

/* ── Navigation Handler ── */
function navigationHandler(req) {
  /* For navigation, always follow redirects at the fetch level
     so we never store a redirect response in cache */
  var directReq = new Request(req.url, {
    method:      req.method,
    headers:     req.headers,
    credentials: req.credentials,
    redirect:    'follow',          // ← key fix for redirect audit
  });

  return caches.open(STATIC_CACHE)
    .then(function (cache) {
      return cache.match(directReq, { ignoreSearch: true })
        .then(function (cached) {

          var networkUpdate = fetch(directReq)
            .then(function (response) {
              if (response && response.ok) {
                var withHeaders = _withCacheHeaders(response.clone(), ONE_DAY);
                var cleanUrl = new URL(response.url || req.url);
                cleanUrl.search = "";
                cleanUrl.hash   = "";
                cache.put(cleanUrl.toString(), withHeaders).catch(noop);
              }
              return response;
            })
            .catch(function () { return null; });

          if (cached) {
            networkUpdate.catch(noop);
            return cached;
          }

          return networkUpdate.then(function (live) {
            if (live) return live;
            return cache.match("/offline.html", { ignoreSearch: true })
              .then(function (offline) {
                return offline || new Response(
                  "<html><body><h1>You are offline</h1><a href='/'>Retry</a></body></html>",
                  { headers: { "Content-Type": "text/html" } }
                );
              });
          });
        });
    })
    .catch(function () {
      return caches.match("/offline.html")
        .catch(function () {
          return new Response("Offline", { status: 503 });
        });
    });
}

/* ── Offline Placeholders ─── */
function offlinePlaceholder(req) {
  var dest = req.destination;

  if (dest === "image") {
    /* Small branded SVG so broken-image boxes never appear. */
    return new Response(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">' +
        '<rect width="100" height="100" fill="#0b1220"/>' +
        '<text x="50" y="54" text-anchor="middle" fill="#4f9cf9" ' +
        'font-size="10" font-family="system-ui,sans-serif">offline</text>' +
      '</svg>',
      { headers: { "Content-Type": "image/svg+xml" } }
    );
  }

  if (dest === "style") {
    /* Empty stylesheet — browser applies no styles, logs no error. */
    return new Response("", {
      status:  200,
      headers: { "Content-Type": "text/css" }
    });
  }

  if (dest === "font") {
    /* Fonts can't be faked; return empty 200 so the browser stops
       trying to decode the body and doesn't log a network error.
       Text falls back to system fonts automatically. */
    return new Response("", {
      status:  200,
      headers: { "Content-Type": "font/woff2" }
    });
  }

  if (dest === "script") {
    /* Empty JS module — prevents "Failed to load resource" for
       non-critical scripts while keeping execution silent. */
    return new Response("", {
      status:  200,
      headers: { "Content-Type": "application/javascript" }
    });
  }

  /* audio / video / fetch (XHR) — 503 is fine; these handle it
     gracefully at the application layer (audio just doesn't play). */
  return new Response("", { status: 503, statusText: "Service Unavailable" });
}
