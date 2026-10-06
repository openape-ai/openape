import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { CredentialCache } from './cache'
import { launchSandbox, verifyExecutable } from '../../worker/runtime/sandbox'
import { startMailProxy } from '../mail/proxy'
import { registerAuthDomain } from './ledger'

export interface MailFolder { id: string, name: string }
export class MicrosoftConnection {
  constructor(private readonly credentials: CredentialCache, private readonly helper: string, private readonly vendor: string, private readonly root: string) {}
  private async execute(id: string, args: string[], signal: AbortSignal, notify?: (value: Record<string, unknown>) => void): Promise<string> {
    const manifest = JSON.parse(await readFile(join(this.vendor, 'o365-manifest.json'), 'utf8')) as { binaryHash: string, rootsHash: string }
    const executable = join(this.vendor, 'o365-cli'); const roots = join(this.vendor, 'mail-roots.pem')
    await verifyExecutable(executable, manifest.binaryHash); await verifyExecutable(roots, manifest.rootsHash)
    return this.credentials.withCache(id, async (file) => {
      const proxy = await startMailProxy(signal)
      const launch = join(this.root, randomUUID()); await mkdir(launch, { recursive: true, mode: 0o700 })
      try {
        const domain = await launchSandbox(this.helper, launch, { executable, workspace: dirname(file), readFiles: [roots], runtimeDirectories: [], networkPorts: [proxy.port] }, [...args, '--cache-dir', dirname(file)], { ...proxy.environment, PODS_CA_FILE: roots }, (path, pid) => registerAuthDomain(this.root, path, pid))
        domain.channel.resume(); domain.stderr.resume()
        const cancel = () => domain.cancel(); signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
        try {
          await domain.processId
          domain.stdout.setEncoding('utf8'); let output = ''; let pending = ''
          for await (const bytes of domain.stdout) {
            output += String(bytes); pending += String(bytes)
            if (Buffer.byteLength(output) > 2 * 1024 * 1024) throw new Error('Mail setup response exceeds its limit')
            for (let newline = pending.indexOf('\n'); newline >= 0; newline = pending.indexOf('\n')) {
              const value: unknown = JSON.parse(pending.slice(0, newline)); pending = pending.slice(newline + 1)
              if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid mail sign-in event')
              notify?.(value as Record<string, unknown>)
            }
          }
          const code = await domain.completed; signal.throwIfAborted()
          if (code !== 0) throw new Error(`Microsoft connection failed (${code}); verify the expected account and retry`)
          if (notify && pending.trim()) throw new Error('Incomplete mail sign-in response')
          return output
        }
        finally { signal.removeEventListener('abort', cancel); domain.cancel(); await domain.completed }
      }
      finally { await proxy.close() }
    }, signal)
  }

  async login(id: string, account: string, signal: AbortSignal, present: (value: { url: string, code?: string }) => void): Promise<void> {
    let connected = false
    await this.execute(id, ['pods', 'login', '--account', account], signal, (value) => {
      if (value.event === 'deviceCode') {
        if (typeof value.url !== 'string' || typeof value.code !== 'string' || value.code.length > 256) throw new Error('Invalid Microsoft device code')
        const url = new URL(value.url)
        if (url.protocol !== 'https:' || !['microsoft.com', 'www.microsoft.com', 'login.microsoftonline.com'].includes(url.host) || url.username || url.password) throw new Error('Unexpected Microsoft verification service')
        present({ url: url.toString(), code: value.code }); return
      }
      if (value.event !== 'connected' || value.account !== account || value.scope !== 'Mail.Read') throw new Error('Microsoft connected a different account or permission scope')
      connected = true
    })
    if (!connected) throw new Error('Microsoft sign-in did not complete')
  }

  async folders(id: string, account: string, signal: AbortSignal): Promise<MailFolder[]> {
    const pending = ['']; const folders: MailFolder[] = []; const seen = new Set<string>(); let pages = 0
    for (let parent = pending.shift(); parent !== undefined; parent = pending.shift()) {
      let cursor: string | undefined
      const cursors = new Set<string>()
      do {
        if (++pages > 200) throw new Error('Folder inventory exceeds 200 pages; narrow the mailbox before setup')
        const raw = await this.execute(id, ['pods', 'read', '--operation', 'folders', '--account', account, ...(parent ? ['--folder', parent] : []), ...(cursor ? ['--cursor', cursor] : [])], signal)
        const page = JSON.parse(raw) as { version?: number, operation?: string, account?: string, items?: { id?: string, displayName?: string, childFolderCount?: number }[], complete?: boolean, nextCursor?: string }
        if (page.version !== 1 || page.operation !== 'folders' || page.account !== account || !Array.isArray(page.items) || typeof page.complete !== 'boolean') throw new Error('Invalid folder inventory')
        for (const folder of page.items) {
          if (typeof folder.id !== 'string' || !folder.id || folder.id.length > 2048 || /[\0\r\n/\\]/.test(folder.id) || ['.', '..'].includes(folder.id) || typeof folder.displayName !== 'string' || folder.displayName.length > 255 || !Number.isSafeInteger(folder.childFolderCount) || folder.childFolderCount! < 0 || seen.has(folder.id) || folders.length >= 1000) throw new Error('Invalid, repeated or excessive folder inventory')
          seen.add(folder.id); folders.push({ id: folder.id, name: folder.displayName })
          if (folder.childFolderCount! > 0) pending.push(folder.id)
        }
        cursor = page.nextCursor
        if (page.complete !== !cursor || (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 16384 || cursors.has(cursor)))) throw new Error('Invalid folder pagination')
        if (cursor) cursors.add(cursor)
      } while (cursor)
    }
    return folders
  }
}
