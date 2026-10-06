import { randomUUID, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import { CredentialCache } from '../src/main/connections/cache'
import { ProgramState } from '../src/main/programs/state'
import { mailTLSFixture } from './fixtures/mail-tls'
import { execFile } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, realpath, rm, writeFile, readFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { launchTerminal } from '../src/worker/runtime/terminal'

const execute = promisify(execFile)
it('terminal: owns a foreground CLI with TTY input, resize and cancellation while fork remains denied', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-terminal-')))
  const workspace = join(root, 'workspace'); await mkdir(workspace)
  try {
    const executable = join(root, 'terminal')
    await execute('/usr/bin/xcrun', ['clang', '-Wall', '-Wextra', '-Werror', resolve('experiments/programs/terminal.c'), '-o', executable])
    const domain = await launchTerminal(resolve('dist/native/pods-helper'), root, { executable, workspace, readFiles: [], runtimeDirectories: [] }, [], {})
    let output = ''; domain.stdout.on('data', (bytes) => { output += bytes.toString() }); domain.stderr.resume()
    try {
      await domain.processId
      await expect.poll(() => output).toContain('PASSWORD_READY')
      expect(output).toContain('TTY 1 1 1 SIZE 80 24')
      domain.resize(120, 40)
      await delay(100)
      domain.channel.write('SYNTHETIC_ä🔒\n')
      await expect.poll(() => output).toContain('INTERRUPT_READY')
      domain.channel.write('\x03')
      expect(await domain.completed).toBe(0)
      expect(output).toContain('RESIZED 120 40'); expect(output).toContain('PASSWORD_MATCH 1'); expect(output).not.toContain('SYNTHETIC_ä🔒')
      expect(output).toContain('INTERRUPTED')
    }
    finally { domain.cancel(); await domain.completed }
  }
  finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
})

it.each(['waiting', 'backpressure'])('terminal: revokes %s sessions and keeps host files, snapshots, fork and shell execution denied', async (mode) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-terminal-boundary-')))
  const workspace = join(root, 'workspace'); await mkdir(workspace)
  const executable = join(root, 'probe'); const source = join(root, 'probe.c')
  const canary = join(root, 'host-canary'); const snapshot = join(root, 'snapshot')
  try {
    await writeFile(canary, 'SYNTHETIC_HOST_SECRET'); await writeFile(snapshot, 'SYNTHETIC_REFERENCE')
    await writeFile(source, `#include <stdio.h>
#include <unistd.h>
#include <fcntl.h>
#include <string.h>
#include <sys/wait.h>
int main(int argc, char **argv) {
  if (argc != 4) return 2;
  alarm(20);
  int host = open(argv[1], O_RDONLY); printf("HOST_DENIED %d\\n", host < 0); if (host >= 0) close(host);
  int reference = open(argv[2], O_WRONLY | O_APPEND); printf("SNAPSHOT_WRITE_DENIED %d\\n", reference < 0); if (reference >= 0) close(reference);
  int own = open("own.txt", O_WRONLY | O_CREAT, 0600); printf("WORKSPACE_ALLOWED %d\\n", own >= 0); if (own >= 0) close(own);
  pid_t child = fork(); if (!child) _exit(0); printf("FORK_DENIED %d\\n", child < 0); if (child > 0) waitpid(child, NULL, 0);
  fflush(stdout); execl("/bin/sh", "sh", "-c", "echo SHELL_ESCAPED", (char *)0);
  puts("SHELL_DENIED"); fflush(stdout);
  if (!strcmp(argv[3], "backpressure")) { char block[4096]; memset(block, 'x', sizeof(block)); for (;;) if (write(1, block, sizeof(block)) < 0) return 3; }
  for (;;) pause();
}`)
    await execute('/usr/bin/xcrun', ['clang', '-Wall', '-Wextra', '-Werror', source, '-o', executable])
    const domain = await launchTerminal(resolve('dist/native/pods-helper'), root, { executable, workspace, readFiles: [snapshot], runtimeDirectories: [] }, [canary, snapshot, mode], {})
    let output = ''
    const capture = (bytes: Buffer) => { output += bytes.toString() }
    domain.stdout.on('data', capture); domain.stderr.resume()
    try {
      await domain.processId
      await expect.poll(() => output).toContain('SHELL_DENIED')
      for (const proof of ['HOST_DENIED 1', 'SNAPSHOT_WRITE_DENIED 1', 'WORKSPACE_ALLOWED 1', 'FORK_DENIED 1']) expect(output).toContain(proof)
      if (mode === 'backpressure') { domain.stdout.removeListener('data', capture); domain.stdout.pause(); await delay(200) }
      domain.cancel()
      await expect.poll(async () => JSON.parse((await execute(resolve('dist/native/pods-helper'), ['inspect-domain', domain.recordPath])).stdout).quiescent, { timeout: 4000 }).toBe(true)
      domain.stdout.resume(); expect(await domain.completed).toBe(125)
      expect(await readFile(canary, 'utf8')).toBe('SYNTHETIC_HOST_SECRET')
      expect(await readFile(snapshot, 'utf8')).toBe('SYNTHETIC_REFERENCE')
    }
    finally { domain.stdout.resume(); domain.cancel(); await domain.completed }
  }
  finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
})

