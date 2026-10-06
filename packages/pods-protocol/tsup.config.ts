import { defineConfig } from 'tsup'

export default defineConfig({ entry: ['src/index.ts', 'src/crypto.ts'], format: ['esm'], dts: true, clean: true })
