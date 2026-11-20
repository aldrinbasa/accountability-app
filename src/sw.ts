/// <reference lib="webworker" />
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'
import { PHOTO_CACHE_MAX_ENTRIES, PHOTO_CACHE_NAME } from '@/domain/photo-cache'

declare let self: ServiceWorkerGlobalScope

// vite-plugin-pwa (injectManifest) replaces self.__WB_MANIFEST with the build's asset list (app
// shell, fonts, icons, manifest). The one runtime cache is check-in photos (Story 3.4); push comes later.
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// SPA navigation fallback: any route (/today from the manifest start_url, a tab reload) gets the
// precached app shell, so the installed app opens offline.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')))

// Check-in photos (Story 3.4, AD-9): signed Storage URLs carry a fresh token every 10 minutes, so
// the cache key is the object URL without its query (the object path). Cache first: a photo never
// changes once uploaded. Only full 200 answers are kept (the page loads photos with CORS, so they are
// readable, never opaque), at most 150 photos, least recently used out first. Offline, the page asks
// for the token-less URL and only this cache can answer it. Separate from the outbox's blobs, which
// live in IndexedDB.
const PHOTO_PATH = '/storage/v1/object/sign/checkins/'

function withoutQuery(url: string): string {
  const parsed = new URL(url)
  return `${parsed.origin}${parsed.pathname}`
}

registerRoute(
  ({ url, request }) => request.method === 'GET' && url.pathname.includes(PHOTO_PATH),
  new CacheFirst({
    cacheName: PHOTO_CACHE_NAME,
    plugins: [
      {
        cacheKeyWillBeUsed: async ({ request }) => withoutQuery(request.url),
      },
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: PHOTO_CACHE_MAX_ENTRIES, purgeOnQuotaError: true }),
    ],
  }),
)

// Lets the page activate a waiting worker when the user accepts an update (prompt mode).
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting()
})
