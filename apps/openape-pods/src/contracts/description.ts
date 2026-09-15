export interface PodDescription { text: string, state: 'pending' | 'running' | 'ready' | 'failed', error: string | null, revision: number, updatedAt: number | null }

export interface AdoptionPreview { hash: string, firstMessageId: string, lastMessageId: string, requests: { id: string, text: string }[], messageCount: number }
