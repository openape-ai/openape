import type { Owner } from '@openape/pods-protocol'
import type { PortableSourceView, SharingCommand, SharingState } from '../../contracts/sharing'
import type { ResourceRegistry } from '../resources/registry'
import type { ScriptRuntime } from '../runs/runner'
import type { PodDatabase } from '../storage/database'
import { PortableExporter } from './export'
import { PortableImporter } from './import'
import type { ImportEngines } from './import'
import { mapPortableSource } from './mapping'
import type { PortableExportChoices } from './mapping'
import { capturePortableSource } from './source'
import type { PortableSourceSelection } from './source'

// One owner-bound sharing service per worker: the exporter keeps its pending reviews, the importer reads the durable journal.
export class SharingService {
  private readonly importer: PortableImporter
  private readonly exporter: PortableExporter<PortableExportChoices>
  constructor(private readonly store: PodDatabase, resources: ResourceRegistry, private readonly owner: Owner, npmRoot: string, private readonly engines: ImportEngines) {
    this.importer = new PortableImporter(store, resources, owner, npmRoot)
    this.exporter = new PortableExporter(store, owner, npmRoot, (source, choices) => mapPortableSource(store.root, source, choices))
  }

  // What the owner chooses from before a review: every current reference needs an include or omit decision, aliasable resources need a portable name.
  source(selection: PortableSourceSelection): PortableSourceView {
    const source = capturePortableSource(this.store, this.owner, selection)
    const compositions: PortableSourceView['compositions'] = [
      ...(source.network ? [{ id: source.network.definition.id, kind: 'network' as const, name: source.network.definition.name }] : []),
    ]
    return {
      selection,
      pods: source.pods.map(pod => ({
        podId: pod.pod.id, name: pod.pod.name,
        references: pod.resources.filter(resource => resource.kind === 'reference' && resource.state !== 'revoked').map(resource => ({ id: resource.id, name: resource.name })),
        aliasable: pod.resources.filter(resource => resource.state === 'ready' && (resource.kind === 'directory' || (resource.kind === 'tool' && resource.configuration.capability !== 'mail.read' && resource.configuration.type !== 'jev'))).map(resource => ({ id: resource.id, kind: resource.kind === 'directory' ? 'directory' : String(resource.configuration.type), name: resource.name })),
        variables: pod.variables.map(variable => variable.name),
        configuration: pod.definitions.map(declaration => String(declaration.name)),
      })),
      compositions,
    }
  }

  async execute(command: SharingCommand, runtime: ScriptRuntime, signal: AbortSignal): Promise<SharingState> {
    if (command.scope === 'import') {
      if (command.type === 'pickFile') throw new Error('File selection requires the owner window')
      return this.importer.execute(command, runtime, signal, this.engines)
    }
    const imports = () => this.importer.list()
    if (command.type === 'inspectSource') return { imports: imports(), source: this.source(command.selection) }
    if (command.type === 'review') return { imports: imports(), review: await this.exporter.review(command.selection, command.choices) }
    if (command.type === 'discard') { this.exporter.cancel(command.id); return { imports: imports() } }
    const result = await this.exporter.commit(command.id, command.acknowledgedFindings)
    return { imports: imports(), archive: result.archive }
  }
}
