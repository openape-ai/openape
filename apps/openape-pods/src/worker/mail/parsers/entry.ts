import { readFile } from 'node:fs/promises'
import { Socket } from 'node:net'
import { extract } from './extract'

async function main(): Promise<void> {
  const source = JSON.parse(await readFile(process.argv[2], 'utf8')) as { data: { body?: { contentType: string, content: string }, contentBytes?: string, contentType?: string } }
  const data = source.data
  let bytes: Uint8Array; let type: string
  if (data.body) { bytes = Buffer.from(data.body.content); type = data.body.contentType.toLowerCase() }
  else {
    if (typeof data.contentBytes !== 'string' || data.contentBytes.length > 28 * 1024 * 1024 || /[^a-z0-9+/=]/i.test(data.contentBytes)) throw new Error('Invalid attachment bytes')
    bytes = Buffer.from(data.contentBytes, 'base64'); if (Buffer.from(bytes).toString('base64') !== data.contentBytes) throw new Error('Invalid attachment encoding'); type = data.contentType ?? ''
  }
  const result = await extract(bytes, type, process.argv[3])
  const channel = new Socket({ fd: 3, writable: true, readable: false })
  channel.end(JSON.stringify(result), () => channel.destroy())
}
void main().catch(() => { console.error('Document parsing failed; source is unexamined'); process.exitCode = 1 })
