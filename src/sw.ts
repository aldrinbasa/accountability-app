/// <reference lib="webworker" />
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare let self: ServiceWorkerGlobalScope

// Precache-only service worker: vite-plugin-pwa (injectManifest) replaces self.__WB_MANIFEST
// with the build's asset list (app shell, fonts, icons, manifest). Runtime caching and push come later.
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// SPA navigation fallback: any route (/today from the manifest start_url, a tab reload) gets the
// precached app shell, so the installed app opens offline.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')))

// Lets the page activate a waiting worker when the user accepts an update (prompt mode).
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting()
})
