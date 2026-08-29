/* eslint-disable no-restricted-globals */
//
// Service worker for M.L AI Manager.
//
// Two jobs: keep the app usable when the phone drops off the network, and
// receive push notifications. Both are done conservatively, because this
// app shows money owed - a cached figure presented as a live one would be
// worse than no app at all. So:
//
//   * Pages are network-first. The cache is only ever a fallback, and when
//     it is used the page gets a banner saying so, with the time the copy
//     was taken.
//   * API responses are never cached. Overdue totals change through the
//     day; serving yesterday's JSON silently into today's screen is exactly
//     the failure mode to avoid.
//   * Static build assets are cache-first - they are content-hashed by
//     Next.js, so a cached one can never be the wrong version.
//   * Nothing is cached from /login or the auth routes, and the whole cache
//     is dropped on logout, so a signed-out phone cannot page back into the
//     books.

const VERSION = "v1";
const SHELL_CACHE = `mlm-shell-${VERSION}`;
const PAGE_CACHE = `mlm-pages-${VERSION}`;
const OFFLINE_URL = "/offline";

const SHELL_ASSETS = [OFFLINE_URL, "/icons/icon-192.png", "/icons/apple-touch-icon.png", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // Individually, so one missing asset doesn't fail the whole install.
      .then((cache) => Promise.all(SHELL_ASSETS.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== PAGE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The page asks for this on logout. Anything cached while signed in has to
// go with the session.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "CLEAR_CACHE") {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
  }
});

/** Paths whose responses must never be written to the cache. */
function isUncacheable(url) {
  return (
    url.pathname.startsWith("/api/") ||
    url.pathname === "/login" ||
    url.pathname.startsWith("/_next/image")
  );
}

function isStaticAsset(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");
}

/** Copies a response, stamping when it was stored so the offline banner can
 * say how old the page on screen is. */
async function cacheWithTimestamp(cacheName, request, response) {
  const body = await response.clone().arrayBuffer();
  const headers = new Headers(response.headers);
  headers.set("x-mlm-cached-at", new Date().toISOString());
  const cache = await caches.open(cacheName);
  await cache.put(request, new Response(body, { status: response.status, statusText: response.statusText, headers }));
}

/**
 * The banner has to be injected as a script rather than as plain markup.
 * The cached page is a React app, and hydration treats any element it
 * didn't render as a stray node and removes it - so a hand-spliced <div>
 * appears for an instant and then vanishes, which is worse than never
 * showing it. A script runs at parse time (surviving whatever React does to
 * the DOM afterwards) and can re-insert the banner once hydration is done.
 */
function offlineBannerScript(when) {
  const message = `Offline - yeh page ${when} ka hai. Numbers badal sakte hain; internet aane par refresh karein.`;
  return `<script>(function(){
  var id='mlm-offline-banner';
  function ensure(){
    if(document.getElementById(id)||!document.body)return;
    var d=document.createElement('div');
    d.id=id;
    d.setAttribute('style','position:sticky;top:0;z-index:9999;background:#B45309;color:#fff;padding:10px 14px;font:600 13px/1.4 system-ui,sans-serif');
    d.textContent=${JSON.stringify(message)};
    document.body.insertBefore(d,document.body.firstChild);
  }
  ensure();
  // React hydration removes any node it did not render, so the banner has
  // to be put back once - and the exact moment hydration finishes is not
  // observable from here. Re-checking briefly is the reliable way.
  var until=Date.now()+6000;
  var t=setInterval(function(){ensure();if(Date.now()>until)clearInterval(t);},200);
})();<\/script>`;
}

function describeWhen(iso) {
  if (!iso) return "purana copy";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "abhi";
  if (mins < 60) return `${mins} minute pehle`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} ghante pehle`;
  return `${Math.round(hours / 24)} din pehle`;
}

/** Serves a cached page with an honest "this is stale" banner spliced in. */
async function offlinePage(request) {
  const cached = await caches.match(request);
  if (cached) {
    const html = await cached.text();
    const banner = offlineBannerScript(describeWhen(cached.headers.get("x-mlm-cached-at")));
    const withBanner = html.includes("</body>") ? html.replace("</body>", `${banner}</body>`) : html + banner;
    return new Response(withBanner, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  const fallback = await caches.match(OFFLINE_URL);
  return (
    fallback ||
    new Response("<h1>Offline</h1><p>Is page ka koi copy save nahi hai.</p>", {
      status: 503,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            if (res.ok) caches.open(SHELL_CACHE).then((c) => c.put(request, res.clone()));
            return res;
          }),
      ),
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          // A redirect to /login means the session is gone - don't store it
          // over the real page, or the offline copy becomes a login screen.
          if (res.ok && !isUncacheable(url) && !res.redirected) {
            cacheWithTimestamp(PAGE_CACHE, request, res).catch(() => {});
          }
          return res;
        })
        .catch(() => offlinePage(request)),
    );
  }
  // Everything else (API JSON above all) goes straight to the network,
  // deliberately unhandled and uncached.
});

// ---------------------------------------------------------------------------
// Push notifications
// ---------------------------------------------------------------------------

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "M.L AI Manager", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "M.L AI Manager";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      // A daily digest replaces the previous one instead of stacking up a
      // week of near-identical alerts on the lock screen.
      tag: payload.tag || "mlm",
      renotify: true,
      data: { url: payload.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Reuse an already-open tab rather than piling up new ones.
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
