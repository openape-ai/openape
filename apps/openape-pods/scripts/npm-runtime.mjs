import { cpSync, mkdirSync, realpathSync } from 'node:fs'

export function bundleNpm() {
  mkdirSync('dist/vendor', { recursive: true })
  cpSync(realpathSync('node_modules/npm'), 'dist/vendor/npm', { recursive: true, dereference: true })
}
