import { describe, expect, it } from 'vitest'
import {
  interpolate,
  materializeRecipe,
  parseRecipe,
  parseRepoRef,
  resolveParams,
} from '../server/utils/agent-recipe'

const VALID = `
name: bluesky-summary
kind: agent
intent: |
  Summarize the Bluesky feed about {{topic}}.
capabilities:
  - env: BLUESKY_HANDLE
  - env: BLUESKY_APP_PASSWORD
    prefer: local
params:
  - name: topic
    type: string
    required: true
schedules:
  - cron: "0 8 * * *"
  - cron: "0 18 * * *"
    description: evening run for {{topic}}
user_addendum: true
tools:
  - tools/summarize.mjs
`

describe('parseRecipe', () => {
  it('parses a valid manifest', () => {
    const r = parseRecipe(VALID)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.name).toBe('bluesky-summary')
    expect(r.value.kind).toBe('agent')
    expect(r.value.capabilities).toHaveLength(2)
    expect(r.value.user_addendum).toBe(true)
    expect(r.value.schedules).toHaveLength(2)
  })

  it('defaults optional collections', () => {
    const r = parseRecipe('name: x\nkind: agent\nintent: hi\nschedules:\n  - cron: "* * * * *"\n')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.capabilities).toEqual([])
    expect(r.value.params).toEqual([])
    expect(r.value.user_addendum).toBe(false)
  })

  it.each([
    ['rejects non-mapping', 'just a string', /must be a YAML mapping/],
    ['rejects kind:script (v1 agent only)', 'name: x\nkind: script\nintent: hi\nschedules:\n  - cron: "* * * * *"\n', /kind/],
    ['rejects missing intent', 'name: x\nkind: agent\nschedules:\n  - cron: "* * * * *"\n', /intent/],
    ['rejects no schedules', 'name: x\nkind: agent\nintent: hi\nschedules: []\n', /schedules/],
    ['rejects invalid cron', 'name: x\nkind: agent\nintent: hi\nschedules:\n  - cron: "@hourly"\n', /invalid schedule cron/],
    ['rejects non-kebab name', 'name: BadName\nkind: agent\nintent: hi\nschedules:\n  - cron: "* * * * *"\n', /kebab/],
  ])('%s', (_label, yaml, re) => {
    const r = parseRecipe(yaml)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toMatch(re)
  })

  it('rejects duplicate capability', () => {
    const r = parseRecipe('name: x\nkind: agent\nintent: hi\ncapabilities:\n  - env: A\n  - env: A\nschedules:\n  - cron: "* * * * *"\n')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toMatch(/duplicate capability: A/)
  })
})

describe('parseRepoRef — ref-pin enforcement', () => {
  it.each([
    'github.com/openape-official-ape-agents/bluesky-summary@v0.1.0',
    'github.com/o/r@1.2.3',
    'github.com/o/r@1.2.3-rc.1',
    'github.com/o/r@9f1c2ab',
    'github.com/o/r@9f1c2ab3d4e5f60718293a4b5c6d7e8f90123456',
  ])('accepts pinned ref %s', (spec) => {
    expect(parseRepoRef(spec).ok).toBe(true)
  })

  it.each([
    ['github.com/o/r@main', /floating ref "main"/],
    ['github.com/o/r@master', /floating ref/],
    ['github.com/o/r@HEAD', /floating ref/],
    ['github.com/o/r@feature/foo', /floating ref/],
    ['github.com/o/r@latest', /floating ref/],
    ['github.com/o/r', /missing pinned ref/],
    ['github.com/o/r@', /ref is empty/],
  ])('rejects %s', (spec, re) => {
    const r = parseRepoRef(spec)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toMatch(re)
  })
})

describe('resolveParams', () => {
  const recipe = parseRecipe(VALID)
  if (!recipe.ok) throw new Error('fixture invalid')

  it('errors on missing required param', () => {
    const r = resolveParams(recipe.value, {})
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toMatch(/missing required param: topic/)
  })

  it('passes the supplied required param through', () => {
    const r = resolveParams(recipe.value, { topic: 'AI agents' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.topic).toBe('AI agents')
  })

  it('rejects unknown param', () => {
    const r = resolveParams(recipe.value, { topic: 'x', nope: 1 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toMatch(/unknown param: nope/)
  })

  it('applies default and coerces types', () => {
    const rc = parseRecipe('name: x\nkind: agent\nintent: hi\nschedules:\n  - cron: "* * * * *"\nparams:\n  - name: n\n    type: number\n    default: 5\n  - name: flag\n    type: boolean\n')
    expect(rc.ok).toBe(true)
    if (!rc.ok) return
    const r = resolveParams(rc.value, { flag: 'true' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.n).toBe(5)
    expect(r.value.flag).toBe(true)
  })

  it('errors when a number param gets a non-number', () => {
    const rc = parseRecipe('name: x\nkind: agent\nintent: hi\nschedules:\n  - cron: "* * * * *"\nparams:\n  - name: n\n    type: number\n    required: true\n')
    if (!rc.ok) throw new Error('fixture')
    const r = resolveParams(rc.value, { n: 'abc' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toMatch(/param "n": expected a number/)
  })
})

describe('interpolate', () => {
  it('replaces {{topic}} in the intent', () => {
    const r = interpolate('Summarize {{topic}} now', { topic: 'AI agents' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toBe('Summarize AI agents now')
  })

  it('tolerates inner whitespace', () => {
    const r = interpolate('x={{  topic  }}', { topic: 'y' })
    expect(r.ok && r.value).toBe('x=y')
  })

  it('errors on unresolved placeholder', () => {
    const r = interpolate('hi {{missing}}', {})
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toMatch(/unresolved placeholder\(s\): missing/)
  })
})

describe('materializeRecipe — end to end', () => {
  it('resolves params and interpolates intent + schedule descriptions', () => {
    const recipe = parseRecipe(VALID)
    if (!recipe.ok) throw new Error('fixture')
    const r = materializeRecipe(recipe.value, { topic: 'AI agents' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.intent).toContain('Summarize the Bluesky feed about AI agents.')
    const evening = r.value.schedules.find(s => s.cron === '0 18 * * *')
    expect(evening?.description).toBe('evening run for AI agents')
    expect(r.value.tools).toEqual(['tools/summarize.mjs'])
  })

  it('fails fast if a required param is missing', () => {
    const recipe = parseRecipe(VALID)
    if (!recipe.ok) throw new Error('fixture')
    const r = materializeRecipe(recipe.value, {})
    expect(r.ok).toBe(false)
  })
})
