import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { programCommandLine, programLine } from '../src/shell/program-line.js'

// A line only counts as a program call when bash would run exactly its words;
// for such a call bash then runs the authorized file and argv, never the typed
// line, so no bash parsing can differ from what was authorized.

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

describe('programCommandLine', () => {
  const dir = mkdtempSync(join(tmpdir(), 'apes-program-line-'))
  const program = join(dir, 'fake tool')
  writeFileSync(program, '#!/bin/sh\nfor a in "$@"; do printf "[%s]\\n" "$a"; done\n')
  chmodSync(program, 0o755)

  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('runs the authorized file with exactly its arguments even when aliases and functions shadow the name', () => {
    const argv = ['it\'s', 'a "quote"', '; echo injected', '$(id)', '`id`', '*', '~', '']
    const line = programCommandLine(program, argv)
    const script = [
      'shopt -s expand_aliases',
      'command() { echo function ran; }',
      'tool() { echo function ran; }',
      'alias builtin=\'echo alias ran\'',
      'alias command=\'echo alias ran\'',
      line,
    ].join('\n')

    const output = execFileSync('bash', ['-c', script], { cwd: dir, encoding: 'utf-8' })

    expect(output).toBe(`${argv.map(argument => `[${argument}]`).join('\n')}\n`)
  })
})
