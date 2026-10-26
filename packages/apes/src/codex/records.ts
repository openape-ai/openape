import { createHash, randomUUID } from 'node:crypto'
import { link, lstat, mkdir, open, readFile, unlink } from 'node:fs/promises'
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

export async function assertPrivateDirectory(directory: string): Promise<void> {
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o077)) {
    throw new Error('Receipt directory must be a real, owner-owned directory with mode 0700')
  }
}

export async function publishRecord(directory: string, name: string, value: unknown): Promise<boolean> {
  await assertPrivateDirectory(dirname(directory))
  try { await mkdir(directory, { mode: 0o700 }) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  await assertPrivateDirectory(directory)
  const parent = await open(dirname(directory), 'r')
  try { await parent.sync() }
  finally { await parent.close() }
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
