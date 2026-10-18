import { describe, expect, it } from 'vitest'
import { commandBlocks, compactCommand, displayValue, distinctCompactCommands, structureCommand, truncateMiddle, worthStructuring } from '../src/runtime/utils/command-structure'
import cardFixtures from './fixtures/grant-cards.json'

const UNLIMITED = { head: Infinity, value: Infinity, facts: Infinity }

const gateArgv = cardFixtures.graphGate.request.command

describe('structureCommand', () => {
  it('splits program, subcommands and a canonical JSON object argument in key order', () => {
    const structure = structureCommand(gateArgv)!
    expect(structure.program).toBe('pods-graph-gate')
    expect(structure.subcommands).toEqual(['approve'])
    expect(structure.args).toHaveLength(1)
    const [object] = structure.args
    expect(object!.kind).toBe('object')
    expect(object!.kind === 'object' && object!.entries.map(entry => entry.key)).toEqual(['action', 'batchId', 'expiresAt', 'hash', 'object', 'owner', 'podId', 'version'])
  })

  it('keeps a nested object as one indented level with its compact JSON', () => {
    const structure = structureCommand(['tool', 'run', '{"owner":{"issuer":"https://id.example.com","subject":"owner@example.com"},"deep":{"a":{"b":1}}}'])!
    expect(structure.args[0]).toEqual({
      kind: 'object',
      option: null,
      entries: [
        { key: 'owner', value: '{"issuer":"https://id.example.com","subject":"owner@example.com"}', entries: [{ key: 'issuer', value: 'https://id.example.com' }, { key: 'subject', value: 'owner@example.com' }] },
        { key: 'deep', value: '{"a":{"b":1}}', entries: [{ key: 'a', value: '{"b":1}' }] },
      ],
    })
  })

  it('reads options with values and plain flags; an inline `--name=value` stays one token', () => {
    const structure = structureCommand(['acme-cli', 'deploy', '--env', 'production', '--force', '-n', '3', '--tag=v1.2', 'target.txt'])!
    expect(structure.subcommands).toEqual(['deploy'])
    expect(structure.args).toEqual([
      { kind: 'option', option: '--env', value: 'production' },
      { kind: 'option', option: '--force', value: null },
      { kind: 'option', option: '-n', value: '3' },
      { kind: 'value', value: '--tag=v1.2' },
      { kind: 'value', value: 'target.txt' },
    ])
  })

  it('structures a JSON object given as an option value', () => {
    const structure = structureCommand(['pod-runtime', 'run', '--environment', '{"HOME":"/home/pod","LANG":"de_AT.UTF-8"}'])!
    expect(structure.args).toEqual([{ kind: 'object', option: '--environment', entries: [{ key: 'HOME', value: '/home/pod' }, { key: 'LANG', value: 'de_AT.UTF-8' }] }])
  })

  it('keeps non-JSON, malformed and non-canonical JSON arguments plain', () => {
    const tokens = ['{"a":1', '{"a": 1}', '{"a":1,"a":2}', '{"\\u0061":1}', '["a"]', 'plain value']
    const structure = structureCommand(['tool', 'x', ...tokens])!
    expect(structure.args).toEqual(tokens.map(value => ({ kind: 'value', value })))
  })

  it('keeps the raw rendering for hidden characters, also when only JSON escapes contain them', () => {
    expect(structureCommand(['tool', 'run', '{"a":"x‮y"}'])).toBeNull()
    expect(structureCommand(['tool', 'run', 'a​b'])).toBeNull()
    // The token itself is visible ASCII; the decoded value would hide a bell and a newline.
    expect(structureCommand(['tool', 'run', '{"a":"x\\u0007y"}'])!.args[0]).toEqual({ kind: 'value', value: '{"a":"x\\u0007y"}' })
    expect(structureCommand(['tool', 'run', '{"a":"x\\ny"}'])!.args[0]!.kind).toBe('value')
  })

  it('keeps the raw rendering for a command line over 4096 characters and an empty argv', () => {
    expect(structureCommand(['tool', 'x'.repeat(4096)])).toBeNull()
    expect(structureCommand([])).toBeNull()
    expect(structureCommand(undefined)).toBeNull()
  })

  it('is worth structuring with a JSON object argument or a long line only', () => {
    expect(worthStructuring(structureCommand(gateArgv)!, gateArgv.join(' ').length)).toBe(true)
    const short = ['acme-cli', 'deploy', '--env', 'production']
    expect(worthStructuring(structureCommand(short)!, short.join(' ').length)).toBe(false)
  })
})

describe('displayValue', () => {
  it('shows strings as they are unless they could read as another value', () => {
    expect(displayValue('mail.archive')).toBe('mail.archive')
    expect(displayValue(5)).toBe('5')
    expect(displayValue('5')).toBe('"5"')
    expect(displayValue(true)).toBe('true')
    expect(displayValue('true')).toBe('"true"')
    expect(displayValue(null)).toBe('null')
    expect(displayValue('')).toBe('""')
    expect(displayValue(' x')).toBe('" x"')
    expect(displayValue('"x"')).toBe('"\\"x\\""')
    expect(displayValue('{"a":1}')).toBe('"{\\"a\\":1}"')
    expect(displayValue(['a', 1])).toBe('["a",1]')
  })
})

