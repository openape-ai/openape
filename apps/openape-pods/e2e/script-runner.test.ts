import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { executeScript } from '../src/worker/runs/runner'
import type { RunInput } from '../src/contracts/runs'

let root = ''
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }) })
async function setup(source: string, timeMs = 5000) {
  root = await realpath(await mkdtemp(join(tmpdir(), 'pods-script-')))
  const workspace = join(root, 'workspace'); await mkdir(workspace)
  const artifact = join(root, 'run.mjs'); await writeFile(artifact, source)
  const input: RunInput = { version: 1, runId: randomUUID(), podId: randomUUID(), scriptHash: '0'.repeat(64), assignmentRevision: 1, reason: 'manual', eventIds: [], checkpointRevision: 0, checkpoint: {}, resourceEpoch: 0, workspace, references: [], limits: { timeMs, frameBytes: 256 * 1024 } }
  const runtime = { helper: resolve('dist/native/pods-helper'), executable: process.execPath, entry: resolve('dist/runtime/script-entry.mjs'), runtimeDirectories: [], environment: {} }
  return { input, runtime, artifact, directory: join(root, 'private') }
}
const result = `{status:'completed',summary:'Local example completed',completedInputIds:[],gapIds:[]}`
describe('native script runtime', () => {
  it('executes a deterministic script with frozen input, assigned workspace and acknowledged progress', async () => {
    const fixture = await setup(`import fs from 'node:fs'; export async function run(context) { if(!Object.isFrozen(context.input.checkpoint)) throw new Error('Mutable input'); fs.writeFileSync(context.workspace+'/result.txt','WORKSPACE'); const reply=await context.progress.commit({checkpoint:{seen:1},sources:[],claims:[]}); if(reply.revision!==1)throw new Error('Unacknowledged progress');return ${result} }`)
    const requests: unknown[] = []
    const reply = await executeScript(fixture.runtime, fixture.directory, fixture.artifact, fixture.input, new AbortController().signal, { event: () => {}, request: async (operation, payload) => { requests.push({ operation, payload }); return { revision: 1 } } })
    expect(reply.status).toBe('completed'); expect(requests).toHaveLength(1)
    expect(await readFile(join(fixture.input.workspace, 'result.txt'), 'utf8')).toBe('WORKSPACE')
  })
  it.each([
    ['zero exit', 'process.exit(0)', 'without a terminal'],
    ['bad result', 'export async function run(){return {status:"completed"}}', 'terminal result'],
    ['bad frame', 'import fs from "node:fs";fs.writeSync(3,JSON.stringify({version:1,runId:"foreign",sequence:1,type:"result",payload:{}})+"\\n");setInterval(()=>{},1000)', 'binding'],
    ['hung script', 'export async function run(){await new Promise(()=>{})} setInterval(()=>{},1000)', 'time limit'],
  ])('rejects %s visibly', async (_name, source, error) => {
    const fixture = await setup(source, 700)
    await expect(executeScript(fixture.runtime, fixture.directory, fixture.artifact, fixture.input, new AbortController().signal, { event: () => {}, request: async () => null })).rejects.toThrow(error)
  })
  it('cancels a waiting script and does not report its pending request as completed', async () => {
    const fixture = await setup(`export async function run(c){await c.agent.run({prompt:'Synthetic'});return ${result}}`)
    const controller = new AbortController()
    const execution = executeScript(fixture.runtime, fixture.directory, fixture.artifact, fixture.input, controller.signal, { event: () => {}, request: async () => { controller.abort(new Error('Owner cancelled')); throw new Error('Owner cancelled') } })
    await expect(execution).rejects.toThrow('Owner cancelled')
  })
  it('bounds a stalled service request as well as the script process', async () => {
    const fixture = await setup(`export async function run(c){await c.agent.run({prompt:'Synthetic'});return ${result}}`, 400)
    await expect(executeScript(fixture.runtime, fixture.directory, fixture.artifact, fixture.input, new AbortController().signal, { event: () => {}, request: async () => new Promise(() => {}) })).rejects.toThrow('time limit')
  }, 2000)

})
