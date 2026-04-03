import { describe, expect, it } from 'vitest'
import type { OpenApeCliAuthorizationDetail } from '@openape/core'
import {
  canonicalizeCliPermission,
  cliAuthorizationDetailCovers,
  cliAuthorizationDetailIsSimilar,
  cliAuthorizationDetailsCover,
  computeArgvHash,
  findDifferingSelectors,
  isCliAuthorizationDetailExact,
  mergeCliAuthorizationDetails,
  resourceChainsStructurallyMatch,
  validateCliAuthorizationDetail,
  widenCliAuthorizationDetail,
} from '../cli-permissions.js'

describe('cli grant helpers', () => {
  const detail: OpenApeCliAuthorizationDetail = {
    type: 'openape_cli' as const,
    cli_id: 'gh',
    operation_id: 'repo.list',
    resource_chain: [
      { resource: 'owner', selector: { login: 'openape' } },
      { resource: 'repo' },
    ],
    action: 'list',
    permission: 'gh.owner[login=openape].repo[*]#list',
    display: 'List repositories for owner openape',
    risk: 'low' as const,
  }

  it('canonicalizes resource chains into permissions', () => {
    expect(canonicalizeCliPermission(detail)).toBe('gh.owner[login=openape].repo[*]#list')
  })

  it('validates canonical permission alignment', () => {
    expect(validateCliAuthorizationDetail(detail).valid).toBe(true)
    expect(validateCliAuthorizationDetail({ ...detail, permission: 'wrong' }).valid).toBe(false)
  })

  it('checks coverage between wildcard and concrete details', () => {
    const granted = detail
    const required: typeof detail = {
      ...detail,
      resource_chain: [
        { resource: 'owner', selector: { login: 'openape' } },
        { resource: 'repo', selector: { name: 'cli' } },
      ] as typeof detail.resource_chain,
      permission: 'gh.owner[login=openape].repo[name=cli]#list',
    }

    expect(cliAuthorizationDetailCovers(granted, required)).toBe(true)
    expect(cliAuthorizationDetailCovers(required, granted)).toBe(false)
    expect(cliAuthorizationDetailsCover([granted], [required])).toBe(true)
    expect(cliAuthorizationDetailsCover([required], [granted])).toBe(false)
  })

  it('detects exact-command constraints', () => {
    expect(isCliAuthorizationDetailExact(detail)).toBe(false)
    expect(isCliAuthorizationDetailExact({
      ...detail,
      constraints: { exact_command: true },
    })).toBe(true)
  })

  // -- prefix coverage tests --

  function makeDetail(overrides: Partial<OpenApeCliAuthorizationDetail>): OpenApeCliAuthorizationDetail {
    return {
      type: 'openape_cli',
      cli_id: 'gh',
      operation_id: 'capability.list',
      resource_chain: [],
      action: 'list',
      permission: '',
      display: '',
      risk: 'low',
      ...overrides,
    }
  }

  it('prefix coverage: shorter granted chain covers longer required', () => {
    const granted = makeDetail({
      resource_chain: [{ resource: 'owner', selector: { login: 'openape' } }],
    })
    const required = makeDetail({
      resource_chain: [
        { resource: 'owner', selector: { login: 'openape' } },
        { resource: 'repo', selector: { name: 'cli' } },
      ],
    })
    expect(cliAuthorizationDetailCovers(granted, required)).toBe(true)
  })

  it('longer granted chain does NOT cover shorter required', () => {
    const granted = makeDetail({
      resource_chain: [
        { resource: 'owner', selector: { login: 'openape' } },
        { resource: 'repo', selector: { name: 'cli' } },
      ],
    })
    const required = makeDetail({
      resource_chain: [{ resource: 'owner', selector: { login: 'openape' } }],
    })
    expect(cliAuthorizationDetailCovers(granted, required)).toBe(false)
  })

  it('prefix coverage with wildcard at boundary', () => {
    const granted = makeDetail({
      resource_chain: [
        { resource: 'owner', selector: { login: 'openape' } },
        { resource: 'repo' },
      ],
    })
    const required = makeDetail({
      resource_chain: [
        { resource: 'owner', selector: { login: 'openape' } },
        { resource: 'repo', selector: { name: 'cli' } },
        { resource: 'issue', selector: { number: '5' } },
      ],
    })
    expect(cliAuthorizationDetailCovers(granted, required)).toBe(true)
  })

  it('prefix coverage fails when position does not match', () => {
    const granted = makeDetail({
      resource_chain: [{ resource: 'owner', selector: { login: 'openape' } }],
    })
    const required = makeDetail({
      resource_chain: [
        { resource: 'owner', selector: { login: 'other' } },
        { resource: 'repo' },
      ],
    })
    expect(cliAuthorizationDetailCovers(granted, required)).toBe(false)
  })

  it('prefix coverage requires same action', () => {
    const granted = makeDetail({
      resource_chain: [{ resource: 'owner', selector: { login: 'openape' } }],
      action: 'list',
    })
    const required = makeDetail({
      resource_chain: [
        { resource: 'owner', selector: { login: 'openape' } },
        { resource: 'repo' },
      ],
      action: 'delete',
    })
    expect(cliAuthorizationDetailCovers(granted, required)).toBe(false)
  })

  it('hashes argv deterministically', async () => {
    const first = await computeArgvHash(['gh', 'repo', 'list', 'openape'])
    const second = await computeArgvHash(['gh', 'repo', 'list', 'openape'])
    expect(first).toBe(second)
    expect(first).toMatch(/^SHA-256:/)
  })

  // -- similarity detection tests --

  describe('resourceChainsStructurallyMatch', () => {
    it('matches identical chains', () => {
      const a: OpenApeCliAuthorizationDetail['resource_chain'] = [{ resource: 'owner', selector: { login: 'a' } }, { resource: 'repo' }]
      const b: OpenApeCliAuthorizationDetail['resource_chain'] = [{ resource: 'owner', selector: { login: 'b' } }, { resource: 'repo', selector: { name: 'x' } }]
      expect(resourceChainsStructurallyMatch(a, b)).toBe(true)
    })

    it('rejects different lengths', () => {
      const a: OpenApeCliAuthorizationDetail['resource_chain'] = [{ resource: 'owner' }]
      const b: OpenApeCliAuthorizationDetail['resource_chain'] = [{ resource: 'owner' }, { resource: 'repo' }]
      expect(resourceChainsStructurallyMatch(a, b)).toBe(false)
    })

    it('rejects different resource names', () => {
      const a: OpenApeCliAuthorizationDetail['resource_chain'] = [{ resource: 'owner' }, { resource: 'repo' }]
      const b: OpenApeCliAuthorizationDetail['resource_chain'] = [{ resource: 'owner' }, { resource: 'issue' }]
      expect(resourceChainsStructurallyMatch(a, b)).toBe(false)
    })

    it('matches empty chains', () => {
      expect(resourceChainsStructurallyMatch([], [])).toBe(true)
    })
  })

  describe('findDifferingSelectors', () => {
    it('finds no differences for identical selectors', () => {
      const a: OpenApeCliAuthorizationDetail['resource_chain'] = [{ resource: 'owner', selector: { login: 'openape' } }]
      const b: OpenApeCliAuthorizationDetail['resource_chain'] = [{ resource: 'owner', selector: { login: 'openape' } }]
      expect(findDifferingSelectors(a, b)).toEqual([])
    })

    it('finds one differing position', () => {
      const a: OpenApeCliAuthorizationDetail['resource_chain'] = [
        { resource: 'owner', selector: { login: 'openape' } },
        { resource: 'repo', selector: { name: 'cli' } },
      ]
      const b: OpenApeCliAuthorizationDetail['resource_chain'] = [
        { resource: 'owner', selector: { login: 'openape' } },
        { resource: 'repo', selector: { name: 'docs' } },
      ]
      expect(findDifferingSelectors(a, b)).toEqual([1])
    })

    it('finds multiple differing positions', () => {
      const a: OpenApeCliAuthorizationDetail['resource_chain'] = [
        { resource: 'owner', selector: { login: 'alice' } },
        { resource: 'repo', selector: { name: 'cli' } },
      ]
      const b: OpenApeCliAuthorizationDetail['resource_chain'] = [
        { resource: 'owner', selector: { login: 'bob' } },
        { resource: 'repo', selector: { name: 'docs' } },
      ]
      expect(findDifferingSelectors(a, b)).toEqual([0, 1])
    })

    it('detects wildcard vs concrete as different', () => {
      const a: OpenApeCliAuthorizationDetail['resource_chain'] = [{ resource: 'repo' }]
      const b: OpenApeCliAuthorizationDetail['resource_chain'] = [{ resource: 'repo', selector: { name: 'cli' } }]
      expect(findDifferingSelectors(a, b)).toEqual([0])
    })
  })

  describe('cliAuthorizationDetailIsSimilar', () => {
    const detailA = makeDetail({
      resource_chain: [
        { resource: 'owner', selector: { login: 'openape' } },
        { resource: 'repo', selector: { name: 'cli' } },
      ],
    })
    const detailB = makeDetail({
      resource_chain: [
        { resource: 'owner', selector: { login: 'openape' } },
        { resource: 'repo', selector: { name: 'docs' } },
      ],
    })

    it('returns true for same structure, different selectors', () => {
      expect(cliAuthorizationDetailIsSimilar(detailA, detailB)).toBe(true)
    })

    it('returns false for different cli_id', () => {
      expect(cliAuthorizationDetailIsSimilar(
        detailA,
        makeDetail({ ...detailB, cli_id: 'npm' }),
      )).toBe(false)
    })

    it('returns false for different action', () => {
      expect(cliAuthorizationDetailIsSimilar(
        detailA,
        makeDetail({ ...detailB, action: 'delete' }),
      )).toBe(false)
    })

    it('returns false when existing already covers incoming', () => {
      const wildcard = makeDetail({
        resource_chain: [
          { resource: 'owner', selector: { login: 'openape' } },
          { resource: 'repo' },
        ],
      })
      const concrete = makeDetail({
        resource_chain: [
          { resource: 'owner', selector: { login: 'openape' } },
          { resource: 'repo', selector: { name: 'cli' } },
        ],
      })
      expect(cliAuthorizationDetailIsSimilar(wildcard, concrete)).toBe(false)
    })

    it('returns false for identical details', () => {
      expect(cliAuthorizationDetailIsSimilar(detailA, detailA)).toBe(false)
    })

    it('returns false for different chain lengths', () => {
      const short = makeDetail({
        resource_chain: [{ resource: 'owner', selector: { login: 'openape' } }],
      })
      expect(cliAuthorizationDetailIsSimilar(short, detailA)).toBe(false)
    })
  })

  describe('widenCliAuthorizationDetail', () => {
    it('widens differing selector positions to wildcard', () => {
      const existing = makeDetail({
        resource_chain: [
          { resource: 'owner', selector: { login: 'openape' } },
          { resource: 'repo', selector: { name: 'cli' } },
        ],
      })
      const incoming = makeDetail({
        resource_chain: [
          { resource: 'owner', selector: { login: 'openape' } },
          { resource: 'repo', selector: { name: 'docs' } },
        ],
      })

      const widened = widenCliAuthorizationDetail(existing, incoming)
      expect(widened.resource_chain[0]!.selector).toEqual({ login: 'openape' })
      expect(widened.resource_chain[1]!.selector).toBeUndefined()
      expect(widened.permission).toBe('gh.owner[login=openape].repo[*]#list')
    })

    it('widens multiple differing positions', () => {
      const existing = makeDetail({
        resource_chain: [
          { resource: 'owner', selector: { login: 'alice' } },
          { resource: 'repo', selector: { name: 'cli' } },
        ],
      })
      const incoming = makeDetail({
        resource_chain: [
          { resource: 'owner', selector: { login: 'bob' } },
          { resource: 'repo', selector: { name: 'docs' } },
        ],
      })

      const widened = widenCliAuthorizationDetail(existing, incoming)
      expect(widened.resource_chain[0]!.selector).toBeUndefined()
      expect(widened.resource_chain[1]!.selector).toBeUndefined()
      expect(widened.permission).toBe('gh.owner[*].repo[*]#list')
    })

    it('preserves non-differing selectors', () => {
      const existing = makeDetail({
        resource_chain: [
          { resource: 'owner', selector: { login: 'openape' } },
          { resource: 'repo', selector: { name: 'cli' } },
          { resource: 'issue', selector: { number: '1' } },
        ],
      })
      const incoming = makeDetail({
        resource_chain: [
          { resource: 'owner', selector: { login: 'openape' } },
          { resource: 'repo', selector: { name: 'docs' } },
          { resource: 'issue', selector: { number: '1' } },
        ],
      })

      const widened = widenCliAuthorizationDetail(existing, incoming)
      expect(widened.resource_chain[0]!.selector).toEqual({ login: 'openape' })
      expect(widened.resource_chain[1]!.selector).toBeUndefined()
      expect(widened.resource_chain[2]!.selector).toEqual({ number: '1' })
    })
  })

  describe('mergeCliAuthorizationDetails', () => {
    it('unions two non-overlapping sets', () => {
      const setA = [makeDetail({
        resource_chain: [{ resource: 'owner', selector: { login: 'openape' } }, { resource: 'repo', selector: { name: 'cli' } }],
        permission: 'gh.owner[login=openape].repo[name=cli]#list',
      })]
      const setB = [makeDetail({
        resource_chain: [{ resource: 'owner', selector: { login: 'openape' } }, { resource: 'repo', selector: { name: 'docs' } }],
        permission: 'gh.owner[login=openape].repo[name=docs]#list',
      })]

      const merged = mergeCliAuthorizationDetails(setA, setB)
      expect(merged).toHaveLength(2)
    })

    it('deduplicates by canonical permission', () => {
      const detailA = makeDetail({
        resource_chain: [{ resource: 'owner', selector: { login: 'openape' } }, { resource: 'repo', selector: { name: 'cli' } }],
        permission: 'gh.owner[login=openape].repo[name=cli]#list',
      })

      const merged = mergeCliAuthorizationDetails([detailA], [detailA])
      expect(merged).toHaveLength(1)
    })

    it('keeps broader entry on duplicate', () => {
      const specific = makeDetail({
        resource_chain: [{ resource: 'owner', selector: { login: 'openape' } }, { resource: 'repo' }],
        permission: 'gh.owner[login=openape].repo[*]#list',
      })
      const alsoSpecific = makeDetail({
        resource_chain: [{ resource: 'owner', selector: { login: 'openape' } }, { resource: 'repo' }],
        permission: 'gh.owner[login=openape].repo[*]#list',
      })

      const merged = mergeCliAuthorizationDetails([specific], [alsoSpecific])
      expect(merged).toHaveLength(1)
    })

    it('merges three sets', () => {
      const a = [makeDetail({ resource_chain: [{ resource: 'repo', selector: { name: 'a' } }], permission: 'gh.repo[name=a]#list' })]
      const b = [makeDetail({ resource_chain: [{ resource: 'repo', selector: { name: 'b' } }], permission: 'gh.repo[name=b]#list' })]
      const c = [makeDetail({ resource_chain: [{ resource: 'repo', selector: { name: 'c' } }], permission: 'gh.repo[name=c]#list' })]

      const merged = mergeCliAuthorizationDetails(a, b, c)
      expect(merged).toHaveLength(3)
    })
  })
})
