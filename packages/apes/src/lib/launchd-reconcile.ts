import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import type { TaskSpec } from './troop-client'

// Reconciles /Library/LaunchDaemons/openape.troop.<agent>.<task>.plist
// against the desired set from the troop SP.
//
// One plist per task. Filename encodes the agent name + task slug so
// we can scope the diff with a glob — multiple agents on the same
// macOS user (uncommon but possible) don't step on each other's
// scheduled jobs. `enabled: false` tasks still get a plist written
// (so the user can see them in the LaunchDaemons listing) but the
// job is `bootout`-ed so launchd doesn't fire it.
//
// Plists live in /Library/LaunchDaemons (system domain) with a
// UserName key so launchd runs the daemon as the agent uid. Same
// reason as the troop-sync plist: hidden service-account agents
// (IsHidden=1, UID < 500, never log in) have no per-user launchd
// domain, so `launchctl bootstrap gui/<uid>` fails with "Domain does
// not support specified action". System-domain bootstrap doesn't
// need a user session.
//
// We avoid `launchctl` calls when nothing changed — content-equality
// on the existing file vs the desired plist body. macOS's launchctl
// is slow and verbose; a no-op sync should be silent.

export interface ReconcileResult {
  added: string[]
  updated: string[]
  removed: string[]
  unchanged: string[]
}

const PLIST_PREFIX = 'openape.troop.'

function plistDir(): string {
  return '/Library/LaunchDaemons'
}

function plistPath(agentName: string, taskId: string): string {
  return join(plistDir(), `${PLIST_PREFIX}${agentName}.${taskId}.plist`)
}

function plistLabel(agentName: string, taskId: string): string {
  return `${PLIST_PREFIX}${agentName}.${taskId}`
}

interface ScheduleSlot {
  Minute?: number
  Hour?: number
  Day?: number
  Month?: number
  Weekday?: number
}

// Translate our supported cron subset (* / N / */N) into one or more
// StartCalendarInterval slots. */N expands to all matching values
// (e.g. */15 on minute = [0, 15, 30, 45]) so launchd fires at every
// instance without needing to model "every Nth" natively.
function fieldValues(token: string, range: [number, number]): number[] | null {
  const [min, max] = range
  if (token === '*') return null // null = "any"
  if (token.startsWith('*/')) {
    const step = Number(token.slice(2))
    if (!Number.isInteger(step) || step < 1) return []
    const values: number[] = []
    for (let i = min; i <= max; i++) {
      if (i % step === 0) values.push(i)
    }
    return values
  }
  const n = Number(token)
  return Number.isInteger(n) ? [n] : []
}

