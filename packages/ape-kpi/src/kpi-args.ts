/**
 * Pure argument shaping for `ape-kpi push` — extracted so it is unit-testable
 * without spawning the CLI.
 */

export interface PushBody {
  key: string
  value: number
  scope?: string
  unit?: string
  detail?: string
}

export type PushParse
  = | { ok: true, body: PushBody }
    | { ok: false, error: string }

export function parsePushArgs(args: {
  key?: string
  value?: string
  scope?: string
  unit?: string
  detail?: string
}): PushParse {
  const key = args.key?.trim()
  if (!key)
    return { ok: false, error: 'key required — ape-kpi push <key> <value>' }

  const value = Number(args.value)
  if (args.value === undefined || args.value === '' || !Number.isFinite(value))
    return { ok: false, error: `value must be a finite number, got "${args.value}"` }

  return {
    ok: true,
    body: {
      key,
      value,
      ...(args.scope ? { scope: args.scope } : {}),
      ...(args.unit ? { unit: args.unit } : {}),
      ...(args.detail ? { detail: args.detail } : {}),
    },
  }
}
