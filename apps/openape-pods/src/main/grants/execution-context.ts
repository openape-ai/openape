import type { OpenApeExecutionContext } from '@openape/core'
import { computeArgvHash } from '@openape/grants'
import type { LoadedAdapter } from '@openape/apes'

/** The run of a stored Pod script; a run adds its home and visible environment. */
export interface RuntimeRun { podId: string, name: string, script: string, workspace: string, home?: string, environment?: Record<string, string> }

/** The pod-runtime command a run starts, and the command its runtime grant is requested for. */
export function runtimeArgv(run: RuntimeRun): string[] {
  return ['pod-runtime', 'run', '--pod', run.podId, '--name', run.name, '--script', run.script, '--workspace', run.workspace, ...(run.home ? ['--home', run.home] : []), ...(run.environment ? ['--environment', JSON.stringify(run.environment)] : [])]
}

/** The pod-http command of one request, and the command its HTTP or Jev grant is requested for. */
export function httpArgv(origin: string, method: string): string[] {
  return ['pod-http', 'request', '--origin', origin, '--method', method]
}

/**
 * The context of a grant that covers more than one command (a whole program, several or all methods of an origin):
 * the adapter and its executable without arguments. Continuing structured grants bind argv only for exact commands,
 * which such a grant never covers.
 */
export async function programContext(adapter: LoadedAdapter): Promise<OpenApeExecutionContext> {
  const argv = [adapter.adapter.cli.executable]
  return { argv, argv_hash: await computeArgvHash(argv), adapter_id: adapter.adapter.cli.id, adapter_version: adapter.adapter.cli.version ?? adapter.adapter.schema, adapter_digest: adapter.digest, resolved_executable: adapter.adapter.cli.executable, context_bindings: {} }
}