function cronToSchedule(expr: string): ScheduleSlot[] {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return [] // server should already have rejected, but be safe
  const [m, h, dom, mo, dow] = parts as [string, string, string, string, string]
  const minutes = fieldValues(m, [0, 59])
  const hours = fieldValues(h, [0, 23])
  const doms = fieldValues(dom, [1, 31])
  const months = fieldValues(mo, [1, 12])
  // launchd Weekday: 0 = Sunday … 7 also = Sunday. Cron's 0/7 → 0.
  const dows = fieldValues(dow, [0, 7])

  const slots: ScheduleSlot[] = []
  // Cartesian-product over all explicit values; nulls are dropped (=
  // launchd "any"). For our subset this stays small (e.g. */15 on
  // minute = 4 entries; everything else usually * or fixed).
  const minList = minutes ?? [null]
  const hourList = hours ?? [null]
  const domList = doms ?? [null]
  const monthList = months ?? [null]
  const dowList = dows ?? [null]

  for (const M of minList) {
    for (const H of hourList) {
      for (const D of domList) {
        for (const Mo of monthList) {
          for (const W of dowList) {
            const slot: ScheduleSlot = {}
            if (M !== null) slot.Minute = M as number
            if (H !== null) slot.Hour = H as number
            if (D !== null) slot.Day = D as number
            if (Mo !== null) slot.Month = Mo as number
            if (W !== null) slot.Weekday = (W === 7 ? 0 : W) as number
            slots.push(slot)
          }
        }
      }
    }
  }
  return slots
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function plistBody(input: { label: string, apesBin: string, taskId: string, schedule: ScheduleSlot[], homeDir: string, userName: string }): string {
  const calendarBlocks = input.schedule.map((slot) => {
    const lines: string[] = []
    if (slot.Minute !== undefined) lines.push(`      <key>Minute</key><integer>${slot.Minute}</integer>`)
    if (slot.Hour !== undefined) lines.push(`      <key>Hour</key><integer>${slot.Hour}</integer>`)
    if (slot.Day !== undefined) lines.push(`      <key>Day</key><integer>${slot.Day}</integer>`)
    if (slot.Month !== undefined) lines.push(`      <key>Month</key><integer>${slot.Month}</integer>`)
    if (slot.Weekday !== undefined) lines.push(`      <key>Weekday</key><integer>${slot.Weekday}</integer>`)
    return `    <dict>\n${lines.join('\n')}\n    </dict>`
  }).join('\n')

  const calendarKey = input.schedule.length === 1
    ? `  <key>StartCalendarInterval</key>\n  <dict>\n${calendarBlocks.replace(/^ {4}/gm, '  ').replace(/^ {2}<dict>\n|\n {2}<\/dict>$/g, '')}\n  </dict>`
    : `  <key>StartCalendarInterval</key>\n  <array>\n${calendarBlocks}\n  </array>`

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escape(input.label)}</string>
  <key>UserName</key>
  <string>${escape(input.userName)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escape(input.apesBin)}</string>
    <string>agents</string>
    <string>run</string>
    <string>${escape(input.taskId)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escape(input.homeDir)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${escape(input.homeDir)}</string>
    <key>PATH</key>
    <string>${escape(input.homeDir)}/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
${calendarKey}
  <key>StandardOutPath</key>
  <string>${escape(input.homeDir)}/Library/Logs/openape-troop-${escape(input.taskId)}.log</string>
  <key>StandardErrorPath</key>
  <string>${escape(input.homeDir)}/Library/Logs/openape-troop-${escape(input.taskId)}.log</string>
</dict>
</plist>
`
}

interface BuildArgs {
  agentName: string
  apesBin: string
  homeDir: string
  task: TaskSpec
  /**
   * macOS short username for the UserName plist key (the agent that
   * launchd should run the task as). Defaults to the current user when
   * not supplied — handy in tests.
   */
  userName?: string
}

function buildPlistContent(args: BuildArgs): string {
  return plistBody({
    label: plistLabel(args.agentName, args.task.taskId),
    apesBin: args.apesBin,
    taskId: args.task.taskId,
    schedule: cronToSchedule(args.task.cron),
    homeDir: args.homeDir,
    userName: args.userName ?? userInfo().username,
  })
}

function bootstrap(label: string, path: string): void {
  // System-domain bootstrap (no user session needed). Idempotent —
  // bootout first (silent if not loaded), then bootstrap.
  try { execFileSync('/bin/launchctl', ['bootout', `system/${label}`], { stdio: 'ignore' }) }
  catch { /* not loaded */ }
  execFileSync('/bin/launchctl', ['bootstrap', 'system', path], { stdio: 'ignore' })
}

function bootout(label: string): void {
  try { execFileSync('/bin/launchctl', ['bootout', `system/${label}`], { stdio: 'ignore' }) }
  catch { /* not loaded */ }
}

export interface ReconcileInput {
  agentName: string
  apesBin: string
  homeDir: string
  desired: TaskSpec[]
  /**
   * macOS short username for the UserName plist key. Defaults to the
   * current user — that's only correct in tests; production sync runs
   * as ROOT so the caller MUST pass the agent's username explicitly.
   */
  userName?: string
}

export function reconcile(input: ReconcileInput): ReconcileResult {
  mkdirSync(plistDir(), { recursive: true })

  const present = readdirSync(plistDir())
    .filter(f => f.startsWith(`${PLIST_PREFIX}${input.agentName}.`) && f.endsWith('.plist'))
  const presentTaskIds = new Set(
    present.map(f => f.slice(`${PLIST_PREFIX}${input.agentName}.`.length, -'.plist'.length)),
  )
  const desiredById = new Map(input.desired.map(t => [t.taskId, t]))

  const result: ReconcileResult = { added: [], updated: [], removed: [], unchanged: [] }

  // Remove plists that no longer have a matching task.
  for (const taskId of presentTaskIds) {
    if (!desiredById.has(taskId)) {
      const path = plistPath(input.agentName, taskId)
      bootout(plistLabel(input.agentName, taskId))
      try { unlinkSync(path) }
      catch { /* already gone */ }
      result.removed.push(taskId)
    }
  }

  // Write / update plists for desired tasks.
  for (const task of input.desired) {
    const path = plistPath(input.agentName, task.taskId)
    const desiredContent = buildPlistContent({
      agentName: input.agentName,
      apesBin: input.apesBin,
      homeDir: input.homeDir,
      task,
      userName: input.userName,
    })

    let existingContent = ''
    try { existingContent = readFileSync(path, 'utf8') }
    catch { /* not yet */ }

    if (existingContent === desiredContent) {
      // File identical — only adjust load state if `enabled` flipped.
      if (task.enabled) bootstrap(plistLabel(input.agentName, task.taskId), path)
      else bootout(plistLabel(input.agentName, task.taskId))
      result.unchanged.push(task.taskId)
      continue
    }

    writeFileSync(path, desiredContent, { mode: 0o644 })
    if (task.enabled) bootstrap(plistLabel(input.agentName, task.taskId), path)
    else bootout(plistLabel(input.agentName, task.taskId))

    if (presentTaskIds.has(task.taskId)) result.updated.push(task.taskId)
    else result.added.push(task.taskId)
  }

  return result
}

// Test seam — exposes the cron→launchd translator without going
// through the file system. Same algorithm reconcile() uses.
export const _internal = { cronToSchedule, buildPlistContent }
