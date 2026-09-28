import { inject, onBeforeUnmount, reactive } from 'vue'
import type { InjectionKey, Ref } from 'vue'
import type { PodsBridge } from '../contracts/ipc'

export type PodApi = Pick<PodsBridge, 'workspace' | 'details' | 'scripts' | 'resources' | 'scheduling' | 'runs' | 'data' | 'workflows'>
export interface PodAccess {
  api: PodApi
  revision?: Readonly<Ref<number>>
  remote: boolean
  key: (podId: string) => string
  edits: Map<string, () => boolean>
}
export const podAccessKey: InjectionKey<PodAccess> = Symbol('pod-access')
export function usePodAccess(): PodAccess {
  return inject(podAccessKey, undefined) ?? {
    api: {
      workspace: command => window.pods.workspace(command), details: command => window.pods.details(command),
      scripts: command => window.pods.scripts(command), resources: command => window.pods.resources(command),
      scheduling: command => window.pods.scheduling(command), runs: command => window.pods.runs(command),
      data: command => window.pods.data(command), workflows: command => window.pods.workflows(command),
    },
    remote: false, key: id => id, edits: reactive(new Map()),
  }
}
export function trackPodEdits(access: PodAccess, name: string, dirty: () => boolean): void {
  if (access.remote) access.edits.set(name, dirty)
}
export function usePodEdits(name: string, dirty: () => boolean): void {
  const access = usePodAccess()
  trackPodEdits(access, name, dirty)
  onBeforeUnmount(() => { if (!dirty()) access.edits.delete(name) })
}
