import { rmSync } from 'node:fs'
import { join } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'mobile-no-marketing-measurement',
      transformIndexHtml: {
        order: 'pre',
        handler(html) {
          if (mode !== 'mobile') return html
          return html
            .replace(/<link\b[^>]*href=["']\/marketing-consent\.css["'][^>]*>/gi, '')
            .replace(/<script\b[^>]*src=["']\/marketing-consent\.js["'][^>]*>[\s\S]*?<\/script>/gi, '')
        },
      },
    },
    {
      // The phone app never offers the Android download, so it does not carry
      // the 35 MB APK from public/downloads (keeps the store app and its live
      // updates small).
      name: 'mobile-no-downloads',
      apply: 'build',
      closeBundle() {
        if (mode === 'mobile') rmSync(join(import.meta.dirname, 'dist-mobile', 'downloads'), { recursive: true, force: true })
      },
    },
  ],
  server: {
    port: 5174,
    strictPort: true,
    proxy: { '/api': { target: 'http://localhost:4100' } },
  },
  build: { sourcemap: true, chunkSizeWarningLimit: 700 },
}))
