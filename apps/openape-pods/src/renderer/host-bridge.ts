import { inject } from 'vue'
import type { InjectionKey } from 'vue'
import type { PodsBridge } from '../contracts/ipc'
import { electronBridge } from './adapters/electron'

export const hostBridgeKey: InjectionKey<PodsBridge> = Symbol('host-bridge')

export function useHostBridge(): PodsBridge {
  return inject(hostBridgeKey, undefined) ?? electronBridge()
}
