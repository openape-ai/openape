import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { inventoryProfile } from './profile'
import { parseSshTarget } from '../../contracts/ssh'
import type { SshBinding, SshHost, SshTarget } from '../../contracts/ssh'

const execute = promisify(execFile)
function path(value: string): string {
  const expanded = value.startsWith('~/') ? join(homedir(), value.slice(2)) : value
  if (!expanded.startsWith('/') || /[\r\n\0"\\%]/.test(expanded)) throw new Error('Unsupported SSH authentication path')
  return expanded
}
export async function resolveSshTarget(value: SshTarget): Promise<SshBinding> {
  const target = parseSshTarget(value)
  const hosts: SshHost[] = []
  for (const alias of [...target.jumps, target.alias]) {
    const { stdout } = await execute('/usr/bin/ssh', ['-G', '-o', 'ProxyCommand=none', '-o', 'ProxyJump=none', alias], { timeout: 5000, maxBuffer: 65536 })
    const entries = stdout.trim().split('\n').map((line) => { const space = line.indexOf(' '); return [line.slice(0, space), line.slice(space + 1)] as const })
    const get = (key: string) => entries.find(([name]) => name === key)?.[1]
    const hostname = get('hostname') ?? ''; const user = get('user') ?? ''; const port = Number(get('port'))
    const hostKeyAlias = get('hostkeyalias') ?? hostname
    if (![hostname, hostKeyAlias].every(item => /^[a-z0-9][a-z0-9.-]{0,252}$/i.test(item)) || !/^\w[\w.-]{0,63}$/.test(user) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Unsupported SSH endpoint configuration')
    const identities: string[] = []
    for (const [, file] of entries.filter(([name]) => name === 'identityfile')) {
      const expanded = path(file)
      try { if ((await stat(expanded)).isFile()) identities.push(await realpath(expanded)) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
    if (!identities.length || identities.length > 8) throw new Error('SSH inventory needs an existing owner identity file')
    hosts.push({ alias, hostname, user, port, hostKeyAlias, identities })
  }
  const knownHosts = []
  for (const file of [join(homedir(), '.ssh/known_hosts'), '/etc/ssh/ssh_known_hosts']) {
    try { knownHosts.push({ path: file, hash: createHash('sha256').update(await readFile(file)).digest('hex') }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  if (!knownHosts.length) throw new Error('SSH inventory needs existing trusted host keys')
  return { profileHash: createHash('sha256').update(inventoryProfile).digest('hex'), target, hosts, knownHosts }
}
export function sshConfiguration(binding: SshBinding): string {
  const lines = ['Host *', '  BatchMode yes', '  StrictHostKeyChecking yes', '  UpdateHostKeys no', '  ForwardAgent no', '  ClearAllForwardings yes', '  IdentitiesOnly yes', '  IdentityAgent none', '  RequestTTY no', '  PermitLocalCommand no', '  ControlMaster no', '  ControlPath none', '  ConnectTimeout 15', '  ServerAliveInterval 5', '  ServerAliveCountMax 2', '  LogLevel ERROR', '  GlobalKnownHostsFile /dev/null', `  UserKnownHostsFile ${binding.knownHosts.map(item => JSON.stringify(path(item.path))).join(' ')}`]
  for (const host of binding.hosts) {
    lines.push(`Host ${host.alias}`, `  HostName ${host.hostname}`, `  User ${host.user}`, `  Port ${host.port}`, `  HostKeyAlias ${host.hostKeyAlias}`, ...host.identities.map(file => `  IdentityFile ${JSON.stringify(path(file))}`))
  }
  return `${lines.join('\n')}\n`
}
export function sshGrantArgv(binding: SshBinding): string[] {
  const digest = createHash('sha256').update(JSON.stringify(binding)).digest('hex')
  return ['pod-ssh', 'inventory', '--binding', digest, '--profile', binding.target.profile]
}
