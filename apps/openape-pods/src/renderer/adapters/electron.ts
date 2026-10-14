import type { PodsBridge } from '../../contracts/ipc'

export function electronBridge(): PodsBridge {
  return globalThis.window?.pods
}
