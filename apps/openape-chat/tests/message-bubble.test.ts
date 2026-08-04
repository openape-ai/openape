// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MessageBubble from '../app/components/MessageBubble.vue'

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    senderEmail: 'patrick@hofmann.eco',
    senderAct: 'human' as const,
    body: 'Hallo',
    createdAt: 1_785_758_183,
    editedAt: null,
    ...overrides,
  }
}

describe('message bubble', () => {
  it('shows the sender name and the message body', () => {
    const text = mount(MessageBubble, { props: { message: message() } }).text()
    expect(text).toContain('patrick')
    expect(text).toContain('Hallo')
  })

  it('marks an agent message with the robot glyph', () => {
    const agent = message({ senderEmail: 'igor30-cb6bf26a+patrick+hofmann_eco@id.openape.ai', senderAct: 'agent' })
    const text = mount(MessageBubble, { props: { message: agent } }).text()
    expect(text).toContain('igor30')
    expect(text).toContain('🤖')
  })

  it('renders the typing placeholder while an empty message streams', () => {
    const card = mount(MessageBubble, { props: { message: message({ body: '', streaming: true }) } })
    expect(card.findAll('.animate-typing-dot')).toHaveLength(3)
  })

  it('shows the tool-call subtitle only while streaming', () => {
    const streaming = mount(MessageBubble, { props: { message: message({ streaming: true, streamingStatus: 'liest Datei' }) } })
    expect(streaming.text()).toContain('liest Datei')
    const settled = mount(MessageBubble, { props: { message: message({ streaming: false, streamingStatus: 'liest Datei' }) } })
    expect(settled.text()).not.toContain('liest Datei')
  })

  it('emits react on a foreign reaction and unreact on my own', async () => {
    const reactions = [{ emoji: '👍', count: 2, mine: false }, { emoji: '🎉', count: 1, mine: true }]
    const card = mount(MessageBubble, { props: { message: message(), reactions } })
    const buttons = card.findAll('button')
    await buttons[0]!.trigger('click')
    await buttons[1]!.trigger('click')
    expect(card.emitted('react')).toEqual([['👍']])
    expect(card.emitted('unreact')).toEqual([['🎉']])
  })

  it('aligns my own messages to the other side', () => {
    const mine = mount(MessageBubble, { props: { message: message(), myEmail: 'patrick@hofmann.eco' } })
    const theirs = mount(MessageBubble, { props: { message: message(), myEmail: 'someone@else.com' } })
    expect(mine.classes()).toContain('items-end')
    expect(theirs.classes()).toContain('items-start')
  })
})
