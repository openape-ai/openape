import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { canonicalPortableJson, parseOwner } from '@openape/pods-protocol'
import type { Owner, PortableManifest } from '@openape/pods-protocol'
import type { PodDatabase } from '../storage/database'
import { DependencyStore } from '../dependencies/store'
import { capturePortableSource } from './source'
import type { PortableSource, PortableSourceSelection } from './source'
import { createPortablePackage } from './package'
import type { PortableDescription, PortablePayload } from './package'
import { scanPortableFilesAsync } from './scan'
import type { PortableScanFinding } from './scan'

export interface PortableExportReview { id: string, manifest: PortableManifest, findings: PortableScanFinding[], expiresAt: number }
export interface PortableExportContent { description: PortableDescription, payloads: PortablePayload[] }
export type PortableExportBuilder<Choices> = (source: PortableSource, choices: Choices) => Promise<PortableExportContent>
interface PendingExport<Choices> { selection: PortableSourceSelection, choices: Choices, fingerprint: string, transferSha256: string, review: PortableExportReview }

export class PortableExporter<Choices> {
  private readonly owner: Owner
  private readonly pending = new Map<string, PendingExport<Choices>>()
  private preparing = false
  constructor(private readonly store: PodDatabase, owner: Owner, private readonly npmRoot: string, private readonly build: PortableExportBuilder<Choices>, private readonly now = Date.now) { this.owner = parseOwner(owner) }

  private async prepare(selection: PortableSourceSelection, choices: Choices) {
    if (this.preparing) throw new Error('Another portable export preparation is running')
    this.preparing = true
    try { return await this.captureAndBuild(selection, choices) }
    finally { this.preparing = false }
  }

  private async captureAndBuild(selection: PortableSourceSelection, choices: Choices) {
    const source = capturePortableSource(this.store, this.owner, selection)
    const dependencies = new DependencyStore(this.store)
    for (const pod of source.pods) {
      if (!pod.dependencyHash) continue
      const path = await dependencies.verify(pod.pod.id, pod.dependencyHash)
      if (canonicalPortableJson(JSON.parse(await readFile(join(path, 'package-lock.json'), 'utf8'))) !== canonicalPortableJson(JSON.parse(pod.lock!))) throw new Error('Portable source dependency lock is unavailable or changed')
    }
    const content = await this.build(source, choices)
    if (capturePortableSource(this.store, this.owner, selection).fingerprint !== source.fingerprint) throw new Error('Portable source changed; review the export again')
    const result = await createPortablePackage(content.description, content.payloads, this.npmRoot)
    if (capturePortableSource(this.store, this.owner, selection).fingerprint !== source.fingerprint) throw new Error('Portable source changed; review the export again')
    const publicDefaults = new Set([...result.manifest.pods, ...result.manifest.compositions].flatMap(item => item.inputs.map(input => input.default)).filter(value => typeof value === 'string'))
    const findings = await scanPortableFilesAsync([
      { path: 'manifest.json', content: new TextEncoder().encode(canonicalPortableJson(result.manifest)), text: true },
    ], source.privateReferences, source.privateValues.filter(value => !publicDefaults.has(value)))
    findings.push(...await scanPortableFilesAsync(content.payloads.map(file => ({ path: file.path, content: file.content, text: file.kind !== 'asset', privateValues: file.kind === 'script' || file.kind === 'asset' })), source.privateReferences, source.privateValues))
    if (findings.length > 200) throw new Error('Portable privacy scan has too many findings; reduce or parameterize the selected content')
    if (capturePortableSource(this.store, this.owner, selection).fingerprint !== source.fingerprint) throw new Error('Portable source changed; review the export again')
    return { result, findings, fingerprint: source.fingerprint }
  }

  async review(selection: PortableSourceSelection, choices: Choices): Promise<PortableExportReview> {
    for (const [id, pending] of this.pending) {
      if (pending.review.expiresAt <= this.now()) this.pending.delete(id)
    }
    if (this.pending.size >= 8) throw new Error('Too many pending portable export reviews')
    const selected = structuredClone(selection); const reviewedChoices = structuredClone(choices)
    const prepared = await this.prepare(selected, reviewedChoices)
    if (this.pending.size >= 8) throw new Error('Too many pending portable export reviews')
    const review = { id: randomUUID(), manifest: prepared.result.manifest, findings: prepared.findings, expiresAt: this.now() + 10 * 60 * 1000 }
    this.pending.set(review.id, { selection: selected, choices: reviewedChoices, fingerprint: prepared.fingerprint, transferSha256: prepared.result.transferSha256, review })
    return structuredClone(review)
  }

  async commit(id: string, acknowledgedFindings: readonly string[]) {
    const pending = this.pending.get(id)
    if (!pending || pending.review.expiresAt <= this.now()) throw new Error('Portable export review expired; review the export again')
    if (pending.review.findings.some(finding => finding.severity === 'block')) throw new Error('Parameterize machine-bound or private content before exporting')
    const required = pending.review.findings.filter(finding => finding.severity === 'review').map(finding => finding.id)
    if (new Set(acknowledgedFindings).size !== acknowledgedFindings.length || acknowledgedFindings.length !== required.length || required.some(id => !acknowledgedFindings.includes(id))) throw new Error('Acknowledge each portable privacy finding before exporting')
    const prepared = await this.prepare(pending.selection, pending.choices)
    if (this.pending.get(id) !== pending || pending.review.expiresAt <= this.now()) throw new Error('Portable export review expired; review the export again')
    if (prepared.fingerprint !== pending.fingerprint || prepared.result.transferSha256 !== pending.transferSha256 || canonicalPortableJson(prepared.findings) !== canonicalPortableJson(pending.review.findings)) throw new Error('Portable source changed; review the export again')
    return prepared.result
  }

  cancel(id: string): void { this.pending.delete(id) }
}
