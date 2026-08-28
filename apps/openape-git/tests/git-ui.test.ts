import { describe, expect, it } from 'vitest'
import { cloneCommand, ownerSlugFromEmail } from '../app/utils/git-ui'

describe('cloneCommand', () => {
  it('builds the x-access-token clone line from any origin', () => {
    expect(cloneCommand('https://repos.openape.ai', 'patrick', 'app'))
      .toBe('git clone https://x-access-token:$(apes token)@repos.openape.ai/patrick/app.git')
    expect(cloneCommand('http://localhost:3026', 'patrick', 'app'))
      .toBe('git clone https://x-access-token:$(apes token)@localhost:3026/patrick/app.git')
  })
})

describe('ownerSlugFromEmail', () => {
  it('derives a valid owner slug', () => {
    expect(ownerSlugFromEmail('patrick@hofmann.eco')).toBe('patrick')
    expect(ownerSlugFromEmail('p.hofmann+x@delta-mind.at')).toBe('p-hofmann-x')
    expect(ownerSlugFromEmail('---@x')).toBe('')
  })
})
