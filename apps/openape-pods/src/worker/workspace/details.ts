import type { DetailsCommand, PodDetails, Citation, KnowledgeClaim } from '../../contracts/details'
import { parseManifest } from '../storage/database'
import type { PodDatabase } from '../storage/database'
import type { ResourceRegistry } from '../resources/registry'

export class WorkspaceDetails {
  constructor(private readonly store: PodDatabase, private readonly resources: ResourceRegistry) {}
  execute(command: DetailsCommand): PodDetails {
    const pod = this.store.getPod(command.podId)
    if (command.type === 'activate') {
      this.store.transaction(() => {
        const row = this.store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=? AND hash=?').get(pod.id, command.hash)
        if (!row) throw new Error('Script version not found')
        const manifest = parseManifest(JSON.parse(row.manifest as string))
        if (manifest.assignmentRevision !== command.assignmentRevision || !this.validated(pod.id, command.hash, command.assignmentRevision)) throw new Error('Validate this version for the current assignment and permissions')
        this.store.readBlob(command.hash)
        const changed = this.store.db.prepare('UPDATE pods SET active_script=? WHERE id=? AND revision=? AND active_script IS ? AND lifecycle!=\'archived\'').run(command.hash, pod.id, command.assignmentRevision, command.expectedActive)
        if (changed.changes !== 1) throw new Error('Pod or active version changed; reload before activating')
      })
    }
    const counts = { finding: 0, question: 0, gap: 0 }
    for (const row of this.store.db.prepare('SELECT c.kind,count(*) AS count FROM claims c WHERE c.pod_id=? AND NOT EXISTS(SELECT 1 FROM claims n WHERE n.pod_id=c.pod_id AND n.supersedes=c.id) GROUP BY c.kind').all(pod.id)) counts[row.kind as keyof typeof counts] = row.count as number
    const claims = this.store.db.prepare('SELECT c.*,NOT EXISTS(SELECT 1 FROM claims n WHERE n.pod_id=c.pod_id AND n.supersedes=c.id) AS current FROM claims c WHERE c.pod_id=? ORDER BY c.revision DESC,c.id LIMIT 100 OFFSET ?').all(pod.id, command.type === 'list' ? command.offset ?? 0 : 0).map(row => ({ id: row.id, matter: row.matter, kind: row.kind, text: row.body, citations: JSON.parse(row.citations as string), supersedes: row.supersedes, revision: row.revision, current: row.current === 1 })) as KnowledgeClaim[]
    let source: PodDetails['source'] = null
    if (command.type === 'source') {
      const citation = this.store.db.prepare('SELECT id,version,hash,locator FROM sources WHERE pod_id=? AND id=? AND version=?').get(pod.id, command.id, command.version) as unknown as Citation | undefined
      if (!citation) throw new Error('Source is not assigned to this pod')
      source = { citation, content: this.store.readBlob(citation.hash).toString('utf8') }
    }
    const active = this.store.getPod(pod.id).activeScript
    const versions = this.store.db.prepare('SELECT hash,manifest FROM scripts WHERE pod_id=? ORDER BY rowid DESC LIMIT 100').all(pod.id).map(row => ({ hash: row.hash as string, assignmentRevision: parseManifest(JSON.parse(row.manifest as string)).assignmentRevision, validated: this.validated(pod.id, row.hash as string, pod.revision), active: row.hash === active }))
    return { claims, counts, total: this.store.db.prepare('SELECT count(*) AS count FROM claims WHERE pod_id=?').get(pod.id)!.count as number, checkpointRevision: this.store.checkpoint(pod.id).revision, versions, source }
  }

  private validated(podId: string, hash: string, revision: number): boolean { return !!this.store.db.prepare('SELECT 1 FROM validations WHERE pod_id=? AND script_hash=? AND assignment_revision=? AND resource_epoch=?').get(podId, hash, revision, this.resources.epoch(podId)) }
}
