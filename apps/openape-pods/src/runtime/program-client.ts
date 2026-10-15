import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { connect } from 'node:net'
import { launchApeShell } from '../worker/runtime/ape-shell'
import type { MachineLaunch } from '../worker/runtime/ape-shell'
import type { RuntimePolicy } from '../worker/runtime/sandbox'
import { observeExecution } from '../main/programs/execution'
import { inspectDomainRecords } from '../worker/recovery/domains'

async function register(config: ProgramClientConfiguration, path: string, ownerPid: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = connect(config.endpoint); let reply = ''
    socket.setTimeout(10000, () => socket.destroy(new Error('Desktop execution lease timed out')))
    socket.on('connect', () => socket.write(`${JSON.stringify({ token: config.token, type: 'execution', path, ownerPid })}\n`))
    socket.on('error', reject)
    socket.on('data', (bytes) => { reply += bytes.toString(); if (reply.length > 1024) socket.destroy(new Error('Invalid desktop acknowledgement')) })
    socket.on('end', () => {
      try { if (JSON.parse(reply).registered !== true) throw new Error('Desktop refused execution registration'); resolve() }
      catch (error) { reject(error) }
    })
  })
}

/** Private desktop-generated forwarding data. No field can assert a grant or suppress ape-shell authorization. */
export interface ProgramClientConfiguration {
  endpoint: string
  token: string
  helper: string
  privateRoot: string
  policy: RuntimePolicy
  launch: Omit<MachineLaunch, 'operationId'>
  prefix: string[]
  suffix: string[]
  environment: Record<string, string>
}

export async function forwardProgram(config: ProgramClientConfiguration, argv: string[]): Promise<number> {
  const directory = await mkdtemp(join(config.privateRoot, 'call-'))
  const controller = new AbortController()
  const stop = () => controller.abort(new Error('Application command was interrupted'))
  process.on('SIGTERM', stop); process.on('SIGHUP', stop)
  let closed = true
  try {
    const operationId = randomUUID()
    const domain = await launchApeShell(config.helper, directory, config.policy, [...config.prefix, ...argv, ...config.suffix], config.environment, { ...config.launch, operationId }, (path, pid) => register(config, path, pid), process.stdin.isTTY === true)
    closed = false
    domain.stdout.pipe(process.stdout, { end: false }); domain.stderr.pipe(process.stderr, { end: false })
    process.stdin.pipe(domain.channel, { end: false })
    const wasRaw = process.stdin.isTTY && process.stdin.isRaw
    if (process.stdin.isTTY) process.stdin.setRawMode(true)
    try {
      const result = await observeExecution(domain, operationId, {
        pending: async (_id, url) => { process.stderr.write(`Waiting for approval at ${url}\n`) },
        authorized: async () => { controller.signal.throwIfAborted() },
      }, controller.signal)
      return result.exitCode
    }
    finally {
      process.stdin.unpipe(domain.channel); process.stdin.pause()
      if (process.stdin.isTTY) process.stdin.setRawMode(Boolean(wasRaw))
      domain.cancel(); await domain.completed
      await inspectDomainRecords([{ path: domain.recordPath, owner_pid: process.pid }], config.privateRoot, config.helper)
      closed = true
    }
  }
  finally {
    process.off('SIGTERM', stop); process.off('SIGHUP', stop)
    // Keep a domain record when termination could not be established; never silently discard uncertain execution.
    if (closed) await rm(directory, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  const config = JSON.parse(await readFile(process.argv[2]!, 'utf8')) as ProgramClientConfiguration
  process.exitCode = await forwardProgram(config, process.argv.slice(3))
}
void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Application command failed'); process.exitCode = 1 })