it('terminal: the external o365 protocol fixture refreshes and reads through its own persistent application state', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-terminal-o365-')))
  const fixture = await mailTLSFixture(root)
  const key = randomBytes(32)
  const cacheRoot = join(root, 'protected')
  const cache = new CredentialCache(cacheRoot, {
    available: () => true,
    encrypt: (value) => { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv); return Buffer.concat([iv, cipher.update(value), cipher.final(), cipher.getAuthTag()]) },
    decrypt: (value) => { const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12)); cipher.setAuthTag(value.subarray(-16)); return Buffer.concat([cipher.update(value.subarray(12, -16)), cipher.final()]).toString() },
  })
  const state = new ProgramState(cache); const binding = { podId: randomUUID(), applicationId: randomUUID() }
  try {
    const id = await state.create(binding)
    await state.use(id, binding, async (workspace) => {
      const domain = await launchTerminal(resolve('dist/native/pods-helper'), root, { executable: resolve('.artifacts/o365-fixture/o365-cli'), workspace, readFiles: [fixture.certificate], runtimeDirectories: [], networkPorts: [fixture.proxy.port] }, ['pods', 'login', '--account', 'pod@example.invalid', '--cache-dir', workspace], { ...fixture.proxy.environment, PODS_CA_FILE: fixture.certificate })
      let output = ''; domain.stdout.on('data', (bytes) => { output += bytes.toString() }); domain.stderr.resume()
      try {
        await domain.processId; expect(await domain.completed, `${output} ${JSON.stringify(fixture.state)}`).toBe(0)
        expect(output).toContain('deviceCode'); expect(output).toContain('connected'); expect(output).toContain('pod@example.invalid'); expect(output).not.toContain('SYNTHETIC_TLS_ACCESS')
      }
      finally { domain.cancel(); await domain.completed }
    })
    let cursor = ''; const ids: string[] = []
    for (let page = 0; page < 2; page++) {
      const reply = await state.use(id, binding, async (workspace) => {
        const domain = await launchTerminal(resolve('dist/native/pods-helper'), root, { executable: resolve('.artifacts/o365-fixture/o365-cli'), workspace, readFiles: [fixture.certificate], runtimeDirectories: [], networkPorts: [fixture.proxy.port] }, ['pods', 'read', '--account', 'pod@example.invalid', '--cache-dir', workspace, '--operation', 'messages', '--folder', 'inbox', ...(cursor ? ['--cursor', cursor] : [])], { ...fixture.proxy.environment, PODS_CA_FILE: fixture.certificate })
        let output = ''; domain.stdout.on('data', (bytes) => { output += bytes.toString() }); domain.stderr.resume()
        try { await domain.processId; expect(await domain.completed, `${output} ${JSON.stringify(fixture.state)}`).toBe(0); return JSON.parse(output) as { items: { id: string }[], nextCursor?: string } }
        finally { domain.cancel(); await domain.completed }
      })
      ids.push(...reply.items.map(item => item.id)); cursor = reply.nextCursor ?? ''
    }
    expect(ids).toEqual(['first', 'second']); expect(fixture.state).toMatchObject({ deviceCodes: 1, deviceTokens: 1, refreshes: 1, reads: 2 })
    expect((await readFile(join(cacheRoot, `${id}.encrypted`))).includes('SYNTHETIC_TLS_REFRESH')).toBe(false)
    await state.use(id, binding, async path => expect(await readFile(join(path, 'token.json'), 'utf8')).toContain('SYNTHETIC_TLS_REFRESH'))
    await expect(state.use(id, { ...binding, podId: randomUUID() }, async () => {})).rejects.toThrow('another application or pod')
  }
  finally { await fixture.close(); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
})

it('terminal boundary: rejects a workspace replaced by a symlink before native launch', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-terminal-swap-')))
  const workspace = join(root, 'workspace'); const outside = join(root, 'outside')
  await mkdir(workspace); await mkdir(outside)
  expect(await realpath(workspace)).toBe(workspace)
  await rm(workspace, { recursive: true }); await symlink(outside, workspace)
  let failure: unknown
  try {
    try {
      const domain = await launchTerminal(resolve('dist/native/pods-helper'), root, { executable: '/usr/bin/true', workspace, readFiles: [], runtimeDirectories: [] }, [], {})
      await domain.processId; await domain.completed
    }
    catch (error) { failure = error }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe('Terminal workspace changed before launch')
  }
  finally { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
})
