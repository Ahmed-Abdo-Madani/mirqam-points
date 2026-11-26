import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig(({ mode, isSsrBuild }) => ({
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
  ],
  server: {
    port: 5174,
    strictPort: true,
    proxy: { '/api': { target: 'http://localhost:4100' } },
  },
  // The SSR build (src/prerender.jsx) only renders HTML: it needs no copy of public/.
  build: { sourcemap: true, chunkSizeWarningLimit: 700, copyPublicDir: !isSsrBuild },
}))
