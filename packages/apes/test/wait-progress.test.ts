import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// #1065: `ape-shell -c` with APE_WAIT=1 used to poll for the grant
// decision in total silence for up to 5 minutes. Callers with a stall
// heuristic (the OpenApe worker kills tasks after 150 s without stream
// output) terminated healthy waits. These tests pin the observable fix:
// a short progress line on stderr every 15 s, none on immediate
// approval, suppressible via APES_QUIET_WAIT=1, and stdout untouched.

const apiFetchMock = vi.fn()

vi.mock('@openape/shapes', async (importOriginal) => {
  const real = await importOriginal<typeof import('@openape/shapes')>()
  return {
    ...real,
    apiFetch: (...args: unknown[]) => apiFetchMock(...args),
    getGrantsEndpoint: vi.fn(async () => 'http://idp.test/api/grants'),
  }
})

// Sandbox HOME so nothing in the import chain can ever touch the real
// ~/.config/apes/auth.json.
const realHome = process.env.HOME
beforeAll(() => {
  process.env.HOME = mkdtempSync(join(tmpdir(), 'apes-wait-progress-'))
})
afterAll(() => {
  process.env.HOME = realHome
})

let stderrWrite: ReturnType<typeof vi.spyOn>
let stdoutWrite: ReturnType<typeof vi.spyOn>

function progressLines(): string[] {
  return stderrWrite.mock.calls
    .map(call => String(call[0]))
    .filter(line => line.includes('still waiting'))
}

beforeEach(() => {
  vi.useFakeTimers()
  stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true) as ReturnType<typeof vi.spyOn>
  stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true) as ReturnType<typeof vi.spyOn>
})

afterEach(() => {
  stderrWrite.mockRestore()
  stdoutWrite.mockRestore()
  vi.useRealTimers()
  delete process.env.APES_QUIET_WAIT
  apiFetchMock.mockReset()
})

describe('createWaitProgressReporter', () => {
  it('writes nothing before the first interval elapses', async () => {
    const { createWaitProgressReporter } = await import('../src/wait-progress.js')
    const report = createWaitProgressReporter('grant-1234abcd')

    vi.advanceTimersByTime(14_999)
    report()

    expect(progressLines()).toHaveLength(0)
  })

  it('writes one stderr line per elapsed 15 s interval, stdout untouched', async () => {
    const { createWaitProgressReporter } = await import('../src/wait-progress.js')
    const report = createWaitProgressReporter('grant-1234abcd')

    // Simulate a 3 s poll loop that stays pending for 45 s.
    for (let tick = 0; tick < 15; tick++) {
      vi.advanceTimersByTime(3_000)
      report()
    }

    const lines = progressLines()
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('15s')
    expect(lines[1]).toContain('30s')
    expect(lines[2]).toContain('45s')
    // Only the id prefix is shown, never the full grant id.
    expect(lines[0]).toContain('grant-12')
    expect(lines[0]).not.toContain('grant-1234abcd')
    expect(stdoutWrite).not.toHaveBeenCalled()
  })

  it('is suppressed by APES_QUIET_WAIT=1', async () => {
    process.env.APES_QUIET_WAIT = '1'
    const { createWaitProgressReporter } = await import('../src/wait-progress.js')
    const report = createWaitProgressReporter('grant-1234abcd')

    for (let tick = 0; tick < 15; tick++) {
      vi.advanceTimersByTime(3_000)
      report()
    }

    expect(progressLines()).toHaveLength(0)
  })
})

describe('waitForGrantStatus progress (#1065)', () => {
  it('emits progress lines while pending and resolves once approved', async () => {
    let polls = 0
    // Pending for 11 polls (t=0..30 s), approved on the 12th (t=33 s):
    // progress lines are due at 15 s and 30 s.
    apiFetchMock.mockImplementation(async () => (++polls <= 11 ? { status: 'pending' } : { status: 'approved' }))

    const { waitForGrantStatus } = await import('../src/shapes/grants.js')
    const promise = waitForGrantStatus('http://idp.test', 'grant-1234abcd')
    await vi.advanceTimersByTimeAsync(60_000)

    await expect(promise).resolves.toBe('approved')
    const lines = progressLines()
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('15s')
    expect(lines[0]).toContain('grant-12')
    expect(lines[1]).toContain('30s')
    expect(stdoutWrite).not.toHaveBeenCalled()
  })

  it('emits nothing when the grant is approved immediately', async () => {
    apiFetchMock.mockResolvedValue({ status: 'approved' })

    const { waitForGrantStatus } = await import('../src/shapes/grants.js')
    await expect(waitForGrantStatus('http://idp.test', 'grant-1234abcd')).resolves.toBe('approved')

    expect(progressLines()).toHaveLength(0)
  })

  it('emits nothing with APES_QUIET_WAIT=1 even on a slow approval', async () => {
    process.env.APES_QUIET_WAIT = '1'
    let polls = 0
    apiFetchMock.mockImplementation(async () => (++polls <= 11 ? { status: 'pending' } : { status: 'approved' }))

    const { waitForGrantStatus } = await import('../src/shapes/grants.js')
    const promise = waitForGrantStatus('http://idp.test', 'grant-1234abcd')
    await vi.advanceTimersByTimeAsync(60_000)

    await expect(promise).resolves.toBe('approved')
    expect(progressLines()).toHaveLength(0)
  })
})
