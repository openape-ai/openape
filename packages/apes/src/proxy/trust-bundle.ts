import { existsSync } from 'node:fs'

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
