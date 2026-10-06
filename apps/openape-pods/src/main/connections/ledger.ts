import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { inspectDomainRecords } from '../../worker/recovery/domains'

interface Record { path: string, owner_pid: number }
function records(root: string): Record[] {
  const path = join(root, 'domains.json')
  if (!existsSync(path)) return []
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!Array.isArray(value) || value.length > 10000 || value.some(row => !row || typeof row.path !== 'string' || !Number.isSafeInteger(row.owner_pid))) throw new Error('Authentication recovery records are invalid')
  return value as Record[]
}
function save(root: string, value: Record[]): void {
  const staging = join(root, `.domains-${randomUUID()}`)
  const file = openSync(staging, 'wx', 0o600)
  try { writeFileSync(file, JSON.stringify(value)); fsyncSync(file) }
  finally { closeSync(file) }
  renameSync(staging, join(root, 'domains.json'))
  const directory = openSync(root, 'r'); try { fsyncSync(directory) }
  finally { closeSync(directory) }
}
export function registerAuthDomain(root: string, path: string, ownerPid: number): void {
  const current = records(root)
  if (current.length >= 10000) throw new Error('Authentication recovery ledger is full; restart to inspect old attempts')
  current.push({ path, owner_pid: ownerPid }); save(root, current)
}
export async function recoverAuthDomains(root: string, helper: string): Promise<void> {
  if (!existsSync(root)) return
  await inspectDomainRecords(records(root).map(row => ({ ...row })), root, helper); save(root, [])
}
