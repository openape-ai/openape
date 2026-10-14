// The generic grant card (issue 1473): registry meaning only from adapters in
// the IdP's shapes table, matched by adapter digest and re-derived from the
// grant's own argv; the binding line never yields to a requester title.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { OpenApeGrant } from '@openape/core'
import { describe, expect, it, vi } from 'vitest'
import { registryCard, withGrantCards } from '../src/runtime/server/utils/grant-card'
import { grantBindingLine } from '../src/runtime/utils/grant-card'
import type { GrantWithCard } from '../src/runtime/utils/grant-card'
import { buildCardFixtures, findUser, getShape, gitAdapter, podArgv, podRuntimeAdapter, pushArgv, shapedRequest } from './helpers/grant-card-fixtures'

vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => ({}), useEvent: () => undefined, useStorage: () => ({}) }))

describe('registry card', () => {
  it('renders the Pod run card from the pod-runtime adapter', async () => {
    const card = await registryCard(await shapedRequest(podRuntimeAdapter, podArgv), getShape)

    expect(card).toMatchObject({
      cli_id: 'pod-runtime',
      operation_id: 'run',
      title: { de: 'Mail digest', en: 'Mail digest' },
      statement: { de: 'Gespeichertes Pod-Skript ausführen', en: 'Run the stored Pod script' },
    })
    expect(card!.allows!.en).toContain('separately assigned permissions')
    expect(card!.does_not_allow!.de).toContain('keine beliebigen Shell-Befehle')
    expect(card!.facts).toEqual([
      { label: { de: 'Skript', en: 'Script' }, format: 'code', value: '/Users/owner/Pods/mail-digest/run.mjs' },
      { label: { de: 'Arbeitsverzeichnis', en: 'Working directory' }, format: 'code', value: '/Users/owner/Pods/mail-digest/workspace' },
    ])
    expect(card!.details[0]!.entries).toEqual([['HOME', '/Users/owner/Pods/mail-digest/home'], ['LANG', 'de_AT.UTF-8']])
  })

  it('renders git push with the values the IdP derives from the argv', async () => {
    const card = await registryCard(await shapedRequest(gitAdapter, pushArgv, { command: pushArgv }), getShape)

    expect(card!.title).toEqual({ de: 'feature/rebase nach origin pushen', en: 'Push feature/rebase to origin' })
    expect(card!.facts.map(fact => fact.value)).toEqual(['/Users/owner/repos/iurio', 'feature/rebase'])
  })

  it('falls back when the adapter is unknown, changed or the grant does not fit it', async () => {
    const request = await shapedRequest(gitAdapter, pushArgv, { command: pushArgv })
    const context = request.execution_context!

    expect(await registryCard(request, async () => null)).toBeNull()
    expect(await registryCard({ ...request, execution_context: { ...context, adapter_digest: 'SHA-256:other' } }, getShape)).toBeNull()
    expect(await registryCard({ ...request, execution_context: { ...context, argv_hash: 'SHA-256:other' } }, getShape)).toBeNull()
    // A command that differs from the resolved argv cannot borrow its meaning.
    expect(await registryCard({ ...request, command: [...pushArgv.slice(0, -1), 'main'] }, getShape)).toBeNull()
    // An argv that names another remote than the permission covers is not rendered.
    const forged = pushArgv.map(token => token === 'origin' ? 'upstream' : token)
    expect(await registryCard({ ...request, command: undefined, execution_context: { ...context, argv: forged, argv_hash: undefined } }, getShape)).toBeNull()
  })

  it('falls back for operations without presentation and for chained requests', async () => {
    expect(await registryCard(await shapedRequest(gitAdapter, ['git', 'push']), getShape)).toBeNull()

    const pod = await shapedRequest(podRuntimeAdapter, podArgv)
    expect(await registryCard({ ...pod, authorization_details: [...pod.authorization_details!, ...pod.authorization_details!] }, getShape)).toBeNull()
  })
})

describe('grant cards', () => {
  it('attach the requester registration from the IdP', async () => {
    const { podRun } = await buildCardFixtures()
    const [unknown] = await withGrantCards([{ ...podRun, request: { ...podRun.request, requester: 'stranger@example.com' } } as OpenApeGrant], { getShape, findUser })

    expect(podRun.card!.requester).toEqual({ name: 'Mail digest Pod', owner: 'owner@example.com' })
    expect(podRun.card!.registry?.title.en).toBe('Mail digest')
    expect(unknown!.card.requester).toBeNull()
  })

  it('keep the binding line when the requester title says something else', async () => {
    const { gitPush, unknown } = await buildCardFixtures()

    expect(gitPush.request.summary?.title).toBe('Read-only status check')
    expect(grantBindingLine(gitPush, 'en')).toEqual({ kind: 'registry', text: 'Push feature/rebase to origin' })
    const withoutRegistry: GrantWithCard = { ...gitPush, card: { registry: null, requester: null } }
    expect(grantBindingLine(withoutRegistry, 'de')).toEqual({ kind: 'command', text: pushArgv.join(' ') })
    expect(grantBindingLine(unknown, 'en')).toEqual({ kind: 'command', text: 'acme-cli deploy --env production' })
  })

  // After an adapter change: UPDATE_GRANT_CARD_FIXTURES=1 pnpm vitest run test/grant-card.test.ts
  it('browser fixtures equal the rendering of the registry adapters', async () => {
    const file = join(__dirname, 'fixtures/grant-cards.json')
    const built = await buildCardFixtures()
    if (process.env.UPDATE_GRANT_CARD_FIXTURES) writeFileSync(file, `${JSON.stringify(built, null, 2)}\n`)
    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual(JSON.parse(JSON.stringify(built)))
  })
})
