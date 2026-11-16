/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'

declare let self: ServiceWorkerGlobalScope

// Precache-only service worker: vite-plugin-pwa (injectManifest) replaces self.__WB_MANIFEST
// with the build's asset list. Runtime caching, push and the update prompt come later.
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// Lets the page activate a waiting worker when the user accepts an update (prompt mode).
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting()
})
