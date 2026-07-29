import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveCompoundCommand } from '../src/compound.js'

// A minimal adapter in the cwd adapter dir so one segment resolves
// structured while the other falls back to generic. The registry is
// pointed at an unreachable URL so no network is touched.
const ADAPTER_DIR = join(process.cwd(), '.openape', 'shapes', 'adapters')
const ADAPTER_TOML = `schema = "openape-shapes/v1"

[cli]
id = "mailx"
executable = "mailx-cli"
audience = "shapes"
version = "1"

[[operation]]
id = "mail.list"
command = ["mail", "list"]
display = "List mails"
action = "list"
risk = "low"
resource_chain = ["mail:*"]
`

beforeAll(() => {
  process.env.SHAPES_REGISTRY_URL = 'http://127.0.0.1:1/unreachable.json'
  mkdirSync(ADAPTER_DIR, { recursive: true })
  writeFileSync(join(ADAPTER_DIR, 'mailx.toml'), ADAPTER_TOML)
})

afterAll(() => {
  rmSync(join(ADAPTER_DIR, 'mailx.toml'), { force: true })
})

describe('resolveCompoundCommand', () => {
  it('resolves each pipe segment on its own — adapter where shaped, generic otherwise', async () => {
    const result = await resolveCompoundCommand(['bash', '-c', 'mailx-cli mail list --json | jq -r ".[].id"'])
    expect(result).not.toBeNull()
    expect(result!.segments).toHaveLength(2)
    expect(result!.segments[0]!.detail.cli_id).toBe('mailx')
    expect(result!.segments[0]!.detail.risk).toBe('low')
    expect(result!.segments[1]!.detail.cli_id).toBe('jq')
    expect(result!.segments[1]!.detail.operation_id).toBe('_generic.exec')
    expect(result!.segments[1]!.detail.risk).toBe('high')
    expect(result!.details.length).toBeGreaterThanOrEqual(2)
    expect(result!.audience).toBe('shapes')
    // Execution context binds the ORIGINAL wrapped argv, not a segment.
    expect(result!.executionContext.argv).toEqual(['bash', '-c', 'mailx-cli mail list --json | jq -r ".[].id"'])
    expect(result!.executionContext.argv_hash).toBeTruthy()
  })

  it('resolves && chains of shaped commands into multiple structured details', async () => {
    const result = await resolveCompoundCommand(['bash', '-c', 'mailx-cli mail list && mailx-cli mail list --limit 5'])
    expect(result).not.toBeNull()
    expect(result!.segments).toHaveLength(2)
    expect(result!.segments.every(s => s.detail.cli_id === 'mailx')).toBe(true)
    // Identical permissions merge.
    expect(result!.details).toHaveLength(1)
  })

  it('returns null when any segment contains command substitution (fail closed)', async () => {
    expect(await resolveCompoundCommand(['bash', '-c', 'mailx-cli mail list $(cat /tmp/x) | jq .'])).toBeNull()
  })

  it('returns null for non bash -c argv shapes', async () => {
    expect(await resolveCompoundCommand(['mailx-cli', 'mail', 'list'])).toBeNull()
    expect(await resolveCompoundCommand(['bash', '-c', 'mailx-cli mail list', 'extra'])).toBeNull()
  })

  it('returns null when a segment carries redirections (unmodelled semantics)', async () => {
    expect(await resolveCompoundCommand(['bash', '-c', 'mailx-cli mail list 2>/dev/null | jq .'])).toBeNull()
  })

  it('returns null for a single-segment line (the non-compound path owns it)', async () => {
    expect(await resolveCompoundCommand(['bash', '-c', 'mailx-cli mail list --json'])).toBeNull()
  })
})
