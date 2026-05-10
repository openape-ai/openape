// `apes nest destroy <name>` — Phase F: direct shell-out to
// `apes run --as root -- apes agents destroy <name>`. The destroy
// command removes the registry entry; the Nest watches the file
// and pm2-deletes the bridge automatically.

import { execFileSync } from 'node:child_process'
import { defineCommand } from 'citty'
import consola from 'consola'
import { CliExit } from '../../errors'

export const destroyNestCommand = defineCommand({
  meta: {
    name: 'destroy',
    description: 'Destroy a local agent. Wraps `apes run --as root -- apes agents destroy <name>`; the Nest watches its registry and pm2-deletes the bridge automatically.',
  },
  args: {
    name: { type: 'positional', required: true, description: 'Agent name to destroy' },
  },
  async run({ args }) {
    const name = String(args.name)
    try {
      execFileSync('apes', ['run', '--as', 'root', '--wait', '--', 'apes', 'agents', 'destroy', name, '--force'], { stdio: 'inherit' })
      consola.success(`Nest will tear down ${name}'s pm2 process on its next reconcile (≤2s).`)
    }
    catch (err: unknown) {
      const status = (err as { status?: number }).status ?? 1
      throw new CliExit(status)
    }
  },
})
