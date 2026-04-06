import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import ui from '@nuxt/ui/vite'

export default defineConfig({
  root: 'app',
  plugins: [vue(), ui()],
  build: {
    outDir: '../public',
    emptyOutDir: true,
  },
  server: {
    port: 3001,
    proxy: {
      '/api': 'http://localhost:3000',
      '/.well-known': 'http://localhost:3000',
      '/authorize': 'http://localhost:3000',
      '/token': 'http://localhost:3000',
    },
  },
})
