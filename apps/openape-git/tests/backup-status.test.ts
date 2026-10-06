import { describe, expect, it } from 'vitest'
import { evaluateBackup } from '../server/utils/backup-status'

const NOW = Date.parse('2026-08-28T12:00:00Z')
const MAX_AGE = 36 * 3600

function status(fields: Record<string, unknown>) {
  return JSON.stringify(fields)
}

describe('evaluateBackup', () => {
  it('is unhealthy when no backup has ever run', () => {
    const v = evaluateBackup(null, NOW, MAX_AGE)
    expect(v.healthy).toBe(false)
    expect(v.reason).toContain('no backup')
  })

  it('is unhealthy when the status file is garbage', () => {
    expect(evaluateBackup('not json', NOW, MAX_AGE).healthy).toBe(false)
    expect(evaluateBackup(status({ ok: true }), NOW, MAX_AGE).healthy).toBe(false)
  })

  it('is healthy for a fresh successful run', () => {
    const v = evaluateBackup(status({ ok: true, finishedAt: '2026-08-28T03:00:00Z', snapshotId: 'abc123' }), NOW, MAX_AGE)
    expect(v.healthy).toBe(true)
    expect(v.ageSec).toBe(9 * 3600)
    expect(v.snapshotId).toBe('abc123')
  })

  it('reports the failure of the last run', () => {
    const v = evaluateBackup(status({ ok: false, finishedAt: '2026-08-28T03:00:00Z', error: 'sftp unreachable' }), NOW, MAX_AGE)
    expect(v.healthy).toBe(false)
    expect(v.reason).toContain('sftp unreachable')
  })

  it('turns red once the last successful run is past the age limit', () => {
    const ok = status({ ok: true, finishedAt: '2026-08-27T01:00:00Z' })
    expect(evaluateBackup(ok, NOW, MAX_AGE).healthy).toBe(true)
    expect(evaluateBackup(ok, NOW, 24 * 3600).healthy).toBe(false)
    expect(evaluateBackup(ok, NOW, 24 * 3600).reason).toContain('35h old')
  })
})
