export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  thoughts?: string[] // ephemeral live "thinking" updates, not persisted
  waiting?: string // live "Ruhemodus · noch ~Ns" line while the CEO sleeps
  system?: string // honest system notice (e.g. CEO offline) — not a CEO answer
}
