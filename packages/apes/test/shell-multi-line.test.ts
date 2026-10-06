import { describe, expect, it } from 'vitest'
import { checkMultiLineStatus } from '../src/shell/multi-line.js'

describe('checkMultiLineStatus', () => {
  describe('complete statements', () => {
    it('treats empty input as complete (no-op)', () => {
      expect(checkMultiLineStatus('')).toEqual({ kind: 'complete' })
      expect(checkMultiLineStatus('   ')).toEqual({ kind: 'complete' })
    })

    it('recognizes a simple command', () => {
      expect(checkMultiLineStatus('ls')).toEqual({ kind: 'complete' })
    })

    it('recognizes a command with arguments and pipes', () => {
      expect(checkMultiLineStatus('ls -la /tmp | grep foo | head -5')).toEqual({ kind: 'complete' })
    })

    it('recognizes a completed for-loop on one line', () => {
      expect(checkMultiLineStatus('for i in 1 2 3; do echo $i; done')).toEqual({ kind: 'complete' })
    })

    it('recognizes a completed multi-line for-loop', () => {
      expect(checkMultiLineStatus('for i in 1 2 3\ndo\n  echo $i\ndone')).toEqual({ kind: 'complete' })
    })

    it('recognizes a completed if-fi block', () => {
      expect(checkMultiLineStatus('if true; then echo yes; fi')).toEqual({ kind: 'complete' })
    })

    it('recognizes a command with assignments', () => {
      expect(checkMultiLineStatus('FOO=bar BAR=baz ls')).toEqual({ kind: 'complete' })
    })
  })

  describe('incomplete statements (continue)', () => {
    it('detects an unclosed for-do-done', () => {
      expect(checkMultiLineStatus('for i in 1 2 3; do')).toEqual({ kind: 'continue' })
    })

    // bash translates its diagnostics; the classifier matches English text.
    // Without the pinned child locale this returns { kind: 'error' } on a
    // German desktop — the whole reason the six tests above were red there
    // while CI (C locale) stayed green. Machines without de_DE installed see
    // bash fall back to English, so this only bites where it can.
    it('classifies incomplete input the same under a localized parent env', () => {
      const previous = process.env.LC_ALL
      process.env.LC_ALL = 'de_DE.UTF-8'
      try {
        expect(checkMultiLineStatus('for i in 1 2 3; do')).toEqual({ kind: 'continue' })
      }
      finally {
        if (previous === undefined)
          delete process.env.LC_ALL
        else
          process.env.LC_ALL = previous
      }
    })

    it('detects an unclosed if-then-fi', () => {
      expect(checkMultiLineStatus('if true; then')).toEqual({ kind: 'continue' })
    })

    it('detects an unclosed while loop', () => {
      expect(checkMultiLineStatus('while true; do')).toEqual({ kind: 'continue' })
    })

    it('detects an unclosed subshell grouping', () => {
      expect(checkMultiLineStatus('(echo foo')).toEqual({ kind: 'continue' })
    })

    it('detects an unclosed heredoc', () => {
      expect(checkMultiLineStatus('cat << EOF\nsome content')).toEqual({ kind: 'continue' })
    })

    it('detects an unclosed double-quoted string', () => {
      expect(checkMultiLineStatus('echo "hello')).toEqual({ kind: 'continue' })
    })

    it('detects an unclosed command substitution', () => {
      expect(checkMultiLineStatus('echo $(ls')).toEqual({ kind: 'continue' })
    })
  })

  describe('genuine syntax errors (error)', () => {
    it('reports an unexpected redirect token', () => {
      const result = checkMultiLineStatus('echo >')
      expect(result.kind).toBe('error')
    })

    it('reports a stray fi without matching if', () => {
      const result = checkMultiLineStatus('fi')
      expect(result.kind).toBe('error')
    })
  })
})
