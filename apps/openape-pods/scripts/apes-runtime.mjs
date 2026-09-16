import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { build } from 'tsup'

export async function bundleApes() {
  const source = resolve('../../packages/apes')
  const version = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).version
  await build({ entry: { 'ape-shell': join(source, 'src/cli.ts') }, format: ['esm'], platform: 'node', target: 'node24', outDir: 'dist/vendor/apes', clean: true, banner: { js: 'import { createRequire as createBundleRequire } from \'node:module\'; const require = createBundleRequire(import.meta.url);' }, splitting: false, removeNodeProtocol: false, noExternal: [/.*/], external: ['@lydell/node-pty'], define: { __VERSION__: JSON.stringify(version) }, outExtension: () => ({ js: '.mjs' }) })
  const require = createRequire(join(source, 'package.json'))
  const pty = dirname(require.resolve('@lydell/node-pty'))
  let native = dirname(createRequire(join(pty, 'index.js')).resolve(`@lydell/node-pty-${process.platform}-${process.arch}`))
  while (!existsSync(join(native, 'package.json'))) native = dirname(native)
  const destination = 'dist/vendor/apes/node_modules/@lydell'
  mkdirSync(destination, { recursive: true })
  cpSync(pty, join(destination, 'node-pty'), { recursive: true, filter: path => !path.slice(pty.length).includes('/node_modules') })
  cpSync(native, join(destination, `node-pty-${process.platform}-${process.arch}`), { recursive: true })
  writeFileSync('dist/vendor/apes/version.json', JSON.stringify({ version, platform: process.platform, architecture: process.arch }))
}
