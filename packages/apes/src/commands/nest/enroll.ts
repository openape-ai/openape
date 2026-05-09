// `apes nest enroll` — create a DDISA agent identity for the local nest.
//
// The Nest needs its own identity (separate from the human) so its
// privileged ops (apes run --as root -- apes agents spawn <name>) hit
// the IdP grant-creation flow as the *Nest*, where a Nest-scoped
// YOLO-policy can auto-approve them. Without that, the Nest would have
// to either re-prompt the human on every spawn (today's Stage 1) or
// share the human's identity (security regression).
//
// Identity layout:
//   ~/.openape/nest/.ssh/id_ed25519              private key
//   ~/.openape/nest/.ssh/id_ed25519.pub          public key (ssh-ed25519 …)
//   ~/.openape/nest/.config/apes/auth.json       agent-token + email
//
// The nest-daemon's launchd plist sets HOME=~/.openape/nest (set by
// `apes nest install`), so apes-CLI subprocesses spawned by the daemon
// pick up THIS auth.json automatically — no env-var plumbing needed.

import { hostname, homedir  } from 'node:os'
import { existsSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { defineCommand } from 'citty'
import consola from 'consola'
import { getIdpUrl, loadAuth } from '../../config'
import { CliError } from '../../errors'
import {
  buildAgentAuthJson,
  issueAgentToken,
  registerAgentAtIdp,
} from '../../lib/agent-bootstrap'
import { generateKeyPairInMemory } from '../../lib/keygen'

export const NEST_DATA_DIR = join(homedir(), '.openape', 'nest')

function nestAgentName(): string {
  // Stable + recognisable — lowercase host, dashes only. The IdP-side
  // validateAgentName regex is /^[a-z][a-z0-9-]{0,23}$/ so we keep
  // under that ceiling and skip illegal chars.
  const raw = hostname().toLowerCase()
  // Strip everything after first dot ("MinivonPatrick.fritz.box" → "minivonpatrick"),
  // map non-alphanum to dashes, collapse runs.
  const head = raw.split('.')[0] ?? raw
  const safe = head.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '')
  const trimmed = safe.slice(0, 16) // leave room for `nest-` prefix
  return `nest-${trimmed || 'host'}`
}

export const enrollNestCommand = defineCommand({
  meta: {
    name: 'enroll',
    description: 'Register the local nest as a DDISA agent at the IdP. One-time per machine. Required before `apes nest authorize` so YOLO-policies have a target identity.',
  },
  args: {
    name: {
      type: 'string',
      description: 'Override the nest agent name (default: nest-<short-hostname>)',
    },
    force: {
      type: 'boolean',
      description: 'Re-enroll even if ~/.openape/nest/.config/apes/auth.json already exists',
    },
  },
  async run({ args }) {
    const idp = getIdpUrl()
    if (!idp) {
      throw new CliError('No IdP configured. Run `apes login <email>` first.')
    }
    const ownerAuth = loadAuth()
    if (!ownerAuth?.email) {
      throw new CliError('Run `apes login <email>` first — nest enroll attaches the new identity to your owner account.')
    }

    const name = (args.name as string | undefined) || nestAgentName()
    const authPath = join(NEST_DATA_DIR, '.config', 'apes', 'auth.json')
    if (existsSync(authPath) && !args.force) {
      throw new CliError(`Nest already enrolled at ${authPath}. Pass --force to re-enroll.`)
    }

    const sshDir = join(NEST_DATA_DIR, '.ssh')
    const configDir = join(NEST_DATA_DIR, '.config', 'apes')
    mkdirSync(sshDir, { recursive: true })
    mkdirSync(configDir, { recursive: true })

    consola.start(`Generating keypair for ${name}…`)
    const { privatePem, publicSshLine } = generateKeyPairInMemory()
    writeFileSync(join(sshDir, 'id_ed25519'), `${privatePem.trimEnd()}\n`, { mode: 0o600 })
    writeFileSync(join(sshDir, 'id_ed25519.pub'), `${publicSshLine}\n`, { mode: 0o644 })
    chmodSync(sshDir, 0o700)

    consola.start(`Registering nest at ${idp}…`)
    const registration = await registerAgentAtIdp({ name, publicKey: publicSshLine, idp })
    consola.success(`Registered as ${registration.email}`)

    consola.start('Issuing nest access token…')
    const { token, expiresIn } = await issueAgentToken({
      idp,
      agentEmail: registration.email,
      privateKeyPem: privatePem,
    })

    const authJson = buildAgentAuthJson({
      idp,
      accessToken: token,
      email: registration.email,
      expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
      keyPath: join(sshDir, 'id_ed25519'),
      ownerEmail: ownerAuth.email,
    })
    writeFileSync(authPath, authJson, { mode: 0o600 })
    chmodSync(configDir, 0o700)

    consola.success(`Nest enrolled — auth.json at ${authPath}`)
    consola.info('')
    consola.info('Next: configure the YOLO-policy so the nest can spawn/destroy without prompts:')
    consola.info('')
    consola.info('  apes nest authorize')
  },
})
