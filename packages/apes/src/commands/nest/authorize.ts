// `apes nest authorize` — request the capability-grant that lets the
// nest-daemon spawn/destroy/sync any agent without a per-call DDISA
// approval prompt.
//
// Why a capability-grant (not a plain `apes run --approval=always`):
// findExistingGrant does exact-arg matching on plain run-grants — a
// grant approved for `apes agents spawn igor7` won't reuse for
// `apes agents spawn igor8`. Capability-grants take resource/action
// patterns + selector globs (`name=*`), which DO match across agent
// names via selectorValueMatches's '*'-as-glob behaviour.
//
// Backed by the bundled `apes-agents.toml` adapter that
// `apes nest install` wrote into ~/.openape/shapes/adapters/.

import { execFileSync } from 'node:child_process'
import { defineCommand } from 'citty'
import consola from 'consola'

export const authorizeNestCommand = defineCommand({
  meta: {
    name: 'authorize',
    description: 'Request the always-capability-grant the nest needs for zero-prompt spawn/destroy',
  },
  args: {
    'reason': {
      type: 'string',
      description: 'Reason shown in the DDISA approval UI',
    },
    'wait': {
      type: 'boolean',
      description: 'Block until the grant is approved (default: print URL + exit 0)',
    },
  },
  async run({ args }) {
    const reason = (args.reason as string)
      ?? 'nest-managed agent lifecycle (spawn / destroy / sync) — approve as Always'

    consola.info('Requesting capability-grant for `apes-agents` (selector name=* covers all agent names)...')
    consola.info('')
    consola.info('When the IdP approval page opens, choose **Always** so the nest can re-use the grant on every spawn.')
    consola.info('')

    const cmdArgs = [
      'grants', 'request-capability', 'apes-agents',
      '--resource', 'agents:*',
      '--selector', 'name=*',
      '--action', 'create',
      '--action', 'delete',
      '--action', 'edit',
      '--action', 'list',
      '--approval=always',
      '--reason', reason,
      '--run-as', 'root',
    ]
    if (args.wait) cmdArgs.push('--wait')
    try {
      // execFile (not shell) so the reason / selector args can't be
      // mis-quoted into something the shell would re-parse.
      execFileSync('apes', cmdArgs, { stdio: 'inherit' })
    }
    catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  },
})
