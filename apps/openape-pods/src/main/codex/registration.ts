import { execFile } from 'node:child_process'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { CodexConnection } from '../../contracts/codex'
import { verifyExecutable } from '../../worker/runtime/sandbox'
import { writeLauncher } from './launcher'
import type { LauncherTarget } from './launcher'

const name = 'openape-pods'
const manual = `codex mcp remove ${name}`
interface Receipt { config: string, appended: string, created: boolean }

// Registers the launcher with the owner's Codex. The bundled Codex CLI only
// reads (`mcp get`): its writer rewrote unrelated parts of config.toml in the
// issue 1375 probe, so the app appends one marked block itself and removes
// exactly those bytes again. Entries it did not write are never changed.
export class CodexRegistration {
  constructor(private readonly cli: { binary: string, binaryHash: string }, private readonly home: string, private readonly directory: string, private readonly target: LauncherTarget) {}
  get launcher(): string { return join(this.directory, 'openape-pods-mcp') }
  private get record(): string { return join(this.directory, 'registration.json') }
  private get config(): string { return join(this.home, 'config.toml') }

  async status(): Promise<CodexConnection> {
    const entry = await this.entry()
    if (!entry) return { state: 'disconnected', home: this.home, manual }
    return { state: entry === this.launcher ? 'connected' : 'foreign', home: this.home, manual }
  }

  async connect(): Promise<CodexConnection> {
    const entry = await this.entry()
    if (entry && entry !== this.launcher) return { state: 'foreign', home: this.home, manual }
    await writeLauncher(this.launcher, this.target)
    if (entry) return { state: 'connected', home: this.home, manual }
    await mkdir(this.home, { recursive: true, mode: 0o700 })
    const original = await readFile(this.config, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error })
    const appended = `${original && !original.endsWith('\n') ? '\n' : ''}\n# Added by OpenApe Pods. Remove it in the app or with: ${manual}\n[mcp_servers.${name}]\ncommand = ${JSON.stringify(this.launcher)}\ntool_timeout_sec = 180\n`
    await this.write((original ?? '') + appended)
    if (await this.entry().catch(() => null) !== this.launcher) {
      if (original === null) await rm(this.config, { force: true })
      else await this.write(original)
      throw new Error('Codex did not accept the OpenApe Pods entry; its configuration was restored')
    }
    await writeFile(this.record, JSON.stringify({ config: this.config, appended, created: original === null } satisfies Receipt), { mode: 0o600 })
    return { state: 'connected', home: this.home, manual }
  }

  async disconnect(): Promise<CodexConnection> {
    const record = await readFile(this.record, 'utf8').then(value => JSON.parse(value) as Receipt, (error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error })
    const current = record ? await readFile(record.config, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return ''; throw error }) : ''
    if (record && current.endsWith(record.appended)) {
      const remaining = current.slice(0, -record.appended.length)
      if (record.created && !remaining) await rm(record.config, { force: true })
      else await this.write(remaining)
    }
    const state = await this.status()
    if (state.state === 'connected') return { ...state, state: 'edited' }
    await rm(this.record, { force: true }); await rm(this.launcher, { force: true })
    return state
  }

  private async write(content: string): Promise<void> {
    const mode = await stat(this.config).then(info => info.mode & 0o777, () => 0o600)
    await writeFile(`${this.config}.openape-pods.tmp`, content, { mode }); await rename(`${this.config}.openape-pods.tmp`, this.config)
  }

  private async entry(): Promise<string | null> {
    await verifyExecutable(this.cli.binary, this.cli.binaryHash)
    try {
      const { stdout } = await promisify(execFile)(this.cli.binary, ['mcp', 'get', name, '--json'], { env: { CODEX_HOME: this.home, HOME: this.home, PATH: '/usr/bin:/bin' }, timeout: 20000 })
      const transport = (JSON.parse(stdout) as { transport?: { type?: string, command?: string, args?: string[] } }).transport
      return transport?.type === 'stdio' && !transport.args?.length && typeof transport.command === 'string' ? transport.command : 'unsupported'
    }
    catch (error) {
      if ((error as { stderr?: string }).stderr?.includes(`No MCP server named '${name}'`)) return null
      throw new Error('Codex configuration could not be read; check config.toml', { cause: error })
    }
  }
}
