export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt?: number // epoch ms — drives the chat timestamps + date separators
  streaming?: boolean
  thoughts?: string[] // ephemeral live "thinking" updates, not persisted
  waiting?: string // live "Ruhemodus · noch ~Ns" line while the Operator sleeps
  system?: string // honest system notice (e.g. Operator offline) — not an Operator answer
  ask?: { taskId: string, options: string[], answered?: boolean } // open question → chips
  files?: { id: string, mime: string, name: string }[] // attachments → images/cards in the bubble
}
