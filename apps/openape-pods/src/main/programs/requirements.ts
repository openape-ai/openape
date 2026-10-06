import { basename } from 'node:path'
import { realpath, stat } from 'node:fs/promises'
import { loadAdapter } from '@openape/apes'
import type { PortableApplication } from '@openape/pods-protocol'
import type { ProgramDefinition } from '../../contracts/programs'
import { applicationBundle } from './application'
import type { ApplicationBundle, ReadApplicationPlist } from './application'
import { programDefinition, suggestedProgram } from './definition'

export const portableLauncher = { identity: 'ai.openape.pods.launch', version: 1 } as const
export interface ApplicationCandidate { path: string, adapterPath?: string, runtimePath?: string }
export interface ApplicationResolutionOptions {
  candidates: ApplicationCandidate[]
  selected?: ApplicationCandidate
  searchPath: string
  host?: { os: string, architecture: string }
  readPlist?: ReadApplicationPlist
}
export type ApplicationResolution =
  | { status: 'available', software: { kind: 'program', definition: ProgramDefinition } | { kind: 'bundle', bundle: ApplicationBundle }, version: string | null, identitySource: 'bundle-declaration' | 'local-adapter', testedVersion: boolean }
  | { status: 'missing' }
  | { status: 'unsupported' | 'incompatible' | 'setupRequired', reason: string }

async function resolveCandidate(requirement: PortableApplication, candidate: ApplicationCandidate, options: ApplicationResolutionOptions): Promise<ApplicationResolution | null> {
  if (requirement.adapter.identity === portableLauncher.identity) {
    if (!options.selected && !candidate.path.endsWith('.app')) return null
    const bundle = await applicationBundle(candidate.path, options.readPlist)
    if (bundle.identity === null) return { status: 'setupRequired', reason: 'Application bundle does not declare a portable identity' }
    if (bundle.identity !== requirement.application) return options.selected ? { status: 'incompatible', reason: 'Application identity differs from the package requirement' } : null
    if (requirement.testedVersions.length && bundle.version === null) return { status: 'setupRequired', reason: 'Application bundle does not declare its version' }
    if (requirement.testedVersions.length && !requirement.testedVersions.includes(bundle.version!)) return { status: 'incompatible', reason: 'Application version is outside the declared tested versions' }
    return { status: 'available', software: { kind: 'bundle', bundle }, version: bundle.version, identitySource: 'bundle-declaration', testedVersion: requirement.testedVersions.length > 0 }
  }
  if (!candidate.adapterPath && !options.selected && basename(candidate.path) !== requirement.application) return null
  if (!candidate.adapterPath) return { status: 'setupRequired', reason: 'Select a local application adapter before continuing' }
  const loaded = loadAdapter(basename(candidate.adapterPath, '.toml'), candidate.adapterPath)
  const cli = loaded.adapter.cli
  if (cli.executable !== requirement.application && !options.selected) return null
  if (cli.id !== requirement.adapter.identity || cli.executable !== requirement.application) return { status: 'incompatible', reason: 'Local application adapter identity differs from the package requirement' }
  if (cli.version === undefined) return { status: 'setupRequired', reason: 'Local application adapter does not declare its version' }
  if (cli.version !== String(requirement.adapter.version)) return { status: 'incompatible', reason: 'Local application adapter version differs from the package requirement' }
  if (requirement.testedVersions.length) return { status: 'setupRequired', reason: 'Application version cannot be verified without an approved execution' }
  const definition = await programDefinition(candidate.path, candidate.adapterPath, requirement.application, candidate.runtimePath)
  if (definition.adapterHash !== loaded.digest.replace('SHA-256:', '')) throw new Error('Application adapter changed during resolution')
  return { status: 'available', software: { kind: 'program', definition }, version: null, identitySource: 'local-adapter', testedVersion: false }
}

export async function resolveApplicationRequirement(requirement: PortableApplication, options: ApplicationResolutionOptions): Promise<ApplicationResolution> {
  const host = options.host ?? { os: process.platform, architecture: process.arch }
  if (!requirement.platforms.some(platform => platform.os === host.os && platform.architecture === host.architecture)) return { status: 'unsupported', reason: 'Application does not support this operating system and architecture' }
  const bundle = requirement.adapter.identity === portableLauncher.identity
  if (bundle && (host.os !== 'darwin' || requirement.adapter.version !== portableLauncher.version)) return { status: 'unsupported', reason: 'Application launcher version or platform is unsupported' }
  const candidates = options.selected ? [options.selected] : [...options.candidates]
  if (!options.selected && !bundle) {
    const suggested = await suggestedProgram(requirement.application, options.searchPath)
    if (suggested) candidates.push({ path: suggested })
  }
  const paths = new Set<string>(); const available: Extract<ApplicationResolution, { status: 'available' }>[] = []
  let unresolved: ApplicationResolution = { status: 'missing' }
  for (const candidate of candidates) {
    let path: string
    try { path = await realpath(candidate.path); await stat(path) }
    catch (error) { if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) continue; throw error }
    const key = `${path}\0${candidate.adapterPath ?? ''}\0${candidate.runtimePath ?? ''}`
    if (paths.has(key)) continue
    paths.add(key)
    let result: ApplicationResolution | null
    try { result = await resolveCandidate(requirement, { ...candidate, path }, options) }
    catch (error) { result = { status: 'setupRequired', reason: error instanceof Error ? error.message : String(error) } }
    if (result === null) continue
    if (result.status === 'available') available.push(result)
    else if (unresolved.status !== 'incompatible') unresolved = result
  }
  if (available.length > 1) return { status: 'setupRequired', reason: 'Choose which local application installation to use' }
  return available[0] ?? unresolved
}
