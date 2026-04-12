import { spawn } from 'node:child_process'
import consola from 'consola'
import { quote } from 'shell-quote'
import { loadConfig } from './config'

export interface PendingGrantInfo {
  grantId: string
  approveUrl: string
  command: string
  audience: string
  host: string
}

/**
 * Resolve the notification command for pending grants. Checks (in order):
 *   1. `APES_NOTIFY_PENDING_COMMAND` env var (highest priority — lets
 *      parent programs like openclaw override per invocation)
 *   2. `[notifications] pending_command` in ~/.config/apes/config.toml
 *
 * Returns undefined if no notification command is configured.
 */
function resolvePendingCommand(): string | undefined {
  if (process.env.APES_NOTIFY_PENDING_COMMAND)
    return process.env.APES_NOTIFY_PENDING_COMMAND

  const config = loadConfig()
  return config.notifications?.pending_command
}

/**
 * Escape a value for safe embedding inside a single-quoted shell string.
 * We use `shell-quote` to produce a safe literal, then strip the outer
 * quoting because the template substitution embeds the value inside the
 * user's command template which is itself passed to `sh -c`.
 */
function shellEscape(value: string): string {
  // quote() wraps in single quotes and escapes internal single quotes
  // e.g. "it's" → "'it'\\''s'"
  // We return the raw escaped form so it's safe inside sh -c.
  return quote([value])
}

/**
 * Substitute template variables in the notification command.
 * All values are shell-escaped to prevent injection.
 */
function renderTemplate(template: string, info: PendingGrantInfo): string {
  return template
    .replace(/\{grant_id\}/g, shellEscape(info.grantId))
    .replace(/\{approve_url\}/g, shellEscape(info.approveUrl))
    .replace(/\{command\}/g, shellEscape(info.command))
    .replace(/\{audience\}/g, shellEscape(info.audience))
    .replace(/\{host\}/g, shellEscape(info.host))
}

/**
 * Send a notification that a grant is awaiting human approval.
 *
 * This is **fire-and-forget**: the notification subprocess runs detached
 * and unref'd so it cannot block the grant flow. A 10-second timeout
 * kills it if it hangs (e.g. network issue reaching Telegram API).
 *
 * Only fires when a notification command is configured. Silently returns
 * if not — the grant flow must never depend on notifications.
 *
 * Only call this when the grant **actually requires waiting** (new grant
 * with pending status). Do NOT call when:
 * - An existing timed/always grant was reused (no human action needed)
 * - The grant was instantly approved (no waiting phase)
 */
export function notifyGrantPending(info: PendingGrantInfo): void {
  const template = resolvePendingCommand()
  if (!template)
    return

  const rendered = renderTemplate(template, info)

  try {
    const child = spawn('sh', ['-c', rendered], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    })

    // Don't let the notification process keep the parent alive
    child.unref()

    // Kill after 10 seconds if it hasn't exited
    const timeout = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      }
      catch {}
    }, 10_000)
    timeout.unref()

    child.on('exit', () => clearTimeout(timeout))
  }
  catch (err) {
    // Never let notification failure break the grant flow
    consola.debug('Notification command failed:', err)
  }
}
