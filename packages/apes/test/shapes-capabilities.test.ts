import { describe, expect, it } from 'vitest'
import type { LoadedAdapter, ShapesOperation } from '../src/shapes/types.js'
import { resolveCapabilityRequest } from '../src/shapes/capabilities.js'

function makeOperation(overrides: Partial<ShapesOperation> & Pick<ShapesOperation, 'id' | 'command' | 'resource_chain' | 'action'>): ShapesOperation {
  return {
    display: overrides.id,
    risk: 'low',
    ...overrides,
  }
}

function makeAdapter(operations: ShapesOperation[]): LoadedAdapter {
  return {
    adapter: {
      schema: 'openape-shapes/v1',
      cli: { id: 'test', executable: 'test-cli' },
      operations,
    },
    source: '/test/adapter.toml',
    digest: 'SHA-256:test',
  }
}

const ops: ShapesOperation[] = [
  makeOperation({
    id: 'account.list',
    command: ['account', 'list'],
    resource_chain: ['account:email={email}'],
    action: 'list',
  }),
  makeOperation({
    id: 'mail.list',
    command: ['mail', 'list'],
    resource_chain: ['account:email={email}', 'mail:*'],
    action: 'list',
  }),
  makeOperation({
    id: 'mail.edit',
    command: ['mail', 'mark-read'],
    resource_chain: ['account:email={email}', 'mail:id={id}'],
    action: 'edit',
  }),
  makeOperation({
    id: 'mail.delete',
    command: ['mail', 'delete'],
    resource_chain: ['account:email={email}', 'mail:id={id}'],
    action: 'delete',
    risk: 'critical',
  }),
]

const loaded = makeAdapter(ops)

describe('resolveCapabilityRequest', () => {
  it('exact sequence match: account + mail', () => {
    const result = resolveCapabilityRequest(loaded, {
      resources: ['account', 'mail'],
      actions: ['edit'],
      selectors: ['account.email=user@example.com'],
    })
    expect(result.details).toHaveLength(1)
    expect(result.details[0]!.action).toBe('edit')
    expect(result.details[0]!.resource_chain).toHaveLength(2)
  })

  it('prefix match: account alone matches account + mail operations', () => {
    const result = resolveCapabilityRequest(loaded, {
      resources: ['account'],
      actions: ['list'],
      selectors: ['account.email=user@example.com'],
    })
    expect(result.details).toHaveLength(1)
    expect(result.details[0]!.action).toBe('list')
    // Matches both account.list (exact) and mail.list (prefix)
  })

  it('prefix match: account covers edit action from deeper operations', () => {
    const result = resolveCapabilityRequest(loaded, {
      resources: ['account'],
      actions: ['edit'],
      selectors: ['account.email=user@example.com'],
    })
    expect(result.details).toHaveLength(1)
    expect(result.details[0]!.action).toBe('edit')
  })

  it('aggregates risk from all matching operations', () => {
    const result = resolveCapabilityRequest(loaded, {
      resources: ['account'],
      actions: ['delete'],
      selectors: ['account.email=user@example.com'],
    })
    expect(result.details[0]!.risk).toBe('critical')
  })

  it('throws when no operations match resource chain', () => {
    expect(() => resolveCapabilityRequest(loaded, {
      resources: ['nonexistent'],
      actions: ['list'],
    })).toThrow('No adapter operation supports resource chain')
  })

  it('throws when action not available for matched operations', () => {
    expect(() => resolveCapabilityRequest(loaded, {
      resources: ['account', 'mail'],
      actions: ['list', 'create'],
    })).toThrow('Action create is not valid')
  })

  it('throws for unknown selector keys', () => {
    expect(() => resolveCapabilityRequest(loaded, {
      resources: ['account'],
      actions: ['list'],
      selectors: ['account.bogus=value'],
    })).toThrow('Unknown selector account.bogus')
  })
})
