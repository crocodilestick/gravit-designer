# Vendored Workbox 5.1.4

`cacher.js` used to start with

```js
importScripts("https://storage.googleapis.com/workbox-cdn/releases/5.1.4/workbox-sw.js");
```

which meant the service worker — the part of the app responsible for
making it work offline — could only install while the browser had
internet access to Google's CDN, on an app that otherwise has no runtime
dependency on anything outside this repo. On a LAN-only or air-gapped
install it failed silently: no service worker, so no offline mode and no
PWA install.

These are those files, served from `/workbox/` instead. `cacher.js`
points the loader at them with `modulePathPrefix`.

## Files

| File                         | Loaded                                     |
| ---------------------------- | ------------------------------------------ |
| `workbox-sw.js`              | directly by `cacher.js`                    |
| `workbox-core.prod.js`       | on demand, by every other module           |
| `workbox-precaching.prod.js` | on demand, by `precacheAndRoute`           |
| `workbox-routing.prod.js`    | on demand, by `registerRoute`              |
| `workbox-strategies.prod.js` | on demand, by `NetworkFirst`               |
| `workbox-expiration.prod.js` | on demand, by `ExpirationPlugin`           |

`workbox-sw.js` resolves the others lazily, the first time something
touches `workbox.<namespace>`, so a namespace that gets added to
`cacher.js` later needs its file added here too or it will 404.

Only the production builds are vendored; `cacher.js` sets
`debug: false`, so the `.dev.js` variants are never requested.

## How to refresh

```bash
BASE=https://storage.googleapis.com/workbox-cdn/releases/5.1.4
for f in workbox-sw workbox-core.prod workbox-precaching.prod \
         workbox-routing.prod workbox-strategies.prod \
         workbox-expiration.prod; do
  curl -s "$BASE/$f.js" | sed '/^\/\/# sourceMappingURL=/d' > "$f.js"
done
```

The files are otherwise byte-identical to the CDN's. The one edit is
dropping the trailing `sourceMappingURL` comment: the `.map` files come
to ~190 KB of debug data for minified builds, and leaving the pointer in
would send the browser back to the CDN as soon as devtools opened —
exactly what vendoring is meant to stop.

Bumping the version means changing the URL above, the filenames if
upstream renames any, and nothing in `cacher.js` unless the API changes.
