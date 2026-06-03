/**
 * Generic output helpers shared across OpenApe CLIs.
 * No SP-specific logic lives here.
 */

export function printJson(data: unknown): void {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`)
}

export function printLine(line: string): void {
  process.stdout.write(`${line}\n`)
}

export function printNdjson(obj: unknown): void {
  process.stdout.write(`${JSON.stringify(obj)}\n`)
}

/**
 * Format a Unix-seconds timestamp as a compact ISO-8601 string without
 * sub-second precision (e.g. `2026-06-03 09:15:30Z`).
 */
export function fmtTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z')
}
