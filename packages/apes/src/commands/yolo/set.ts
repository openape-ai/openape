// `apes yolo set <agent-email>` — write a YOLO-policy on a DDISA agent
// you own. The IdP's grant-creation hook evaluates the agent's policy
// before opening the human-approval flow; allow_patterns matches mean
// "auto-approve, no prompt" (mode='allow-list') and deny_patterns means
// "block without asking" (mode='deny-list').
//
// PUT-shape mirrors the IdP endpoint
// `/api/users/<email>/yolo-policy` (modules/nuxt-auth-idp). Owner-auth
// is enforced server-side: only the agent's owner / approver / admin
// can change the policy, regardless of who's invoking the CLI.

import { defineCommand } from 'citty'
import consola from 'consola'
import { getIdpUrl, loadAuth } from '../../config'
import { CliError } from '../../errors'

const VALID_MODES = ['allow-list', 'deny-list'] as const
type Mode = typeof VALID_MODES[number]

export const yoloSetCommand = defineCommand({
  meta: {
    name: 'set',
    description: 'Write a YOLO-policy on a DDISA agent you own',
  },
  args: {
    'email': {
      type: 'positional',
      description: 'Target agent email (e.g. nest-mac-cb6bf26a+patrick+example_com@id.openape.ai)',
      required: true,
    },
    'mode': {
      type: 'string',
      description: 'Policy mode (allow-list | deny-list)',
    },
    'allow': {
      type: 'string',
      description: 'Allow patterns — comma-separated bash globs (e.g. "apes agents spawn *,apes agents sync")',
    },
    'deny': {
      type: 'string',
      description: 'Deny patterns — comma-separated bash globs',
    },
    'deny-risk': {
      type: 'string',
      description: 'Deny grants at this risk level or above (low|medium|high|critical)',
    },
    'expires-in': {
      type: 'string',
      description: 'Optional expiry like 30d, 6h, 2w. Omit for no expiry.',
    },
  },
  async run({ args }) {
    const ownerAuth = loadAuth()
    if (!ownerAuth?.access_token) {
      throw new CliError('Run `apes login <email>` first.')
    }
    const idp = getIdpUrl()
    if (!idp) throw new CliError('No IdP configured.')

    const email = args.email as string
    const mode = (args.mode as string | undefined) ?? 'allow-list'
    if (!VALID_MODES.includes(mode as Mode)) {
      throw new CliError(`mode must be one of: ${VALID_MODES.join(', ')}`)
    }
    const allowPatterns = parseList(args.allow as string | undefined)
    const denyPatterns = parseList(args.deny as string | undefined)
    const denyRiskThreshold = (args['deny-risk'] as string | undefined) ?? null
    const expiresAt = parseExpiresIn(args['expires-in'] as string | undefined)

    consola.info(`Setting YOLO-policy on ${email}`)
    consola.info(`  mode:           ${mode}`)
    if (allowPatterns.length) consola.info(`  allow_patterns: ${allowPatterns.join(', ')}`)
    if (denyPatterns.length) consola.info(`  deny_patterns:  ${denyPatterns.join(', ')}`)
    if (denyRiskThreshold) consola.info(`  deny_risk:      ${denyRiskThreshold}`)
    if (expiresAt) consola.info(`  expires_at:     ${new Date(expiresAt * 1000).toISOString()}`)

    const url = `${idp}/api/users/${encodeURIComponent(email)}/yolo-policy`
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${ownerAuth.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        mode,
        allowPatterns,
        denyPatterns,
        denyRiskThreshold,
        expiresAt: expiresAt ?? null,
      }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new CliError(`PUT /yolo-policy failed (${res.status}): ${text}`)
    }
    consola.success(`YOLO-policy applied to ${email}`)
  },
})

function parseList(s: string | undefined): string[] {
  if (!s) return []
  return s.split(',').map(p => p.trim()).filter(Boolean)
}

function parseExpiresIn(s: string | undefined): number | null {
  if (!s) return null
  const m = s.match(/^(\d+)([hdw])$/)
  if (!m) throw new CliError(`Invalid --expires-in "${s}" — expected forms like 30d, 6h, 2w`)
  const n = Number(m[1])
  const unit = m[2]
  const seconds = unit === 'h' ? 3600 : unit === 'd' ? 86400 : 7 * 86400
  return Math.floor(Date.now() / 1000) + n * seconds
}
