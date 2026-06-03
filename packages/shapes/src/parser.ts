import { buildCliAuthDetail, computeArgvHash, matchArgvToOperation } from '@openape/grants'
import type { LoadedAdapter, ResolvedCommand } from './types.js'

export async function resolveCommand(loaded: LoadedAdapter, fullArgv: string[]): Promise<ResolvedCommand> {
  const [executable, ...commandArgv] = fullArgv
  if (!executable) {
    throw new Error('Missing wrapped command')
  }
  if (executable !== loaded.adapter.cli.executable) {
    throw new Error(`Adapter ${loaded.adapter.cli.id} expects executable ${loaded.adapter.cli.executable}, got ${executable}`)
  }

  const match = matchArgvToOperation(loaded.adapter.operations, commandArgv)
  if (!match) {
    throw new Error(`No adapter operation matched: ${fullArgv.join(' ')}`)
  }
  const { operation, bindings } = match

  const detail = buildCliAuthDetail(loaded.adapter.cli.id, operation, bindings)

  return {
    adapter: loaded.adapter,
    source: loaded.source,
    digest: loaded.digest,
    executable,
    commandArgv,
    bindings,
    detail,
    executionContext: {
      argv: fullArgv,
      argv_hash: await computeArgvHash(fullArgv),
      adapter_id: loaded.adapter.cli.id,
      adapter_version: loaded.adapter.cli.version ?? loaded.adapter.schema,
      adapter_digest: loaded.digest,
      resolved_executable: executable,
      context_bindings: bindings,
    },
    permission: detail.permission,
  }
}
