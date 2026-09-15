import { expect, it } from 'vitest'
import { programRequest } from '../../src/main/programs/invoke'
import type { PodResource } from '../../src/contracts/resources'

const podId = '00000000-0000-4000-8000-000000000001'
const resource: PodResource = { id: '00000000-0000-4000-8000-000000000002', podId, name: 'o365-cli', kind: 'tool', state: 'ready', revision: 1, configuration: { type: 'program', capability: 'tool.mail.invoke' } }
it('resolves one assigned application by name without an owner-managed ID variable', () => {
  expect(programRequest([resource], podId, ['tool.mail.invoke'], { application: 'o365-cli', argv: ['read'] }).id).toBe(resource.id)
  expect(programRequest([resource], podId, ['tool.mail.invoke'], { applicationId: resource.id, argv: ['read'] }).id).toBe(resource.id)
})
it('rejects foreign, revoked, undeclared, ambiguous and conflicting application selections', () => {
  const invoke = (resources: PodResource[], capabilities = ['tool.mail.invoke']) => programRequest(resources, podId, capabilities, { application: 'o365-cli', argv: ['read'] })
  expect(() => invoke([{ ...resource, podId: 'foreign' }])).toThrow()
  expect(() => invoke([{ ...resource, state: 'revoked' }])).toThrow()
  expect(() => invoke([resource], [])).toThrow()
  expect(() => invoke([resource, { ...resource, id: 'other' }])).toThrow('ambiguous')
  expect(() => programRequest([resource], podId, ['tool.mail.invoke'], { application: 'o365-cli', applicationId: resource.id, argv: ['read'] })).toThrow()
})
