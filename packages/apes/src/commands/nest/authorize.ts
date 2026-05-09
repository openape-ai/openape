// `apes nest authorize` — set the YOLO-policy on the local nest's
// DDISA-agent identity so its grant-creation hits auto-approve.
//
// Implementation: shells out to `apes yolo set <nest-email> ...`. The
// YOLO-management surface is generic (any agent), so it lives in
// `apes yolo`; this command is just the nest-specific wrapper that
// fills in the right defaults (mode=allow-list, allow_patterns
// covering nest-managed agent lifecycle ops).

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineCommand } from 'citty'
import consola from 'consola'
import { CliError } from '../../errors'
import { NEST_DATA_DIR } from './enroll'

interface NestAuth {
  email: string
}

const DEFAULT_ALLOW_PATTERNS = [
  // Caller → Nest API gates. The new-style flow: `apes nest <op>`
  // requests a grant with audience='nest' and command=['nest','<op>',
  // ...]. Patrick's YOLO auto-approves these so the local Nest API
  // is gated cryptographically without a per-call human prompt.
  'nest status',
  'nest list',
  'nest spawn *',
  'nest destroy *',
  // Inner spawn/destroy grants the nest itself triggers via
  // `apes run --as root --wait -- apes agents spawn|destroy`.
  'apes agents spawn *',
  'apes agents destroy *',
  'apes agents sync',
  // Inner setup.sh-grant — `apes agents spawn` itself shells out to
  // `apes run --as root --wait -- bash <tempdir>/setup.sh` to do the
  // dscl/launchctl/heredoc-write work. Path looks like
  // `bash /var/folders/.../apes-spawn-<name>-XXXX/setup.sh`. The narrow
  // glob below limits the auto-approval to that exact lifecycle path
  // — `bash *` would be unsafe.
  'bash *apes-spawn-*setup.sh',
  // Bridge invocation. The grant request escapes-helper sends to the
  // IdP contains the *inner* command only — `apes run --as <agent> --`
  // is the wrapper that gets unwrapped before grant creation. So the
  // YOLO target string is just `openape-chat-bridge`, not the full
  // wrapped invocation.
  'openape-chat-bridge',
]

export const authorizeNestCommand = defineCommand({
  meta: {
    name: 'authorize',
    description: 'Set the YOLO-policy that lets the local nest spawn/destroy without per-call DDISA prompts (wraps `apes yolo set`)',
  },
  args: {
    'allow': {
      type: 'string',
      description: 'Override allow_patterns (comma-separated globs). Default: nest-managed agent lifecycle.',
    },
    'expires-in': {
      type: 'string',
      description: 'Optional duration like 30d, 6h. Omit for no expiry.',
    },
  },
  async run({ args }) {
    const nestAuthPath = join(NEST_DATA_DIR, '.config', 'apes', 'auth.json')
    if (!existsSync(nestAuthPath)) {
      throw new CliError('Nest not enrolled. Run `apes nest enroll` first.')
    }
    const nestAuth = JSON.parse(readFileSync(nestAuthPath, 'utf8')) as NestAuth
    if (!nestAuth.email) throw new CliError(`${nestAuthPath} has no email`)

    const allow = (args.allow as string | undefined) ?? DEFAULT_ALLOW_PATTERNS.join(',')

    consola.info(`Configuring YOLO-policy on ${nestAuth.email} via \`apes yolo set\`…`)

    const cmdArgs = [
      'yolo', 'set', nestAuth.email,
      '--mode', 'allow-list',
      '--allow', allow,
    ]
    if (typeof args['expires-in'] === 'string' && args['expires-in']) {
      cmdArgs.push('--expires-in', args['expires-in'])
    }

    try {
      execFileSync('apes', cmdArgs, { stdio: 'inherit' })
    }
    catch (err) {
      throw new CliError(err instanceof Error ? err.message : String(err))
    }
    consola.success('Nest-driven agent lifecycle is now zero-prompt.')
    consola.info('Test: apes agents spawn <name> via the nest API → no DDISA prompt.')
  },
})
