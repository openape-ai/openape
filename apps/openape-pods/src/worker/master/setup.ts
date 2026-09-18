import type { AccessProposal, MasterCommand } from '../../contracts/master'
import { parseSetupRequest } from '../../contracts/setup'
import type { SetupRequest } from '../../contracts/setup'
import type { ProgramAssignment } from '../../contracts/programs'
import type { PodDatabase } from '../storage/database'
import type { ResourceRegistry } from '../resources/registry'
import { PodVariables } from '../resources/variables'
import { resolveProgram } from '../../main/programs/session'

export class MasterSetup {
  constructor(private readonly store: PodDatabase, private readonly resources: ResourceRegistry) {}

  proposals(podId: string): AccessProposal[] {
    return this.store.db.prepare('SELECT * FROM access_proposals WHERE (?=\'\' OR pod_id=?) ORDER BY rowid DESC LIMIT 100').all(podId, podId).map((row) => {
      const body = parseSetupRequest(JSON.parse(row.body as string))
      let state = row.state as AccessProposal['state']
      if (body.provider === 'credential' && state !== 'declined') state = this.resources.list(row.pod_id as string).some(resource => resource.kind === 'credential' && resource.state === 'ready' && resource.configuration.alias === body.alias) ? 'approved' : 'pending'
      return { id: row.id as string, podId: row.pod_id as string, body, state }
    })
  }

  scriptState(podId: string): 'missing' | 'draft' | 'active' {
    const pod = this.store.getPod(podId)
    const draft = this.store.db.prepare('SELECT script_hash FROM script_drafts WHERE pod_id=? ORDER BY rowid DESC LIMIT 1').get(podId)
    if (draft && (!draft.script_hash || draft.script_hash !== pod.activeScript)) return 'draft'
    return pod.activeScript ? 'active' : 'missing'
  }

  private pending(id: string, podId: string): SetupRequest {
    if (this.store.getPod(podId).lifecycle === 'archived') throw new Error('Archived pods cannot be configured')
    const proposal = this.store.db.prepare('SELECT body FROM access_proposals WHERE id=? AND pod_id=? AND state=\'pending\'').get(id, podId)
    if (!proposal) throw new Error('Setup request changed; reload the conversation')
    return parseSetupRequest(JSON.parse(proposal.body as string))
  }

  answer(command: Extract<MasterCommand, { type: 'answerSetup' }>): void {
    this.store.transaction(() => {
      const request = this.pending(command.id, command.podId)
      if (request.provider !== 'variable' || !request.alias) throw new Error('Secret values must be entered in Variables and secrets')
      if (!command.value.trim()) throw new Error('Enter the missing value')
      new PodVariables(this.store).save(command.podId, request.alias, command.value, command.revision)
      this.store.db.prepare('UPDATE access_proposals SET state=\'approved\' WHERE id=?').run(command.id)
    })
  }

  async resolve(command: Extract<MasterCommand, { type: 'resolveSetup' }>): Promise<void> {
    const original = this.pending(command.id, command.podId)
    const request = command.request
    if (request.provider !== original.provider && !(original.provider === 'reference' && request.provider === 'directory')) throw new Error('Setup request type changed')
    const resource = this.resources.list(command.podId).find(item => item.id === command.resourceId && item.state === 'ready')
    if (!resource || this.resources.epoch(command.podId) !== command.epoch) throw new Error('Resources changed; review the request again')
    const config = resource.configuration
    let matches = false
    if (request.provider === 'http') matches = config.type === 'http' && config.origin === request.origin && !!request.methods?.length && request.methods.every(method => (config.methods as string[]).includes(method))
    if (request.provider === 'directory') matches = resource.kind === 'directory' && config.path === request.path && (config.access === 'readWrite' || config.access === request.access)
    if (request.provider === 'reference') matches = resource.kind === 'reference' && config.path === request.path
    if (request.provider === 'credential') matches = resource.kind === 'credential' && config.alias === original.alias && request.alias === original.alias
    if (request.provider === 'application' && config.type === 'program' && (resource.name === request.application || config.cliId === request.application)) {
      matches = true
      if (request.argv) await resolveProgram(config as unknown as ProgramAssignment, command.podId, request.argv, true)
      if (request.networkHosts?.some(host => !(config.networkHosts as string[]).includes(host))) matches = false
    }
    if (!matches) throw new Error('The requested resource is not configured yet')
    this.store.transaction(() => {
      this.pending(command.id, command.podId)
      if (this.resources.epoch(command.podId) !== command.epoch) throw new Error('Resources changed; review the request again')
      this.store.db.prepare('UPDATE access_proposals SET state=\'approved\',body=? WHERE id=?').run(JSON.stringify(request), command.id)
    })
  }
}
