export function printJson(data: unknown): void {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`)
}

export function printLine(line: string): void {
  process.stdout.write(`${line}\n`)
}

export function printNdjson(obj: unknown): void {
  process.stdout.write(`${JSON.stringify(obj)}\n`)
}

export function fmtTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z')
}
