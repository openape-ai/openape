import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { appendGenericCallLog  } from '../src/audit/generic-log.js'
import type { GenericCallLogEntry } from '../src/audit/generic-log.js'

describe('appendGenericCallLog', () => {
  let tmpDir: string
  const logPath = () => join(tmpDir, 'generic-calls.log')

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'apes-generic-log-'))
  })

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('writes a single JSONL entry', async () => {
    const entry: GenericCallLogEntry = {
      ts: '2026-04-17T12:00:00.000Z',
      cli: 'kubectl',
      argv: ['kubectl', 'get', 'pods'],
      argv_hash: 'SHA-256:aaaabbbb',
      grant_id: 'grant-123',
      exit_code: 0,
      duration_ms: 1234,
    }

    await appendGenericCallLog(entry, logPath())
    const content = await readFile(logPath(), 'utf-8')
    expect(content.trimEnd()).toBe(JSON.stringify(entry))
  })

  it('appends (does not overwrite) on subsequent calls', async () => {
    const second: GenericCallLogEntry = {
      ts: '2026-04-17T12:00:01.000Z',
      cli: 'kubectl',
      argv: ['kubectl', 'get', 'nodes'],
      argv_hash: 'SHA-256:cccc',
      grant_id: 'grant-456',
      exit_code: 0,
      duration_ms: 500,
    }
    const third: GenericCallLogEntry = {
      ts: '2026-04-17T12:00:02.000Z',
      cli: 'terraform',
      argv: ['terraform', 'plan'],
      argv_hash: 'SHA-256:dddd',
      grant_id: 'grant-789',
      exit_code: 2,
      duration_ms: 8000,
    }

    await appendGenericCallLog(second, logPath())
    await appendGenericCallLog(third, logPath())

    const content = await readFile(logPath(), 'utf-8')
    const lines = content.trimEnd().split('\n')
    expect(lines).toHaveLength(3) // includes the first from the previous test
    const parsed = lines.map(l => JSON.parse(l)) as GenericCallLogEntry[]
    expect(parsed[1]!.grant_id).toBe('grant-456')
    expect(parsed[2]!.grant_id).toBe('grant-789')
    expect(parsed[2]!.exit_code).toBe(2)
  })

  it('creates the containing directory if it does not exist', async () => {
    const deep = join(tmpDir, 'nested', 'dir', 'log.jsonl')
    const entry: GenericCallLogEntry = {
      ts: '2026-04-17T12:00:03.000Z',
      cli: 'aws',
      argv: ['aws', 's3', 'ls'],
      argv_hash: 'SHA-256:eeee',
      grant_id: 'grant-aws',
      exit_code: 0,
      duration_ms: 200,
    }
    await appendGenericCallLog(entry, deep)
    const content = await readFile(deep, 'utf-8')
    expect(JSON.parse(content.trimEnd())).toEqual(entry)
  })
})
