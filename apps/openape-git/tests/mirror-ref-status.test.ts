// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MirrorRefStatus from '../app/components/MirrorRefStatus.vue'

const state = { ref: 'refs/heads/main', sourceSha: 'source-sha', targetSha: 'source-sha', checkedAt: 1700000000, syncedAt: 1700000000, error: null }
describe('mirror state feedback', () => {
  it('shows verified source and target, destination and successful synchronization', () => {
    const wrapper = mount(MirrorRefStatus, { props: { state, url: 'https://git.example/o/r' } })
    expect(wrapper.text()).toContain('Source: source-sha')
    expect(wrapper.text()).toContain('Target: source-sha')
    expect(wrapper.text()).toContain('https://git.example/o/r')
    expect(wrapper.text()).toContain('Synchronized')
  })
  it('shows a failed/unavailable target without claiming synchronization', () => {
    const wrapper = mount(MirrorRefStatus, { props: { state: { ...state, targetSha: null, syncedAt: null, error: 'connection refused' } } })
    expect(wrapper.text()).toContain('connection refused')
    expect(wrapper.text()).toContain('never')
    expect(wrapper.text()).not.toContain('Synchronized')
  })
  it('distinguishes a deleted source ref from a SHA', () => {
    expect(mount(MirrorRefStatus, { props: { state: { ...state, sourceSha: null, targetSha: null } } }).text()).toContain('Source: deleted')
  })
})
