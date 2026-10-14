import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import { readCliVersion } from '@openape/grants'
import { loadAdapter } from './adapters.js'
import { installedAdapterPath } from './installer.js'
import { findAdapter } from './registry.js'
import type { LoadedAdapter, RegistryEntry, RegistryIndex, ResolvedCommand, ShapesAdapter } from './types.js'

export type RegistryAdapterProblem = 'not_in_registry' | 'not_installed' | 'digest_mismatch'

/** Why no registry adapter could be used for a CLI; the message names the owner's next step. */
export class RegistryAdapterError extends Error {
  constructor(readonly problem: RegistryAdapterProblem, readonly cliId: string, message: string) {
    super(message)
    this.name = 'RegistryAdapterError'
  }
}

export interface RegistryAdapter {
  entry: RegistryEntry
  loaded: LoadedAdapter & { fileDigest: string }
}

/**
 * The installed adapter of the shapes-registry entry for a CLI id or executable, verified against the registry index:
 * its file bytes must equal the entry's `digest` and, when the index records one, its semantic digest the entry's
 * `grant_digest` (issue 1473). Any other adapter file is not a registry adapter.
 */
export function loadRegistryAdapter(index: RegistryIndex, cliId: string, adaptersDirectory?: string): RegistryAdapter {
  const entry = findAdapter(index, cliId)
  if (!entry)
    throw new RegistryAdapterError('not_in_registry', cliId, `The shapes registry has no adapter for ${cliId}; only registry adapters are accepted`)
  const path = installedAdapterPath(entry.id, adaptersDirectory)
  if (!existsSync(path))
    throw new RegistryAdapterError('not_installed', entry.id, `The registry adapter ${entry.id} is not installed; run apes adapter install ${entry.id}`)
  const loaded = loadAdapter(entry.id, path)
  if (loaded.fileDigest !== entry.digest || (entry.grant_digest && loaded.digest !== entry.grant_digest))
    throw new RegistryAdapterError('digest_mismatch', entry.id, `The installed adapter ${entry.id} differs from the shapes registry; run apes adapter install ${entry.id} --refresh`)
  return { entry, loaded }
}

/** What the version check of an adapter found for an installed CLI. */
export interface CliVersionCheck {
  /** The version `version_pattern` read from the output, or null when the adapter has no version data or nothing matched. */
  version: string | null
  /** True only when the adapter lists that version in `tested_versions`. */
  tested: boolean
}

/**
 * Whether an executable is tested with the adapter: its file digest is one of `tested_digests`, or the output of the
 * adapter's `version_command` names one of `tested_versions`. An adapter without either, a failed command (null output)
 * or an unreadable version is never tested: callers fall back to exact approvals.
 */
export function checkCliVersion(adapter: ShapesAdapter, output: string | null, fileDigest?: string): CliVersionCheck {
  if (fileDigest && adapter.cli.tested_digests?.includes(fileDigest))
    return { version: `sha256:${fileDigest.slice('SHA-256:'.length, 'SHA-256:'.length + 12)}`, tested: true }
  const { tested_versions: tested, version_command: command, version_pattern: pattern } = adapter.cli
  if (!tested || !command || !pattern || output === null)
    return { version: null, tested: false }
  const version = readCliVersion({ tested_versions: tested, version_command: command, version_pattern: pattern }, output)
  return { version, tested: version !== null && tested.includes(version) }
}

/**
 * Whether an installed executable may use a registry adapter: its real file name is the adapter's executable, or its
 * file digest is one the adapter was tested with. A caller's command name never binds an executable to an adapter.
 */
export function bindsExecutable(adapter: ShapesAdapter, realPath: string, fileDigest: string): boolean {
  return basename(realPath) === adapter.cli.executable || adapter.cli.tested_digests?.includes(fileDigest) === true
}

/**
 * The command bound to its exact argv: a grant for it carries `exact_command`, so the IdP binds it to the argv hash
 * and the grant covers only this argv, whatever the adapter operation would otherwise allow.
 */
export function exactCommand(resolved: ResolvedCommand): ResolvedCommand {
  return { ...resolved, detail: { ...resolved.detail, constraints: { ...resolved.detail.constraints, exact_command: true } } }
}
