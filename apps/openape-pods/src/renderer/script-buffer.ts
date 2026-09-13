import { reactive } from 'vue'
import type { ScriptSource, ScriptView } from '../contracts/scripts'

export interface ScriptBuffer { view: ScriptView | null, source: ScriptSource | null, code: string, mail: boolean, editing: boolean, busy: boolean, error: string, message: string, compare: string | null }
const buffers = new Map<string, ScriptBuffer>()
export function scriptBuffer(podId: string): ScriptBuffer {
  const existing = buffers.get(podId)
  if (existing) return existing
  const buffer = reactive<ScriptBuffer>({ view: null, source: null, code: '', mail: false, editing: false, busy: false, error: '', message: '', compare: null })
  buffers.set(podId, buffer)
  return buffer
}
export function isDirty(buffer: ScriptBuffer): boolean {
  return buffer.editing && (buffer.code !== (buffer.source?.code ?? '') || buffer.mail !== (buffer.source?.capabilities.includes('mail.read') ?? false))
}
