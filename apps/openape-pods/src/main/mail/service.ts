import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { loadAdapter, resolveCommand } from '@openape/apes'
import { verifyExecutable } from '../../worker/runtime/sandbox'
import { PodToolBroker } from '../broker/tools'
import type { BrokerLease } from '../broker/tools'
import type { AgentAuthority } from '../broker/authorization'
import type { CredentialCache } from '../connections/cache'
import { parseMailRequest } from './contract'
import type { MailScope } from './contract'
import { startMailProxy } from './proxy'

export interface MailAssignment extends MailScope { connectionId: string, grants: Partial<Record<'messages' | 'attachments' | 'attachment', string>> }
export interface MailArtifact { path: string, hash: string }
export class MailService {
  constructor(private readonly helper: string, private readonly vendor: string, private readonly authority: AgentAuthority, private readonly credentials: CredentialCache, private readonly network: (signal: AbortSignal) => ReturnType<typeof startMailProxy> = startMailProxy) {}
  async execute(assignment: MailAssignment, request: unknown, root: string, lease: BrokerLease): Promise<MailArtifact> {
    const { argv, read } = parseMailRequest(request, assignment)
    const grantId = assignment.grants[read.operation]
    if (!grantId) throw new Error('No grant is assigned for this mail operation')
    const manifest = JSON.parse(await readFile(join(this.vendor, 'o365-manifest.json'), 'utf8')) as { binaryHash: string, rootsHash: string, protocol: number }
    if (manifest.protocol !== 1) throw new Error('Unsupported o365 protocol')
    const roots = join(this.vendor, 'mail-roots.pem')
    await verifyExecutable(roots, manifest.rootsHash)
    const adapterPath = join(this.vendor, 'o365-shapes.toml')
    const adapter = loadAdapter('o365-cli', adapterPath)
    const resolved = await resolveCommand(adapter, argv)
    const proxy = await this.network(lease.signal)
    try {
      const broker = new PodToolBroker(this.helper, root, this.authority, this.credentials)
      const reply = await broker.execute({ id: 'o365-mail', capability: 'mail.read', executable: join(this.vendor, 'o365-cli'), executableHash: manifest.binaryHash, entryFiles: [{ path: roots, hash: manifest.rootsHash }], prefix: [], connectionId: assignment.connectionId, cacheArgument: '--cache-dir', maxOutputBytes: 32 * 1024 * 1024, runtimeDirectories: [], environment: { ...proxy.environment, PODS_CA_FILE: roots }, networkPorts: [proxy.port], grantId, command: { cliId: 'o365-cli', adapterPath, adapterDigest: adapter.digest, argv, permission: resolved.permission } }, request, lease)
      if (reply.exitCode !== 0) throw new Error(`Mail read failed (${reply.exitCode}): ${reply.stderr.slice(0, 2000)}`)
      lease.assertCurrent(); lease.signal.throwIfAborted()
      const path = join(root, `mail-${randomUUID()}.json`)
      await writeFile(path, reply.stdout, { flag: 'wx', mode: 0o400 })
      return { path, hash: createHash('sha256').update(reply.stdout).digest('hex') }
    }
    finally { await proxy.close() }
  }
}
