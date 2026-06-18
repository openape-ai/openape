import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { addReadRoot, TOOLS } from '../src/agent-tools/index'

const fileRead = TOOLS['file.read']!
const fileWrite = TOOLS['file.write']!

// A dir outside $HOME, standing in for the bundled default-skills dir.
let dir: string
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

describe('file.read extra read roots', () => {
  it('rejects reads outside $HOME when no root is registered', async () => {
    dir = mkdtempSync(join(tmpdir(), 'unreg-'))
    const f = join(dir, 'SKILL.md')
    writeFileSync(f, 'hello')
    await expect(fileRead.execute({ path: f })).rejects.toThrow(/outside the agent's home/)
  })

  it('allows file.read under a registered root but keeps file.write jailed to $HOME', async () => {
    dir = mkdtempSync(join(tmpdir(), 'skills-'))
    const f = join(dir, 'SKILL.md')
    writeFileSync(f, 'skill body')
    addReadRoot(dir)

    const res = await fileRead.execute({ path: f }) as { content: string }
    expect(res.content).toBe('skill body')

    // Registering a read root must NOT open it up for writes.
    await expect(fileWrite.execute({ path: join(dir, 'x.txt'), content: 'no' }))
      .rejects
      .toThrow(/outside the agent's home/)
  })
})
