import { describe, expect, it } from 'vitest'
import { extractShellCommandString, parseShellCommand } from '../src/shapes/shell-parser'

describe('parseShellCommand', () => {
  it('parses a simple command', () => {
    const result = parseShellCommand('rm /tmp/foo.txt')
    expect(result).toEqual({
      executable: 'rm',
      argv: ['/tmp/foo.txt'],
      isCompound: false,
      raw: 'rm /tmp/foo.txt',
    })
  })

  it('parses an executable with flags and positional', () => {
    const result = parseShellCommand('rm -f /tmp/foo.txt')
    expect(result).toEqual({
      executable: 'rm',
      argv: ['-f', '/tmp/foo.txt'],
      isCompound: false,
      raw: 'rm -f /tmp/foo.txt',
    })
  })

  it('handles double-quoted arguments', () => {
    const result = parseShellCommand('git commit -m "hello world"')
    expect(result).toEqual({
      executable: 'git',
      argv: ['commit', '-m', 'hello world'],
      isCompound: false,
      raw: 'git commit -m "hello world"',
    })
  })

  it('handles single-quoted arguments', () => {
    const result = parseShellCommand('echo \'a b\' c')
    expect(result).toEqual({
      executable: 'echo',
      argv: ['a b', 'c'],
      isCompound: false,
      raw: 'echo \'a b\' c',
    })
  })

  it('marks && compound commands as compound', () => {
    const result = parseShellCommand('git pull && npm test')
    expect(result?.isCompound).toBe(true)
    expect(result?.executable).toBe('git')
    expect(result?.argv).toEqual(['pull'])
  })

  it('marks || compound commands as compound', () => {
    const result = parseShellCommand('test -f foo || touch foo')
    expect(result?.isCompound).toBe(true)
  })

  it('marks ; sequences as compound', () => {
    const result = parseShellCommand('ls ; pwd')
    expect(result?.isCompound).toBe(true)
  })

  it('marks pipes as compound', () => {
    const result = parseShellCommand('ls -la | grep foo')
    expect(result?.isCompound).toBe(true)
  })

  it('marks subshells as compound', () => {
    const result = parseShellCommand('echo $(whoami)')
    expect(result?.isCompound).toBe(true)
  })

  it('marks backtick substitution as compound', () => {
    const result = parseShellCommand('echo `date`')
    expect(result?.isCompound).toBe(true)
  })

  it('marks background execution as compound', () => {
    const result = parseShellCommand('long-running-task &')
    expect(result?.isCompound).toBe(true)
  })

  it('marks redirects as compound', () => {
    const result = parseShellCommand('cat foo > bar')
    expect(result?.isCompound).toBe(true)
  })

  it('returns null for empty string', () => {
    expect(parseShellCommand('')).toBeNull()
  })

  it('returns null for whitespace only', () => {
    expect(parseShellCommand('   \t  ')).toBeNull()
  })

  it('trims the raw string', () => {
    const result = parseShellCommand('  uname -a  ')
    expect(result?.raw).toBe('uname -a')
    expect(result?.executable).toBe('uname')
    expect(result?.argv).toEqual(['-a'])
  })

  it('handles many positional arguments', () => {
    const result = parseShellCommand('cp a.txt b.txt c.txt dir/')
    expect(result?.executable).toBe('cp')
    expect(result?.argv).toEqual(['a.txt', 'b.txt', 'c.txt', 'dir/'])
  })
})

describe('extractShellCommandString', () => {
  it('extracts the command string from bash -c argv', () => {
    const result = extractShellCommandString(['bash', '-c', 'rm /tmp/foo.txt'])
    expect(result).toBe('rm /tmp/foo.txt')
  })

  it('supports sh as shell', () => {
    const result = extractShellCommandString(['sh', '-c', 'uname -a'])
    expect(result).toBe('uname -a')
  })

  it('joins multi-token commands', () => {
    // Edge case: sometimes the command comes as separate tokens after -c
    const result = extractShellCommandString(['bash', '-c', 'uname', '-a'])
    expect(result).toBe('uname -a')
  })

  it('returns null for non-shell argv', () => {
    expect(extractShellCommandString(['git', 'status'])).toBeNull()
    expect(extractShellCommandString(['bash', 'script.sh'])).toBeNull()
    expect(extractShellCommandString(['zsh', '-c', 'echo hi'])).toBeNull()
  })

  it('returns null for too-short argv', () => {
    expect(extractShellCommandString([])).toBeNull()
    expect(extractShellCommandString(['bash'])).toBeNull()
    expect(extractShellCommandString(['bash', '-c'])).toBeNull()
  })
})
