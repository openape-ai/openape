// Linux agent-user lookup via `getent passwd`. getent is the canonical
// way to read the system user database — works against /etc/passwd,
// NIS, LDAP, sssd, whatever's configured. Pure POSIX (Glibc) so it
// works inside our nest container as well as on a host-direct deploy.
//
// On Linux we don't prefix the OS account name — the agent name IS
// the username (the container is the OpenApe namespace, no need to
// scope further). macOS-style `openape-agent-<n>` prefix is rejected
// by `useradd` anyway when the name exceeds 32 chars.

import { execFileSync } from 'node:child_process'
import type { AgentUserSummary } from './index'

function getentPasswd(name: string): string | null {
  try {
    return execFileSync('getent', ['passwd', name], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null
  }
  catch { return null }
}

function parsePasswdLine(line: string): AgentUserSummary | null {
  // Format: name:passwd:uid:gid:gecos:home:shell
  const parts = line.split(':')
  if (parts.length < 7) return null
  const [name, , uidStr, , , homeDir, shell] = parts
  if (!name || !uidStr) return null
  const uid = Number.parseInt(uidStr, 10)
  return {
    name,
    uid: Number.isFinite(uid) ? uid : null,
    shell: shell?.trim() || null,
    homeDir: homeDir?.trim() || null,
  }
}

export function readLinuxUser(name: string): AgentUserSummary | null {
  const line = getentPasswd(name)
  if (!line) return null
  return parsePasswdLine(line)
}

export function listLinuxUserNames(): Set<string> {
  try {
    const out = execFileSync('getent', ['passwd'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const names = new Set<string>()
    for (const line of out.split('\n')) {
      const name = line.split(':', 1)[0]?.trim()
      if (name) names.add(name)
    }
    return names
  }
  catch { return new Set() }
}
