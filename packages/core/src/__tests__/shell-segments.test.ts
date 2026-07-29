// Mirrors the #1079 suite that lived in apps/openape-free-idp — the
// functions moved to core, their behavioral contract moves with them.
import { describe, expect, it } from 'vitest'
import { containsCommandSubstitution, splitCommandSegments } from '../validation/shell-segments.js'

describe('splitCommandSegments', () => {
  it('single command stays one segment', () => {
    expect(splitCommandSegments('o365-cli mail list --limit 1')).toEqual(['o365-cli mail list --limit 1'])
  })
  it('splits on the shell control operators', () => {
    expect(splitCommandSegments('a && b')).toEqual(['a', 'b'])
    expect(splitCommandSegments('a || b')).toEqual(['a', 'b'])
    expect(splitCommandSegments('a ; b')).toEqual(['a', 'b'])
    expect(splitCommandSegments('a | b')).toEqual(['a', 'b'])
    expect(splitCommandSegments('a & b')).toEqual(['a', 'b'])
  })
  it('splits on newlines including CRLF', () => {
    expect(splitCommandSegments('a\nb')).toEqual(['a', 'b'])
    expect(splitCommandSegments('a\r\nb\r\nc')).toEqual(['a', 'b', 'c'])
  })
  it('drops empty segments from consecutive operators and edges', () => {
    expect(splitCommandSegments('a && ;; b\n\n')).toEqual(['a', 'b'])
    expect(splitCommandSegments('&& a')).toEqual(['a'])
  })
  it('operators inside quotes are not separators', () => {
    expect(splitCommandSegments('echo "a && b"')).toEqual(['echo "a && b"'])
    expect(splitCommandSegments('echo \'a | b; c\'')).toEqual(['echo \'a | b; c\''])
  })
  it('an escaped quote does not open a quote context', () => {
    // Real shell treats \" as a literal character — the && after it chains.
    expect(splitCommandSegments('echo \\" && evil')).toEqual(['echo \\"', 'evil'])
  })
  it('an escaped quote inside double quotes does not close the quote', () => {
    // Real shell keeps the string open across \" — the && is still quoted.
    expect(splitCommandSegments('echo "a\\"b && c"')).toEqual(['echo "a\\"b && c"'])
  })
  it('backslash inside single quotes is literal (no escaping)', () => {
    expect(splitCommandSegments('echo \'a\\\' && b')).toEqual(['echo \'a\\\'', 'b'])
  })
  it('operator-only input yields no segments', () => {
    expect(splitCommandSegments('&& ; |')).toEqual([])
  })
})

describe('containsCommandSubstitution', () => {
  it('plain commands have none', () => {
    expect(containsCommandSubstitution('o365-cli mail list --limit 1')).toBe(false)
    // eslint-disable-next-line no-template-curly-in-string -- deliberately a plain ${…} expansion
    expect(containsCommandSubstitution('echo $HOME ${PATH}')).toBe(false)
  })
  it('detects $( ), backticks and process substitution outside quotes', () => {
    expect(containsCommandSubstitution('echo $(rm -rf ~/x)')).toBe(true)
    expect(containsCommandSubstitution('echo `evil`')).toBe(true)
    expect(containsCommandSubstitution('cat <(evil)')).toBe(true)
    expect(containsCommandSubstitution('tee >(evil)')).toBe(true)
  })
  it('single-quoted constructs are literal and harmless', () => {
    expect(containsCommandSubstitution('echo \'$(x)\'')).toBe(false)
    expect(containsCommandSubstitution('echo \'`x`\'')).toBe(false)
    expect(containsCommandSubstitution('echo \'<(x)\'')).toBe(false)
  })
  it('double quotes do NOT neutralize $( ) or backticks', () => {
    expect(containsCommandSubstitution('echo "$(evil)"')).toBe(true)
    expect(containsCommandSubstitution('echo "`evil`"')).toBe(true)
  })
  it('process substitution inside double quotes is literal', () => {
    expect(containsCommandSubstitution('echo "<(x)"')).toBe(false)
  })
  it('escaped $ or backtick is literal', () => {
    expect(containsCommandSubstitution('echo \\$(x)')).toBe(false)
    expect(containsCommandSubstitution('echo \\`x\\`')).toBe(false)
  })
})
