import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5100,
    proxy: {
      '/api': {
        target: 'http://localhost:5101',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:5101',
        changeOrigin: true,
        ws: true,
      },
      '/media': {
        target: 'http://localhost:5101',
        changeOrigin: true,
      },
      '/references': {
        target: 'http://localhost:5101',
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test-setup.ts',
  },
})
