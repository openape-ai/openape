import { useHostBridge } from './host-bridge'
import { inject, onBeforeUnmount, reactive } from 'vue'
import type { InjectionKey, Ref } from 'vue'
import type { PodsBridge } from '../contracts/ipc'

export type PodApi = Pick<PodsBridge, 'workspace' | 'details' | 'scripts' | 'resources' | 'scheduling' | 'runs' | 'data'>
export interface PodAccess {
  api: PodApi
  revision?: Readonly<Ref<number>>
  remote: boolean
  key: (podId: string) => string
  edits: Map<string, () => boolean>
}
export const podAccessKey: InjectionKey<PodAccess> = Symbol('pod-access')
export function usePodAccess(): PodAccess {
  const provided = inject(podAccessKey, undefined)
  if (provided) return provided
  return localPodAccess(useHostBridge())
}
export function localPodAccess(bridge: PodsBridge, namespace = '', revision?: Readonly<Ref<number>>): PodAccess {
  return {
    revision,
    api: {
      workspace: command => bridge.workspace(command), details: command => bridge.details(command),
      scripts: command => bridge.scripts(command), resources: command => bridge.resources(command),
      scheduling: command => bridge.scheduling(command), runs: command => bridge.runs(command),
      data: command => bridge.data(command),
    },
    remote: false, key: id => `${namespace}${id}`, edits: reactive(new Map()),
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
