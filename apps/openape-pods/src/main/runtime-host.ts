import type { EventEmitter } from 'node:events'
import type { CredentialCache } from './connections/cache'

export interface RuntimeChild extends EventEmitter {
  readonly pid?: number
  readonly stderr: NodeJS.ReadableStream | null
  postMessage: (message: unknown) => void
  kill: () => void
}

export interface RuntimeHost {
  directory?: string
  apesCli: string
  oneShot?: boolean
  jevKey?: () => string | undefined
  credentials: (root: string) => CredentialCache
  openExternal: (url: string) => Promise<void>
  fork: (entry: string, options: { cwd: string, env: Record<string, string>, serviceName: string, stdio: 'pipe' }) => RuntimeChild
}
