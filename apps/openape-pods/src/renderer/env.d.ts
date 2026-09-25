import type { PodsBridge } from '../contracts/ipc'
declare global { interface Window { pods: PodsBridge } }
export {}
