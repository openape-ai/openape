import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ command, mode }) => ({
  plugins: [vue()],
  base: './',
  define: { __PODS_UI_DEMO__: command === 'serve' && mode === 'ui' },
  server: { host: '127.0.0.1', port: 5478, strictPort: true },
  build: { outDir: 'dist/renderer', emptyOutDir: true },
}))
