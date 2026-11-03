import type { Client } from '@libsql/client'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { encodeStatement } from './encoding'

export async function fileDigest(path: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

export async function checkIntegrity(client: Client) {
  const result = await client.execute('PRAGMA integrity_check')
  if (result.rows.length !== 1 || result.rows[0]?.integrity_check !== 'ok') throw new Error('Reports checkpoint SQLite integrity check failed')
}

export async function checkpointFingerprint(client: Client) {
  const hash = createHash('sha256')
  const tables = await client.execute('SELECT name,sql FROM sqlite_master WHERE type=\'table\' ORDER BY name')
  hash.update(JSON.stringify(tables.rows))
  for (const table of tables.rows) {
    const name = String(table.name).replaceAll('"', '""')
    let offset = 0
    for (;;) {
      const rows = await client.execute(`SELECT * FROM "${name}" ORDER BY rowid LIMIT 100 OFFSET ${offset}`)
      for (const row of rows.rows) hash.update(`${JSON.stringify(encodeStatement({ sql: name, args: rows.columns.map(column => row[column]!) }))}\n`)
      if (rows.rows.length < 100) break
      offset += rows.rows.length
    }
  }
  return hash.digest('hex')
}

export async function retrieveCheckpoint(restic: string, snapshot: string, path: string, output: string) {
  if (!restic.startsWith('/') || !/^[a-f0-9]{64}$/.test(snapshot) || !path.startsWith('/')) throw new Error('Checkpoint retrieval requires an absolute restic executable, full snapshot ID and absolute snapshot path')
  const child = spawn(restic, ['dump', snapshot, path], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 30 * 60 * 1000 })
  const completion = new Promise<void>((resolve, reject) => {
    child.on('error', () => reject(new Error('Cannot start the configured restic executable')))
    child.on('close', code => code === 0 ? resolve() : reject(new Error('Independent restic checkpoint retrieval failed')))
  })
  try {
    await Promise.all([completion, pipeline(child.stdout, createWriteStream(output, { flags: 'wx', mode: 0o600 }))])
  }
  catch (error) { child.kill(); throw error }
}
