import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/shapes/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/shapes/index.js')>()
  return {
    ...original,
    appendAuditLog: vi.fn(),
  }
})

describe('ShellSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('logs a shell-session-start entry on construction', async () => {
    const { appendAuditLog } = await import('../src/shapes/index.js')
    const { ShellSession } = await import('../src/shell/session.js')

    const session = new ShellSession({ host: 'host.test', requester: 'alice@example.com' })

    expect(appendAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'shell-session-start',
      session_id: session.id,
      host: 'host.test',
      requester: 'alice@example.com',
    }))
    expect(session.id).toMatch(/^[0-9a-f]{16}$/)
  })

  it('logs granted lines with sequence numbers and grant id', async () => {
    const { appendAuditLog } = await import('../src/shapes/index.js')
    const { ShellSession } = await import('../src/shell/session.js')

    const session = new ShellSession({ host: 'h', requester: 'r' })
    vi.mocked(appendAuditLog).mockClear()

    const seq1 = session.logLineGranted({ line: 'ls', grantId: 'g1', grantMode: 'adapter' })
    const seq2 = session.logLineGranted({ line: 'pwd', grantId: 'g2', grantMode: 'adapter' })

    expect(seq1).toBe(1)
    expect(seq2).toBe(2)
    expect(appendAuditLog).toHaveBeenNthCalledWith(1, expect.objectContaining({
      action: 'shell-session-line',
      session_id: session.id,
      seq: 1,
      line: 'ls',
      grant_id: 'g1',
      grant_mode: 'adapter',
      status: 'executing',
    }))
    expect(appendAuditLog).toHaveBeenNthCalledWith(2, expect.objectContaining({
      seq: 2,
      line: 'pwd',
      grant_id: 'g2',
    }))
  })

  it('logs denied lines with reason and still consumes a seq number', async () => {
    const { appendAuditLog } = await import('../src/shapes/index.js')
    const { ShellSession } = await import('../src/shell/session.js')

    const session = new ShellSession({ host: 'h', requester: 'r' })
    vi.mocked(appendAuditLog).mockClear()

    session.logLineDenied({ line: 'rm -rf /', reason: 'Grant denied' })

    expect(appendAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'shell-session-line',
      status: 'denied',
      line: 'rm -rf /',
      reason: 'Grant denied',
      seq: 1,
    }))
  })

  it('logs line completion with exit code', async () => {
    const { appendAuditLog } = await import('../src/shapes/index.js')
    const { ShellSession } = await import('../src/shell/session.js')

    const session = new ShellSession({ host: 'h', requester: 'r' })
    const seq = session.logLineGranted({ line: 'false', grantId: 'g1', grantMode: 'adapter' })
    vi.mocked(appendAuditLog).mockClear()

    session.logLineDone({ seq, exitCode: 1 })

    expect(appendAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'shell-session-line-done',
      session_id: session.id,
      seq: 1,
      exit_code: 1,
    }))
  })

  it('logs session-end with duration and line count', async () => {
    const { appendAuditLog } = await import('../src/shapes/index.js')
    const { ShellSession } = await import('../src/shell/session.js')

    const session = new ShellSession({ host: 'h', requester: 'r' })
    session.logLineGranted({ line: 'a', grantId: 'g1', grantMode: 'adapter' })
    session.logLineGranted({ line: 'b', grantId: 'g2', grantMode: 'session' })
    vi.mocked(appendAuditLog).mockClear()

    session.close()

    expect(appendAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'shell-session-end',
      session_id: session.id,
      lines: 2,
      duration_ms: expect.any(Number),
    }))
  })
})
