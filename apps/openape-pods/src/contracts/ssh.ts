import type { PodResource } from './resources'
import type { ProgramAuthority } from '../main/programs/grants'

export interface SshTarget { alias: string, jumps: string[], profile: 'linde-server-v1' }
export interface SshHost { alias: string, hostname: string, user: string, port: number, identities: string[], hostKeyAlias: string }
export interface SshBinding { profileHash: string, target: SshTarget, hosts: SshHost[], knownHosts: { path: string, hash: string }[] }
export interface SshAssignment extends SshBinding { type: 'sshInventory', capability: string, authority: ProgramAuthority }
const hostName = /^[a-z0-9][a-z0-9.-]{0,252}$/i
export function parseSshTarget(value: unknown): SshTarget {
  const target = value as SshTarget
  if (!target || typeof target !== 'object' || Object.keys(target).some(key => !['alias', 'jumps', 'profile'].includes(key)) || typeof target.alias !== 'string' || !hostName.test(target.alias) || !Array.isArray(target.jumps) || target.jumps.length > 2 || target.jumps.some(alias => typeof alias !== 'string' || !hostName.test(alias)) || new Set([target.alias, ...target.jumps]).size !== target.jumps.length + 1 || target.profile !== 'linde-server-v1') throw new Error('Invalid fixed SSH inventory target')
  return structuredClone(target)
}
export function assignedSsh(resources: PodResource[], podId: string, capabilities: string[], value: unknown): SshAssignment {
  const request = value as { sshInventory: string }
  if (!request || typeof request !== 'object' || Object.keys(request).length !== 1 || typeof request.sshInventory !== 'string') throw new Error('SSH inventory accepts only an assigned resource ID')
  const resource = resources.find(item => item.id === request.sshInventory && item.podId === podId && item.kind === 'tool' && item.state === 'ready' && item.configuration.type === 'sshInventory')
  if (!resource || !capabilities.includes(String(resource.configuration.capability))) throw new Error('SSH inventory is not assigned and declared')
  const assignment = resource.configuration as unknown as SshAssignment
  parseSshTarget(assignment.target)
  if (assignment.authority?.identity.podId !== podId || !assignment.authority.grantId) throw new Error('SSH permission belongs to another Pod')
  return assignment
}
