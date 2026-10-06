import { fstatSync } from 'node:fs'
import { hostname } from 'node:os'
import type { StdioOptions } from 'node:child_process'

export function shellTargetHost(): string {
  const host = process.env.APES_TARGET_HOST ?? hostname()
  if (!/^[\w.:-]{1,255}$/.test(host))
    throw new Error('Invalid APES_TARGET_HOST')
  return host
}

export function shellStdio(): StdioOptions {
  const channel = process.env.APES_SHELL_CHANNEL_FD
  if (channel === undefined)
    return 'inherit'
  if (channel !== '3' || !fstatSync(3).isSocket())
    throw new Error('APES_SHELL_CHANNEL_FD requires an open socket at descriptor 3')
  return ['inherit', 'inherit', 'inherit', 3]
}

export function shellStartupArguments(): string[] {
  const clean = process.env.APES_SHELL_CLEAN_START
  if (clean === undefined)
    return ['--login', '-i']
  if (clean !== '1')
    throw new Error('Invalid APES_SHELL_CLEAN_START')
  return ['--noprofile', '--norc', '-i']
}
