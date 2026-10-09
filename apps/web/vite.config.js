import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    strictPort: true,
    // The API runs on :4100 in development; the browser only ever talks to one origin.
    proxy: { '/api': { target: 'http://localhost:4100' } },
  },
  build: { sourcemap: true, chunkSizeWarningLimit: 700 },
})
