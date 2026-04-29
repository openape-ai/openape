import { existsSync, readFileSync } from 'node:fs'

export interface LoadOrCreateCaOpts {
  certPath: string
  keyPath: string
  subjectCN: string // used only when generating; ignored on load
}

export interface CaBundle {
  certPem: string
  keyPem: string
  created: boolean // true if newly generated, false if loaded
}

export function loadOrCreateCa(opts: LoadOrCreateCaOpts): CaBundle {
  if (existsSync(opts.certPath) && existsSync(opts.keyPath)) {
    return {
      certPem: readFileSync(opts.certPath, 'utf-8'),
      keyPem: readFileSync(opts.keyPath, 'utf-8'),
      created: false,
    }
  }
  throw new Error('CA generation not yet implemented (Task 6)')
}
