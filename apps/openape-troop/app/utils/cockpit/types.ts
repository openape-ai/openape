export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  thoughts?: string[] // ephemeral live "thinking" updates, not persisted
}
