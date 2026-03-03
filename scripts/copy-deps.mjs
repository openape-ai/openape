/**
 * Post-build script: copies packages that Nitro marks as external (but aren't
 * available on Vercel) into the function output's node_modules.
 * Recursively resolves their production dependencies too.
 */
import { cpSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const funcDir = resolve(root, '.vercel/output/functions/__fallback.func')
const pnpmDir = resolve(root, 'node_modules/.pnpm')

if (!existsSync(funcDir)) {
  console.log('[copy-deps] No Vercel output found, skipping.')
  process.exit(0)
}

const pnpmEntries = readdirSync(pnpmDir)
const copied = new Set()

function findPkgDir(pkg) {
  const scope = pkg.startsWith('@') ? pkg.split('/')[0] : ''
  const name = pkg.startsWith('@') ? pkg.split('/')[1] : pkg
  const prefix = scope ? `${scope}+${name}@` : `${name}@`

  for (const entry of pnpmEntries) {
    if (entry.startsWith(prefix)) {
      const candidate = resolve(pnpmDir, entry, 'node_modules', pkg)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

function copyPkg(pkg) {
  if (copied.has(pkg)) return
  copied.add(pkg)

  const srcDir = findPkgDir(pkg)
  if (!srcDir) {
    // Package might be built-in or already bundled by Nitro
    return
  }

  const dest = resolve(funcDir, 'node_modules', pkg)
  cpSync(srcDir, dest, { recursive: true })
  console.log(`[copy-deps] ${pkg}`)

  // Recursively copy production dependencies
  const pkgJsonPath = resolve(srcDir, 'package.json')
  if (existsSync(pkgJsonPath)) {
    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'))
    const deps = pkgJson.dependencies || {}
    for (const dep of Object.keys(deps)) {
      copyPkg(dep)
    }
  }
}

// Packages that Nitro leaves as external but aren't on Vercel
const seedPackages = ['@openape/auth', '@openape/core']
for (const pkg of seedPackages) {
  copyPkg(pkg)
}

console.log(`[copy-deps] Done. Copied ${copied.size} packages.`)
