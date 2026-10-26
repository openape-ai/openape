import { createHash, randomUUID } from 'node:crypto'
import { link, mkdir, open, readFile, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export async function readRecord(directory: string, name: string): Promise<unknown | undefined> {
  try { return JSON.parse(await readFile(join(directory, `${name}.json`), 'utf8')) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export async function publishRecord(directory: string, name: string, value: unknown): Promise<boolean> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  let current = directory
  while (dirname(current) !== current) {
    const parent = await open(dirname(current), 'r')
    try { await parent.sync() }
    finally { await parent.close() }
    current = dirname(current)
  }
  const temporary = join(directory, `.${randomUUID()}.tmp`)
  const file = await open(temporary, 'wx', 0o600)
  try {
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`)
    await file.sync()
  }
  finally { await file.close() }
  try {
    await link(temporary, join(directory, `${name}.json`))
    const folder = await open(directory, 'r')
    try { await folder.sync() }
    finally { await folder.close() }
    return true
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw error
  }
  finally {
    try { await unlink(temporary) }
    catch (error) { process.stderr.write(`Receipt temporary cleanup failed: ${(error as NodeJS.ErrnoException).code ?? 'unknown'}\n`) }
  }
}
