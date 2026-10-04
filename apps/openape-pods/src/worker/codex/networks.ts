import { parseOwner } from '@openape/pods-protocol'
import type { Owner } from '@openape/pods-protocol'
import { boundedCodexNetworkResult, codexNetworkRead, codexNetworkResult, parseCodexNetworkAction } from '../../contracts/codex-networks'
import type { CodexNetworkCommand } from '../../contracts/codex-networks'
import type { CodexRequest } from '../../contracts/codex'
import type { NetworkView } from '../../contracts/networks'
import { canonicalNetworkJson } from '../../contracts/network-json'
import { digest } from '../storage/database'
import type { PodDatabase } from '../storage/database'

export class CodexNetworks {
  constructor(private readonly store: PodDatabase, private readonly currentOwner: () => Owner, private readonly execute: (command: CodexNetworkCommand) => Promise<NetworkView>) {}

  async request(request: CodexRequest): Promise<NetworkView> {
    const command = parseCodexNetworkAction(request.action)
    const owner = parseOwner(this.currentOwner())
    if (codexNetworkRead(command)) return boundedCodexNetworkResult(command, await this.execute(command))
    const key = `codex-network:${request.id}`
    const body = canonicalNetworkJson({ owner, command })
    const hash = digest(body)
    const prior = this.store.db.prepare('SELECT * FROM master_actions WHERE id=?').get(key)
    if (prior) {
      if (prior.request_hash !== hash) throw new Error('Network MCP request identity was reused with different arguments or owner')
      if (prior.state === 'completed') return boundedCodexNetworkResult(command, JSON.parse(prior.result as string) as NetworkView)
      throw new Error('Network MCP operation failed or was interrupted; inspect network state before another action')
    }
    this.store.assertStorage()
    this.store.db.prepare('INSERT INTO master_actions VALUES(?,?,?,\'running\',NULL,NULL)').run(key, hash, body)
    let result: NetworkView
    try {
      result = codexNetworkResult(command, await this.execute(command))
      this.store.db.prepare('UPDATE master_actions SET state=\'completed\',result=? WHERE id=?').run(JSON.stringify(result), key)
    }
    catch (error) {
      this.store.db.prepare('UPDATE master_actions SET state=\'failed\',error=\'Inspect network state before retrying\' WHERE id=?').run(key)
      throw error
    }
    return boundedCodexNetworkResult(command, result)
  }
}
