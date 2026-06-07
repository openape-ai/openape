// A2A-conformant task types (JSON-RPC binding, lowercase string states).
// We adopt the Agent2Agent (Linux Foundation) object model so the same Task
// shape can later be exposed through an A2A façade without remodeling. Source:
// https://a2a-protocol.org/latest/specification/ (+ v0.2.x JSON-RPC binding).

export type TaskState =
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'auth-required'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'rejected'

export const TERMINAL_STATES: readonly TaskState[] = ['completed', 'failed', 'canceled', 'rejected']

export interface TextPart {
  kind: 'text'
  text: string
  metadata?: Record<string, unknown>
}
export interface DataPart {
  kind: 'data'
  data: unknown
  metadata?: Record<string, unknown>
}
export interface FilePart {
  kind: 'file'
  file: { name?: string, mediaType?: string, uri?: string, bytes?: string }
  metadata?: Record<string, unknown>
}
export type Part = TextPart | DataPart | FilePart

export interface Message {
  kind: 'message'
  messageId: string
  role: 'user' | 'agent'
  parts: Part[]
  contextId?: string
  taskId?: string
  metadata?: Record<string, unknown>
}

export interface Artifact {
  artifactId: string
  name?: string
  description?: string
  parts: Part[]
  metadata?: Record<string, unknown>
}

export interface TaskStatus {
  state: TaskState
  message?: Message
  timestamp?: string
}

export interface Task {
  kind: 'task'
  id: string
  contextId: string
  status: TaskStatus
  artifacts: Artifact[]
  history: Message[]
  /** Non-A2A bookkeeping surfaced for the worker/SP: queue type + lease state. */
  metadata?: Record<string, unknown>
}
