import { createHash } from 'node:crypto'
import type { ShapesAdapter } from './types.js'

function sha256(content: string): string {
  return `SHA-256:${createHash('sha256').update(content).digest('hex')}`
}

/** Digest of the adapter file bytes, for integrity checks of a file (installer, pinned program adapters). */
export function adapterFileDigest(content: string): string {
  return sha256(content)
}

/**
 * Digest grants bind in `execution_context.adapter_digest`. It covers only what
 * decides whether an argv matches and which permission results — adapter
 * identity, operation order, commands, positionals, options, actions, risks,
 * resource chains and exact binding — so presentation texts, display
 * templates, tested versions and comments can change without invalidating
 * grants. Operations keep their declared order because the first match wins.
 */
export function semanticAdapterDigest(adapter: ShapesAdapter): string {
  const canonical = {
    form: 'openape-shapes-semantic/v1',
    schema: adapter.schema,
    cli: { id: adapter.cli.id, executable: adapter.cli.executable, audience: adapter.cli.audience ?? null },
    operations: adapter.operations.map(operation => ({
      id: operation.id,
      command: operation.command,
      positionals: operation.positionals ?? [],
      required_options: operation.required_options ?? [],
      // Absent and empty differ: declaring either list rejects every other option.
      value_options: operation.value_options ?? null,
      flag_options: operation.flag_options ?? null,
      global_options: operation.global_options ?? [],
      action: operation.action,
      risk: operation.risk,
      resource_chain: operation.resource_chain,
      exact_command: operation.exact_command === true,
      ...(operation.decision ? { decision: operation.decision } : {}),
    })),
  }
  return sha256(JSON.stringify(canonical))
}
