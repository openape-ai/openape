import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareSink } from '../src/deliver'

const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })
async function path() { const dir = await mkdtemp(join(tmpdir(), 'secret-sink-')); dirs.push(dir); return join(dir, 'value') }
const secret = () => new TextEncoder().encode('quiet-secret')
describe('silent delivery', () => {
  it('writes only to a new private file and wipes the input buffer', async () => {
    const file = await path(); const sink = await prepareSink({ file }); const value = secret()
    await sink.write(value); await sink.close()
    expect(await readFile(file, 'utf8')).toBe('quiet-secret')
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect(value.every(v => v === 0)).toBe(true)
    await expect(prepareSink({ file })).rejects.toThrow()
  })
  it('refuses symlinks and removes incomplete delivery files', async () => {
    const file = await path(); await writeFile(`${file}-target`, 'unchanged'); await symlink(`${file}-target`, file)
    await expect(prepareSink({ file })).rejects.toThrow()
    expect(await readFile(`${file}-target`, 'utf8')).toBe('unchanged')
    const sink = await prepareSink({ file: `${file}-empty` }); await sink.close()
    await expect(stat(`${file}-empty`)).rejects.toThrow()
  })
  it('pipes into a subprocess while discarding both output streams', async () => {
    const file = await path()
    const sink = await prepareSink({ command: [process.execPath, '-e', 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{require("fs").writeFileSync(process.argv[1],s);console.log(s);console.error(s)})', file] })
    await sink.write(secret()); await sink.close()
    expect(await readFile(file, 'utf8')).toBe('quiet-secret')
  })
  it('reports failure without including command diagnostics or secret', async () => {
    const sink = await prepareSink({ command: [process.execPath, '-e', 'console.error(process.env.SECRET);process.exit(3)'], env: 'SECRET' })
    const value = secret()
    await expect(sink.write(value)).rejects.toThrow('Target process exited with status 3')
    await sink.close(); expect(value.every(v => v === 0)).toBe(true)
  })
})
