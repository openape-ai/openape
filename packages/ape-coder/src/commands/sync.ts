import type { ConflictResolution } from '../sync'
import { defineCommand } from 'citty'
import consola from 'consola'
import { runSync } from '../sync'

// story: coder-repo-sync — the `ape-coder sync` command. Two-way, client-side
// sync between the repo (bound via `.ape-coder/config`) and the service. The
// real diff/conflict/permission logic lives in ../sync.ts (pure, tested);
// this command only resolves cwd, parses --resolve flags and prints results.

function parseResolutions(raw: string | string[] | undefined): Record<string, ConflictResolution> {
  const entries = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw]
  const out: Record<string, ConflictResolution> = {}
  for (const entry of entries) {
    const [id, side] = entry.split('=')
    if (!id || (side !== 'local' && side !== 'remote')) {
      throw new Error(`--resolve expects <story-id>=local|remote, got "${entry}"`)
    }
    out[id] = side
  }
  return out
}

export const syncCommand = defineCommand({
  meta: { name: 'sync', description: 'Sync the bound repo with the service — both ways, conflicts shown loudly' },
  args: {
    resolve: { type: 'string', description: 'Resolve a conflict: <story-id>=local|remote (repeatable)' },
    json: { type: 'boolean', description: 'Output the result as JSON' },
  },
  async run({ args }) {
    const result = await runSync({
      cwd: process.cwd(),
      resolutions: parseResolutions(args.resolve as string | string[] | undefined),
    })

    if (args.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
      return
    }

    if (result.conflicts.length > 0) {
      consola.warn(`${result.conflicts.length} conflict(s) — both sides changed since the last sync. Nothing was overwritten.`)
      for (const c of result.conflicts) {
        consola.warn(`  ${c.id}: choose with \`ape-coder sync --resolve ${c.id}=local\` or \`=remote\``)
      }
    }
    consola.success(`Synced: ${result.pushed} pushed, ${result.pulled} pulled.`)
  },
})
