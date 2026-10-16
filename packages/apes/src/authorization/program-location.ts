import { createHash } from 'node:crypto'
import { accessSync, constants, createReadStream, realpathSync, statSync } from 'node:fs'
import { basename, delimiter, join, resolve } from 'node:path'
import type { LocatedProgram } from './program.js'

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false
    accessSync(path, constants.X_OK)
    return true
  }
  catch {
    return false
  }
}

/** The file a shell would run for `executable`: the path itself when it has a slash, else the first PATH match. */
export function findExecutable(executable: string, pathVariable = process.env.PATH ?? ''): string | null {
  if (executable.includes('/')) {
    const path = resolve(executable)
    return isExecutableFile(path) ? path : null
  }
  for (const directory of pathVariable.split(delimiter)) {
    if (!directory) continue
    const candidate = resolve(join(directory, executable))
    if (isExecutableFile(candidate)) return candidate
  }
  return null
}

export async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

/** Locates and hashes the program; null when no executable file exists for it. */
export async function locateProgram(executable: string): Promise<LocatedProgram | null> {
  const found = findExecutable(executable)
  if (!found) return null
  // The resolved file is hashed and later executed, so retargeting a symlink cannot swap the program in between.
  const path = realpathSync(found)
  return { path, argv0: found, name: basename(found), sha256: await hashFile(path) }
}
