// `apes nest authorize` — set the YOLO-policy on the local nest's
// DDISA-agent identity so its grant-creation hits auto-approve.
//
// Why YOLO (not capability-grants alone): apes-side `findExistingGrant`
// matches capability-grants with selector globs across agent names —
// that part works. But the underlying escapes-helper verifies grants
// independently with exact-arg matching. So a `name=*` capability-grant
// alone doesn't deliver zero-prompt spawn.
//
// YOLO sits at the IdP grant-creation layer, before the apes/escapes
// dance: when nest's identity requests a grant, the IdP evaluates the
// joined command line against the nest's allow_patterns; if a glob
// matches, the grant is auto-approved (`auto_approval_kind: 'yolo'`)
// without any prompt. The token then verifies cleanly through both
// apes shapes and escapes.
//
// Default patterns cover the nest-managed agent lifecycle: spawn /
// destroy / sync, plus the bridge-invocation the supervisor uses.
// Everything else stays human-approval (default deny in allow-list mode).

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineCommand } from 'citty'
import consola from 'consola'
import { getIdpUrl, loadAuth } from '../../config'
import { CliError } from '../../errors'
import { NEST_DATA_DIR } from './enroll'

interface NestAuth {
  email: string
}

const DEFAULT_ALLOW_PATTERNS = [
  // Agent lifecycle ops the nest issues against `apes run --as root`
  'apes agents spawn *',
  'apes agents destroy *',
  'apes agents sync',
  // Bridge invocation the supervisor uses to keep agent processes
  // running. Pattern is intentionally precise — not a generic
  // `apes run --as *` wildcard — so a compromised nest can't pivot
  // to running arbitrary commands as arbitrary users.
  'apes run --as * -- openape-chat-bridge',
]

export const authorizeNestCommand = defineCommand({
  meta: {
    name: 'authorize',
    description: 'Set the YOLO-policy that lets the local nest spawn/destroy without per-call DDISA prompts',
  },
  args: {
    'allow': {
      type: 'string',
      description: 'Override allow_patterns (comma-separated globs). Default: nest-managed agent lifecycle.',
    },
    'mode': {
      type: 'string',
      description: 'Policy mode (allow-list | deny-list). Default: allow-list — auto-approve only matched patterns.',
    },
    'expires-in': {
      type: 'string',
      description: 'Optional duration like 30d, 6h. Omit for no expiry.',
    },
  },
  async run({ args }) {
    const ownerAuth = loadAuth()
    if (!ownerAuth?.email || !ownerAuth.access_token) {
      throw new CliError('Run `apes login <email>` first — only the nest\'s owner can set its YOLO-policy.')
    }

    // Read the nest's enrolled email — `apes nest enroll` puts it here.
    const nestAuthPath = join(NEST_DATA_DIR, '.config', 'apes', 'auth.json')
    if (!existsSync(nestAuthPath)) {
      throw new CliError('Nest not enrolled. Run `apes nest enroll` first.')
    }
    const nestAuth = JSON.parse(readFileSync(nestAuthPath, 'utf8')) as NestAuth
    if (!nestAuth.email) throw new CliError(`${nestAuthPath} has no email`)

    const idp = getIdpUrl()
    if (!idp) throw new CliError('No IdP configured.')
    const allowPatterns = typeof args.allow === 'string' && args.allow
      ? args.allow.split(',').map(s => s.trim()).filter(Boolean)
      : DEFAULT_ALLOW_PATTERNS
    const mode = (args.mode as string | undefined) ?? 'allow-list'
    const expiresAt = parseExpiresIn(args['expires-in'] as string | undefined)

    consola.info(`Setting YOLO-policy on ${nestAuth.email}`)
    consola.info(`  mode:           ${mode}`)
    consola.info(`  allow_patterns:`)
    for (const p of allowPatterns) consola.info(`    - ${p}`)
    if (expiresAt) consola.info(`  expires_at:     ${new Date(expiresAt * 1000).toISOString()}`)

    const url = `${idp}/api/users/${encodeURIComponent(nestAuth.email)}/yolo-policy`
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${ownerAuth.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        mode,
        allowPatterns,
        denyPatterns: [],
        expiresAt: expiresAt ?? null,
      }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new CliError(`PUT /yolo-policy failed (${res.status}): ${text}`)
    }
    consola.success('YOLO-policy applied. Nest-driven agent lifecycle is now zero-prompt.')
    consola.info('Test: apes agents spawn <name> via the nest API → no DDISA prompt.')
  },
})

function parseExpiresIn(s: string | undefined): number | null {
  if (!s) return null
  const m = s.match(/^(\d+)([hdw])$/)
  if (!m) throw new CliError(`Invalid --expires-in "${s}" — expected forms like 30d, 6h, 2w`)
  const n = Number(m[1])
  const unit = m[2]
  const seconds = unit === 'h' ? 3600 : unit === 'd' ? 86400 : 7 * 86400
  return Math.floor(Date.now() / 1000) + n * seconds
}
