import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { parseCredentialValue } from '../../contracts/credentials'

export async function importPrivateSecret<T>(path: string, save: (value: string) => Promise<T>): Promise<T> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  let bytes: Buffer | undefined
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0 || stat.size < 1 || stat.size > 16384) throw new Error('Secret source must be a private owner file up to 16 KB')
    bytes = Buffer.alloc(stat.size + 1)
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
    const after = await file.stat()
    if (bytesRead !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw new Error('Secret source changed during import')
    const value = bytes.subarray(0, bytesRead).toString('utf8').replace(/\r?\n$/, '')
    parseCredentialValue(value)
    return await save(value)
  }
  finally { bytes?.fill(0); await file.close() }
}
