import { describe, expect, it } from 'vitest'
import { cloneCommand, commentsByAnchor, conversationComments, ownerSlugFromEmail, pullStateLook } from '../app/utils/git-ui'

describe('cloneCommand', () => {
  it('builds the x-access-token clone line from any origin', () => {
    expect(cloneCommand('https://repos.openape.ai', 'patrick', 'app'))
      .toBe('git clone https://x-access-token:$(jq -r .access_token ~/.config/apes/auth.json)@repos.openape.ai/patrick/app.git')
    expect(cloneCommand('http://localhost:3026', 'patrick', 'app'))
      .toBe('git clone https://x-access-token:$(jq -r .access_token ~/.config/apes/auth.json)@localhost:3026/patrick/app.git')
  })
})

describe('ownerSlugFromEmail', () => {
  it('derives a valid owner slug', () => {
    expect(ownerSlugFromEmail('patrick@hofmann.eco')).toBe('patrick')
    expect(ownerSlugFromEmail('p.hofmann+x@delta-mind.at')).toBe('p-hofmann-x')
    expect(ownerSlugFromEmail('---@x')).toBe('')
  })
})

describe('pull request review comments', () => {
  const anchored = { id: 'a', path: 'src/app.ts', line: 12 }
  const sameLine = { id: 'b', path: 'src/app.ts', line: 12 }
  const otherFile = { id: 'c', path: 'README.md', line: 3 }
  const plain = { id: 'd', path: null, line: null }
  const all = [anchored, sameLine, otherFile, plain]

  it('groups anchored comments per file and line, keeping their order', () => {
    const byAnchor = commentsByAnchor(all)
    expect(byAnchor.get('src/app.ts:12')).toEqual([anchored, sameLine])
    expect(byAnchor.get('README.md:3')).toEqual([otherFile])
    expect(byAnchor.has('src/app.ts:13')).toBe(false)
  })

  it('leaves unanchored comments out of the diff', () => {
    expect([...commentsByAnchor([plain]).keys()]).toEqual([])
  })

  it('shows only unanchored comments while a diff is on screen', () => {
    expect(conversationComments(all, true)).toEqual([plain])
  })

  it('keeps anchored comments visible once the diff is gone (merged PR)', () => {
    expect(conversationComments(all, false)).toEqual(all)
  })
})

describe('pullStateLook', () => {
  it('separates merged from open', () => {
    expect(pullStateLook('merged').icon).not.toBe(pullStateLook('open').icon)
  })
})