describe('compactCommand', () => {
  it('shows the head and the first facts within the budget, middle-truncated, and counts the rest', () => {
    expect(compactCommand(structureCommand(gateArgv)!)).toEqual({
      head: 'pods-graph-gate approve',
      facts: [
        { label: 'action:', value: 'mail.archive' },
        { label: 'batchId:', value: '11111111…111111' },
        { label: 'expiresAt:', value: '1792478942037' },
      ],
      hidden: 6,
    })
  })

  it('flattens nested objects one level without limits', () => {
    const compact = compactCommand(structureCommand(gateArgv)!, UNLIMITED)
    expect(compact.hidden).toBe(0)
    expect(compact.facts.map(fact => `${fact.label} ${fact.value}`)).toEqual([
      'action: mail.archive',
      'batchId: 11111111-1111-4111-8111-111111111111',
      'expiresAt: 1792478942037',
      'hash: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'object: owner@example.test:synthetic-message-000000000000000000000000000000000000000000000000000001',
      'owner.issuer: https://id.example.test',
      'owner.subject: owner@example.test',
      'podId: 22222222-2222-4222-8222-222222222222',
      'version: 5',
    ])
  })

  it('keeps a nested object as JSON when a dotted key could read as another nesting', () => {
    const compact = compactCommand(structureCommand(['tool', 'run', '{"a.b":{"c":1},"d":{"e.f":2}}'])!, UNLIMITED)
    expect(compact.facts).toEqual([{ label: 'a.b:', value: '{"c":1}' }, { label: 'd:', value: '{"e.f":2}' }])
  })

  it('renders options, flags and plain arguments in argv order', () => {
    const compact = compactCommand(structureCommand(['/usr/local/bin/acme-cli', 'deploy', '--env', 'production', 'target.txt', '--force'])!)
    expect(compact).toEqual({
      head: '…/acme-cli deploy',
      facts: [{ label: '--env', value: 'production' }, { label: null, value: 'target.txt' }, { label: null, value: '--force' }],
      hidden: 0,
    })
  })

  it('is deterministic for the same argv', () => {
    expect(compactCommand(structureCommand([...gateArgv])!)).toEqual(compactCommand(structureCommand(gateArgv)!))
  })
})

describe('distinctCompactCommands', () => {
  const gate = (payload: Record<string, unknown>) => {
    const argv = [gateArgv[0]!, gateArgv[1]!, JSON.stringify({ ...JSON.parse(gateArgv[2]!), ...payload })]
    return structureCommand(argv)!
  }
  const shown = (compact: ReturnType<typeof compactCommand> | null) => compact?.facts.map(fact => `${fact.label} ${fact.value}`)

  it('keeps the short form when the rows already look different or bind the same command', () => {
    const archive = gate({})
    const [first, second, third] = distinctCompactCommands([archive, archive, gate({ action: 'mail.keep' })])
    expect(first).toEqual(compactCommand(archive))
    expect(second).toEqual(first)
    expect(shown(third)).toContain('action: mail.keep')
  })

  it('adds the first fact in which otherwise equal-looking commands differ', () => {
    const [first, second] = distinctCompactCommands([gate({}), gate({ object: 'other-mail-id', podId: '22222222-0000-4000-8000-000000000000' })])
    expect(shown(first)).toEqual(['action: mail.archive', 'batchId: 11111111…111111', 'expiresAt: 1792478942037', 'object: owner@ex…000001'])
    expect(shown(second)).toEqual(['action: mail.archive', 'batchId: 11111111…111111', 'expiresAt: 1792478942037', 'object: other-mail-id'])
    expect(first!.hidden).toBe(5)
  })

  it('shows full values when the shortened ones hide the difference', () => {
    const [first, second] = distinctCompactCommands([gate({ podId: 'aaaaaaaa-1111-0000-bbbbbb' }), gate({ podId: 'aaaaaaaa-2222-0000-bbbbbb' })])
    expect(shown(first)).toContain('podId: aaaaaaaa-1111-0000-bbbbbb')
    expect(shown(second)).toContain('podId: aaaaaaaa-2222-0000-bbbbbb')
  })

  it('tells apart one argument with a space from two arguments by their fact boxes', () => {
    const [joined, split] = distinctCompactCommands([structureCommand(['tool', 'x', 'a/1 b/2'])!, structureCommand(['tool', 'x', 'a/1', 'b/2'])!])
    expect(joined!.facts).toEqual([{ label: null, value: 'a/1 b/2' }])
    expect(split!.facts).toEqual([{ label: null, value: 'a/1' }, { label: null, value: 'b/2' }])
  })

  it('keeps the raw line when no short form can tell two commands apart', () => {
    // An option with its value and one token holding both read the same.
    const pair = structureCommand(['tool', 'x', '--env', 'prod'])!
    const token = structureCommand(['tool', 'x', '--env prod'])!
    expect(distinctCompactCommands([pair, token])).toEqual([null, null])
  })

  it('leaves rows without a structure to their raw line', () => {
    expect(distinctCompactCommands([undefined])).toEqual([null])
  })
})

describe('truncateMiddle', () => {
  it('keeps start and end around a visible ellipsis', () => {
    expect(truncateMiddle('22222222-2222-4222-8222-222222222222', 15)).toBe('22222222…222222')
    expect(truncateMiddle('short', 15)).toBe('short')
    expect(truncateMiddle('😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀', 15)).toBe('😀😀😀😀😀😀😀😀…😀😀😀😀😀😀')
  })
})

describe('commandBlocks', () => {
  it('groups plain arguments between JSON objects in argv order', () => {
    const blocks = commandBlocks(structureCommand(['tool', 'run', '--env', 'prod', '{"a":1}', 'x', '--force'])!)
    expect(blocks).toEqual([
      { kind: 'list', items: ['--env prod'] },
      { kind: 'object', option: null, entries: [{ key: 'a', value: '1' }] },
      { kind: 'list', items: ['x', '--force'] },
    ])
  })
})
