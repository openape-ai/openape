import { describe, expect, it, vi } from 'vitest'
import { runOpenclawTurn } from '../src/lib/agent-runtime-session'

const agent = { name: 'ceo', email: 'ceo@id.openape.ai', home: '/home/ceo' }
const rt = { apiBase: 'https://llms.openape.ai/v1', apiKey: 'k', model: 'gpt-5.5', systemPrompt: 'persona' }
const message = { body: 'status?', roomId: 'room1', threadId: 'thread1', id: 'msg-7' }

describe('runOpenclawTurn', () => {
  it('invokes openclaw with the per-thread session key and posts the reply', async () => {
    const invoke = vi.fn(async () => 'all green')
    const post = vi.fn(async () => {})
    await runOpenclawTurn(agent, rt, message, post, { invoke })

    expect(invoke).toHaveBeenCalledWith(agent, rt, 'status?', 'room1:thread1')
    expect(post).toHaveBeenCalledWith('room1', 'all green', { replyTo: 'msg-7', threadId: 'thread1' })
  })

  it('does not post when openclaw returns an empty reply', async () => {
    const invoke = vi.fn(async () => '')
    const post = vi.fn(async () => {})
    await runOpenclawTurn(agent, rt, message, post, { invoke })

    expect(invoke).toHaveBeenCalledOnce()
    expect(post).not.toHaveBeenCalled()
  })
})
