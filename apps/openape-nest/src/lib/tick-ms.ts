const DEFAULT_NEST_TICK_MS = 60_000

export function resolveNestTickMs(value: string | undefined, log?: (line: string) => void): number {
  if (value === undefined)
    return DEFAULT_NEST_TICK_MS

  const parsed = Number(value)
  if (Number.isFinite(parsed) && parsed > 0)
    return parsed

  log?.(`nest: invalid OPENAPE_NEST_TICK_MS=${JSON.stringify(value)}; falling back to ${DEFAULT_NEST_TICK_MS}ms`)
  return DEFAULT_NEST_TICK_MS
}

export { DEFAULT_NEST_TICK_MS }
