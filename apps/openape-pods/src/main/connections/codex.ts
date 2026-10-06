import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AgentRuntime } from '../../worker/agent/executor'
import { verifyExecutable } from '../../worker/runtime/sandbox'
import type { CredentialCache } from './cache'
import { AuthProcess } from './process'
import type { AuthFrame } from './process'

interface CodexTokens { access_token: string, refresh_token: string, account_id: string }
function tokens(raw: string): CodexTokens {
  const value = JSON.parse(raw) as { auth_mode?: string, tokens?: CodexTokens }
  if (value.auth_mode && value.auth_mode !== 'chatgpt') throw new Error('A ChatGPT connection is required')
  if (!value.tokens || ![value.tokens.access_token, value.tokens.refresh_token, value.tokens.account_id].every(item => typeof item === 'string' && item.length > 0 && item.length < 32768)) throw new Error('ChatGPT authentication cache is incomplete; reconnect')
  return value.tokens
}
export class CodexConnection {
  constructor(private readonly credentials: CredentialCache, private readonly runtime: AgentRuntime, private readonly root: string) {}
  private async process(home: string, signal: AbortSignal, notify: (frame: AuthFrame) => void): Promise<AuthProcess> {
    const manifest = JSON.parse(await readFile(this.runtime.manifest, 'utf8')) as { sdk: string, binaryHash: string }
    if (manifest.sdk !== '0.153.4') throw new Error('Unsupported authentication runtime')
    await verifyExecutable(this.runtime.binary, manifest.binaryHash)
    const process = await AuthProcess.start(this.runtime, this.root, this.runtime.binary, ['--strict-config', '-c', 'cli_auth_credentials_store="file"', 'app-server', '--stdio'], home, { HOME: home, CODEX_HOME: home, TMPDIR: home, PATH: '/usr/bin:/bin' }, signal, notify)
    try { await process.request('initialize', { clientInfo: { name: 'openape_pods_auth', version: '0.1.0' } }); process.initialized(); return process }
    catch (error) { await process.close(); throw error }
  }

  async login(id: string, signal: AbortSignal, present: (value: { url: string, code?: string }) => void): Promise<{ account: string, accountId: string }> {
    return this.credentials.withCache(id, async (file) => {
      const home = join(dirname(file), 'codex'); await mkdir(home, { mode: 0o700 })
      let complete: (frame: AuthFrame) => void = () => {}
      const completed = new Promise<AuthFrame>((resolve) => { complete = resolve })
      const process = await this.process(home, signal, (frame) => { if (frame.method === 'account/login/completed' || frame.event === 'processStopped') complete(frame) })
      try {
        const reply = await process.request('account/login/start', { type: 'chatgptDeviceCode' }) as { loginId?: string, verificationUrl?: string, userCode?: string }
        if (typeof reply.loginId !== 'string' || typeof reply.verificationUrl !== 'string' || typeof reply.userCode !== 'string') throw new Error('Invalid ChatGPT sign-in response')
        const url = new URL(reply.verificationUrl)
        if (url.protocol !== 'https:' || url.hostname !== 'auth.openai.com' || url.username || url.password) throw new Error('Unexpected ChatGPT verification service')
        present({ url: url.toString(), code: reply.userCode })
        const result = await completed; signal.throwIfAborted()
        if (result.params?.success !== true || result.params.loginId !== reply.loginId) throw new Error('ChatGPT sign-in failed or was cancelled')
        const account = await process.request('account/read', { refreshToken: false }) as { account?: { type?: string, email?: string } }
        if (account.account?.type !== 'chatgpt' || typeof account.account.email !== 'string') throw new Error('ChatGPT account identity is unavailable')
        const raw = await readFile(join(home, 'auth.json'), 'utf8'); const value = tokens(raw)
        await writeFile(file, raw, { mode: 0o600 }); return { account: account.account.email, accountId: value.account_id }
      }
      finally { await process.close() }
    }, signal)
  }

  async bearer(id: string, accountId: string, signal: AbortSignal): Promise<string> {
    return this.credentials.withCache(id, async (file) => {
      let raw = await readFile(file, 'utf8'); let value = tokens(raw)
      if (value.account_id !== accountId) throw new Error('ChatGPT account changed; review and reconnect')
      let expiry = 0
      try { expiry = (JSON.parse(Buffer.from(value.access_token.split('.')[1], 'base64url').toString()) as { exp?: number }).exp ?? 0 }
      catch { throw new Error('Invalid ChatGPT token cache; reconnect') }
      if (expiry <= Date.now() / 1000 + 60) {
        const home = join(dirname(file), 'codex'); await mkdir(home, { mode: 0o700 }); await writeFile(join(home, 'auth.json'), raw, { mode: 0o600 })
        const process = await this.process(home, signal, () => {})
        try {
          const response = await process.request('account/read', { refreshToken: true }) as { account?: { type?: string } }
          if (response.account?.type !== 'chatgpt') throw new Error('ChatGPT login expired; reconnect')
          raw = await readFile(join(home, 'auth.json'), 'utf8'); value = tokens(raw)
          if (value.account_id !== accountId) throw new Error('Refreshed ChatGPT account changed; reconnect')
          await writeFile(file, raw, { mode: 0o600 })
        }
        finally {
          await process.close()
          await persistRefresh(home, file, accountId)
        }
      }
      return value.access_token
    }, signal)
  }
}

async function persistRefresh(home: string, file: string, accountId: string): Promise<void> {
  const persisted = await readFile(join(home, 'auth.json'), 'utf8')
  if (tokens(persisted).account_id !== accountId) throw new Error('Refreshed ChatGPT account changed; reconnect')
  await writeFile(file, persisted, { mode: 0o600 })
}
