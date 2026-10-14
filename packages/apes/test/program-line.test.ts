import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { runProgramInShellState } from '../src/authorization/execute.js'
import { locateProgram } from '../src/authorization/program.js'
import { PtyBridge } from '../src/shell/pty-bridge.js'
import { programLine } from '../src/shell/program-line.js'

// A line only counts as a program call when bash would run exactly its words.
// Such a call is then started by apes itself, outside bash, so nothing the
// session defines (aliases, functions, traps) can run instead.

describe('programLine', () => {
  it('accepts plain words, including quoted ones', () => {
    expect(programLine('git commit -m "two words"')).toEqual({ executable: 'git', argv: ['commit', '-m', 'two words'] })
    expect(programLine('/usr/bin/env')).toEqual({ executable: '/usr/bin/env', argv: [] })
  })

  it.each([
    'ls; rm -rf ~',
    'ls && whoami',
    'ls | wc -l',
    'echo $(id)',
    'echo `id`',
    'ls > out.txt',
    'cat < in.txt',
    'ls $HOME',
    'ls *.txt',
    'ls ~/x',
    'echo {a,b}',
    'FOO=1 ls',
    'ls # comment',
    'ls\nwhoami',
    'cd /tmp',
    'echo hi',
    'ls &',
  ])('leaves %j to the shell session path', (line) => {
    expect(programLine(line)).toBeNull()
  })
})

describe('authorized program calls of the interactive shell', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'apes-program-line-')))
  const bin = join(dir, 'bin')
  const work = join(dir, 'work')
  const marker = join(dir, 'ran.txt')
  const program = join(bin, 'fakeprog')
  mkdirSync(bin)
  mkdirSync(work)
  writeFileSync(program, `#!/bin/sh\n{ pwd; printf '%s\\n' "$APES_PROBE" "$0" "$@"; } > '${marker}'\n`)
  chmodSync(program, 0o755)
  symlinkSync(program, join(bin, 'linked'))
  const bridges: PtyBridge[] = []

  afterEach(() => {
    for (const bridge of bridges.splice(0)) bridge.kill('SIGKILL')
    vi.unstubAllEnvs()
    rmSync(marker, { force: true })
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  async function session(lines: string[]): Promise<PtyBridge> {
    vi.stubEnv('APES_SHELL_CLEAN_START', '1')
    let done: (() => void) | null = null
    const bridge = new PtyBridge({ onOutput: () => {}, onLineDone: () => done?.(), onExit: () => {} })
    bridges.push(bridge)
    await bridge.waitForReady()
    for (const line of lines) {
      await new Promise<void>((resolve) => {
        done = resolve
        bridge.writeLine(line)
      })
    }
    return bridge
  }

  it('starts the authorized file itself in the session state; functions, aliases and traps cannot take over', async () => {
    const hijacked = join(dir, 'hijacked.txt')
    const bridge = await session([
      `builtin() { echo builtin >> '${hijacked}'; }`,
      `command() { echo command >> '${hijacked}'; }`,
      `fakeprog() { echo function >> '${hijacked}'; }`,
      `shopt -s expand_aliases; alias fakeprog='echo alias >> ${hijacked}'`,
      `cd '${work}'`,
      'export APES_PROBE=from-session',
      `trap 'echo trap >> ${hijacked}' DEBUG`,
    ])
    rmSync(hijacked, { force: true })
    const located = (await locateProgram(program))!
    const started: string[] = []

    const run = runProgramInShellState({ program: located, argv: ['it\'s', '; echo injected', '$(id)'] }, () => bridge.shellState(), () => started.push('start'))

    expect(run).toEqual({ kind: 'ran', exitCode: 0 })
    expect(started).toEqual(['start'])
    expect(readFileSync(marker, 'utf-8').trimEnd().split('\n')).toEqual([work, 'from-session', program, 'it\'s', '; echo injected', '$(id)'])
    expect(existsSync(hijacked)).toBe(false)
  })

  it('refuses when the session state is not readable as a working directory, e.g. altered by a trap', async () => {
    const bridge = await session(['trap \'echo noise\' DEBUG'])
    const located = (await locateProgram(program))!
    const started: string[] = []

    const run = runProgramInShellState({ program: located, argv: [] }, () => bridge.shellState(), () => started.push('start'))

    expect(run).toEqual({ kind: 'refused', reason: 'The shell session reported no working directory' })
    expect(started).toEqual([])
    expect(existsSync(marker)).toBe(false)
  })

  it('refuses a file changed after authorization without starting it', async () => {
    const bridge = await session([])
    const located = (await locateProgram(program))!
    writeFileSync(program, `#!/bin/sh\necho swapped > '${marker}'\n`)
    const started: string[] = []

    const run = runProgramInShellState({ program: located, argv: [] }, () => bridge.shellState(), () => started.push('start'))

    expect(run).toEqual({ kind: 'refused', reason: `${program} changed after it was authorized; nothing was executed` })
    expect(started).toEqual([])
    expect(existsSync(marker)).toBe(false)
  })

  it('hashes and runs the resolved file of a symlink, keeping the invoked name', async () => {
    writeFileSync(program, `#!/bin/sh\nprintf '%s\\n' "$0" > '${marker}'\n`)
    const located = (await locateProgram(join(bin, 'linked')))!

    expect(located).toMatchObject({ path: program, argv0: join(bin, 'linked'), name: 'linked' })
  })
})
