import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/  |  Tailwind v4 uses the @tailwindcss/vite plugin (CSS-first, no tailwind.config.js)
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Our own service worker (src/sw.ts). Workbox only injects the precache manifest into it.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // Prompt-to-refresh: a new worker waits until the member taps Update on the "Update ready."
      // toast (src/app/update-prompt.tsx) or the app cold-starts again. No clientsClaim/skipWaiting.
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'Proofy',
        short_name: 'Proofy',
        description: 'Commit with your friends, prove it with a photo.',
        id: '/',
        start_url: '/today',
        scope: '/',
        display: 'standalone',
        background_color: '#F6EEE3',
        theme_color: '#F6EEE3',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      injectManifest: {
        // Fonts and icons are precached so the app renders offline after one visit.
        globPatterns: ['**/*.{js,css,html,svg,woff2,png,webmanifest}'],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Bind to the LAN so a phone on the same network can reach the dev server.
    host: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Unit and component tests only; e2e/** is Playwright's (npm run test:e2e).
    include: ['src/**/*.test.{ts,tsx}'],
    css: true,
  },
})
