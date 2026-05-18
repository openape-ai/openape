import { existsSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CANDIDATES = [
  '/etc/ssl/cert.pem', // macOS
  '/etc/ssl/certs/ca-certificates.crt', // Debian / Ubuntu
  '/etc/pki/tls/certs/ca-bundle.crt', // RHEL / Fedora
  '/etc/ssl/ca-bundle.pem', // OpenSUSE
]

export function detectSystemCaPath(): string {
  for (const p of CANDIDATES) {
    if (existsSync(p)) return p
  }
  throw new Error(
    `Could not locate a system CA bundle. Tried: ${CANDIDATES.join(', ')}. `
    + `Set NODE_EXTRA_CA_CERTS yourself or pass --allow-no-system-ca.`,
  )
}

export interface TrustBundle {
  path: string
  cleanup: () => void
}

export function buildTrustBundle(opts: { systemCaPath: string, localCaPath: string }): TrustBundle {
  const dir = mkdtempSync(join(tmpdir(), 'openape-trust-'))
  const path = join(dir, 'bundle.pem')
  const sys = readFileSync(opts.systemCaPath, 'utf-8')
  const local = readFileSync(opts.localCaPath, 'utf-8')
  writeFileSync(path, `${sys.trimEnd()}\n${local.trimEnd()}\n`, { mode: 0o600 })
  return {
    path,
    cleanup: () => {
      try { unlinkSync(path) }
      catch { /* ignore */ }
      try { rmdirSync(dir) }
      catch { /* ignore */ }
    },
  }
}
