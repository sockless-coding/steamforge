/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const apiTarget = process.env.SF_API_URL ?? 'http://localhost:5220'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'SteamForge',
        short_name: 'SteamForge',
        description: 'A steampunk colony builder of brass, coal and steam.',
        theme_color: '#1a1410',
        background_color: '#0e0b09',
        display: 'fullscreen',
        orientation: 'landscape',
        start_url: '/',
        scope: '/',
        categories: ['games', 'strategy', 'simulation'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallbackDenylist: [/^\/api\//],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        runtimeCaching: [
          {
            // Content is also cached in IndexedDB by the app; this lets a cold offline start still boot.
            urlPattern: ({ url }) => url.pathname === '/api/content',
            handler: 'NetworkFirst',
            options: { cacheName: 'sf-content', networkTimeoutSeconds: 4 },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/health': { target: apiTarget, changeOrigin: true },
    },
  },
  build: {
    outDir: '../SF.Application/wwwroot',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/node_modules[/]three[/]/.test(id)) return 'three'
          if (/node_modules[/](react|react-dom|react-router|react-router-dom|@tanstack|scheduler)[/]/.test(id)) return 'react'
          return undefined
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
