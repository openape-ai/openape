/**
 * Off-site backup status (plan M7). The backup runs outside the app — a cron
 * job on the VM writes `${gitDataDir}/backup-status.json` after every run —
 * so the app only reads that file and judges whether the backup is current.
 * That judgement is what monitor.openape.ai polls.
 */
export interface BackupStatus {
  ok: boolean
  finishedAt: string
  snapshotId?: string
  error?: string
}

export interface BackupVerdict {
  healthy: boolean
  reason?: string
  ageSec?: number
  finishedAt?: string
  snapshotId?: string
}

/**
 * Judge a raw status file. `raw` is null when no backup has ever run.
 * Anything but a fresh, successful run is unhealthy — a stale backup is a
 * silent backup, which is the failure mode this endpoint exists to catch.
 */
export function evaluateBackup(raw: string | null, nowMs: number, maxAgeSec: number): BackupVerdict {
  if (raw === null)
    return { healthy: false, reason: 'no backup has run yet' }

  let status: BackupStatus
  try {
    status = JSON.parse(raw)
  }
  catch {
    return { healthy: false, reason: 'backup status file is not valid JSON' }
  }

  const finishedMs = Date.parse(status.finishedAt ?? '')
  if (Number.isNaN(finishedMs))
    return { healthy: false, reason: 'backup status file has no usable finishedAt' }

  const ageSec = Math.round((nowMs - finishedMs) / 1000)
  const base = { ageSec, finishedAt: status.finishedAt, snapshotId: status.snapshotId }

  if (!status.ok)
    return { healthy: false, reason: `last backup failed: ${status.error ?? 'unknown error'}`, ...base }

  if (ageSec > maxAgeSec)
    return { healthy: false, reason: `last backup is ${Math.round(ageSec / 3600)}h old (limit ${Math.round(maxAgeSec / 3600)}h)`, ...base }

  return { healthy: true, ...base }
}
