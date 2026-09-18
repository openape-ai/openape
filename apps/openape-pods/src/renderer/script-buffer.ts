import { emptyPackages } from '../contracts/dependencies'
import { reactive } from 'vue'
import type { ScriptSource, ScriptView } from '../contracts/scripts'

export interface ScriptBuffer { view: ScriptView | null, source: ScriptSource | null, code: string, packages: string, toolCapabilities: string[], credentialAliases: string[], editing: boolean, busy: boolean, error: string, message: string, compare: string | null }
const buffers = new Map<string, ScriptBuffer>()
export function scriptBuffer(podId: string): ScriptBuffer {
  const existing = buffers.get(podId)
  if (existing) return existing
  const buffer = reactive<ScriptBuffer>({ view: null, source: null, code: '', packages: JSON.stringify(emptyPackages(), null, 2), toolCapabilities: [], credentialAliases: [], editing: false, busy: false, error: '', message: '', compare: null })
  buffers.set(podId, buffer)
  return buffer
}
export function isDirty(buffer: ScriptBuffer): boolean {
  return buffer.editing && (buffer.packages !== JSON.stringify(buffer.source?.packages ?? emptyPackages(), null, 2) || JSON.stringify([...buffer.credentialAliases].sort()) !== JSON.stringify((buffer.source?.capabilities.filter(item => item.startsWith('credential.')).map(item => item.slice(11)) ?? []).sort()) || buffer.code !== (buffer.source?.code ?? '') || JSON.stringify([...buffer.toolCapabilities].sort()) !== JSON.stringify((buffer.source?.capabilities.filter(item => !item.startsWith('credential.')) ?? []).sort()))
}
