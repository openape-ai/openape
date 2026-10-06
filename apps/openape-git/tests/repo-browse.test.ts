import { describe, expect, it } from 'vitest'
import { breadcrumbs, formatBytes, formatDate, parentPath, shortSha } from '../app/utils/repo-browse'

describe('breadcrumbs', () => {
  it('builds cumulative paths', () => {
    expect(breadcrumbs('src/app/pages')).toEqual([
      { name: 'src', path: 'src' },
      { name: 'app', path: 'src/app' },
      { name: 'pages', path: 'src/app/pages' },
    ])
    expect(breadcrumbs('')).toEqual([])
  })
})

describe('parentPath', () => {
  it('strips the last segment', () => {
    expect(parentPath('src/app/index.vue')).toBe('src/app')
    expect(parentPath('README.md')).toBe('')
  })
})

describe('formatBytes', () => {
  it('picks the readable unit', () => {
    expect(formatBytes(42)).toBe('42 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})

describe('shortSha / formatDate', () => {
  it('formats sha and unix date', () => {
    expect(shortSha('08781df0123456789')).toBe('08781df')
    expect(formatDate(1756339200)).toBe('2025-08-28')
    expect(formatDate(0)).toBe('')
  })
})
