import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeTag } from '../contracts/tags'

/** A local presentation preference, independent of Pod definitions and scheduling. */
export class TrayPreference {
  tag: string | null = null
  readonly path: string

  constructor(readonly root: string) {
    this.path = join(root, 'tray-tag.json')
    try {
      const value: unknown = JSON.parse(readFileSync(this.path, 'utf8'))
      this.tag = value === null ? null : normalizeTag(value)
    }
    catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) console.error('Could not read Pods tray filter', error)
    }
  }

  set(value: string | null): void {
    const tag = value === null ? null : normalizeTag(value)
    mkdirSync(this.root, { recursive: true, mode: 0o700 })
    writeFileSync(`${this.path}.tmp`, JSON.stringify(tag), { mode: 0o600 })
    renameSync(`${this.path}.tmp`, this.path)
    this.tag = tag
  }
}
