import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

export function bundleCodex() {
  const require = createRequire(new URL('../package.json', import.meta.url))
  const cliRequire = createRequire(require.resolve('@openai/codex/package.json'))
  const platform = process.platform; const arch = process.arch
  if (!['darwin', 'linux'].includes(platform) || !['arm64', 'x64'].includes(arch)) throw new Error('Unsupported Codex build platform')
  const metadataPath = cliRequire.resolve(`@openai/codex-${platform}-${arch}/package.json`)
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
  if (metadata.version !== `0.153.4-${platform}-${arch}`) throw new Error('Unexpected Codex runtime version')
  const target = `${arch === 'arm64' ? 'aarch64' : 'x86_64'}-${platform === 'darwin' ? 'apple-darwin' : 'unknown-linux-musl'}`
  const binary = join(dirname(metadataPath), 'vendor', target, 'bin/codex')
  const destination = resolve('dist/vendor'); mkdirSync(destination, { recursive: true })
  copyFileSync(binary, join(destination, 'codex'))
  const home = mkdtempSync(join(tmpdir(), 'pods-build-codex-'))
  try {
    const raw = execFileSync(binary, ['debug', 'models', '--bundled'], { encoding: 'utf8', timeout: 10000, maxBuffer: 8 * 1024 * 1024, env: { HOME: home, CODEX_HOME: home, PATH: '/usr/bin:/bin' } })
    const catalog = JSON.parse(raw)
    const model = catalog.models.find(item => item.slug === 'gpt-5.5')
    if (!model) throw new Error('The pinned model is missing from the bundled catalog')
    model.apply_patch_tool_type = null; model.experimental_supported_tools = []
    const content = JSON.stringify({ models: [model] })
    writeFileSync(join(destination, 'models.json'), content)
    writeFileSync(join(destination, 'manifest.json'), JSON.stringify({ dependencyLockHash: createHash('sha256').update(readFileSync('../../pnpm-lock.yaml')).digest('hex'), sdk: '0.153.4', cli: metadata.version, binaryHash: createHash('sha256').update(readFileSync(binary)).digest('hex'), catalogHash: createHash('sha256').update(content).digest('hex'), origin: '@openai/codex npm platform package; catalog extracted with debug models --bundled' }, null, 2))
  }
  finally { rmSync(home, { recursive: true, force: true }) }
}
