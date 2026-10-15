// The generic grant card (issue 1473): registry meaning only from adapters in
// the IdP's shapes table, matched by adapter digest and re-derived from the
// grant's own argv; the binding line always stays visible (a requester title
// leads only above an exact command), and values the approval does not bind
// are marked as requested.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { OpenApeGrant } from '@openape/core'
import { describe, expect, it, vi } from 'vitest'
import { registryCard, withGrantCards } from '../src/runtime/server/utils/grant-card'
import { grantBindingLine, requesterHeadline } from '../src/runtime/utils/grant-card'
import type { GrantWithCard } from '../src/runtime/utils/grant-card'
import { buildCardFixtures, findUser, getShape, gitAdapter, idpResolvedRequest, POD_ID, podArgv, podRuntimeAdapter, pushArgv, shapedRequest, UNTESTED_GIT_SHA256 } from './helpers/grant-card-fixtures'

vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => ({}), useEvent: () => undefined, useStorage: () => ({}) }))

const podRequest = async (argv = podArgv) => await shapedRequest(podRuntimeAdapter, argv, { target_host: `pods:${POD_ID}` })
const withOption = (name: string, value: string) => podArgv.map((token, index) => podArgv[index - 1] === `--${name}` ? value : token)

describe('registry card', () => {
  it('renders the Pod run card and marks every value the permission does not bind as requested', async () => {
    const card = await registryCard(await podRequest(), getShape)

    expect(card).toMatchObject({
      cli_id: 'pod-runtime',
      operation_id: 'run',
      // The Pod name is the requester's: only the Pod id is part of the permission.
      title: { de: 'Mail digest', en: 'Mail digest', requested: true },
      statement: { de: 'Gespeichertes Pod-Skript ausführen', en: 'Run the stored Pod script' },
    })
    expect(card!.statement!.requested).toBeUndefined()
    expect(card!.allows!.en).toContain('separately assigned permissions')
    expect(card!.does_not_allow!.de).toContain('keine beliebigen Shell-Befehle')
    expect(card!.facts).toEqual([
      { label: { de: 'Skript', en: 'Script' }, format: 'code', value: '/Users/owner/Pods/mail-digest/run.mjs', provenance: 'requested' },
      { label: { de: 'Arbeitsverzeichnis', en: 'Working directory' }, format: 'code', value: '/Users/owner/Pods/mail-digest/workspace', provenance: 'requested' },
    ])
    expect(card!.details[0]).toMatchObject({ provenance: 'requested', entries: [['HOME', '/Users/owner/Pods/mail-digest/home'], ['LANG', 'de_AT.UTF-8']] })
  })

  it('treats every value of an exact command as bound, but only with a verified argv hash', async () => {
    const request = await shapedRequest(gitAdapter, pushArgv, { command: pushArgv })
    const card = await registryCard(request, getShape)

    expect(card!.title).toEqual({ de: 'feature/rebase nach origin pushen', en: 'Push feature/rebase to origin' })
    expect(card!.facts.map(fact => [fact.value, fact.provenance])).toEqual([['/Users/owner/repos/iurio', 'bound'], ['feature/rebase', 'bound']])

    const unhashed = await registryCard({ ...request, execution_context: { ...request.execution_context!, argv_hash: undefined } }, getShape)
    expect(unhashed!.title.requested).toBe(true)
    expect(unhashed!.facts.map(fact => fact.provenance)).toEqual(['requested', 'requested'])
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

  it('falls back when the request misses the adapter\'s target host', async () => {
    const pod = await podRequest()
    expect(await registryCard({ ...pod, target_host: 'pods:00000000-0000-4000-8000-000000000002' }, getShape)).toBeNull()
    expect(await registryCard({ ...pod, target_host: 'macmini' }, getShape)).toBeNull()
  })

  it('falls back for oversized values, control or format characters and malformed maps', async () => {
    expect(await registryCard(await podRequest(withOption('script', `/${'x'.repeat(5000)}`)), getShape)).toBeNull()
    expect(await registryCard(await podRequest(withOption('name', 'Mail \u202Edigest')), getShape)).toBeNull()
    expect(await registryCard(await podRequest(withOption('environment', '{"HOME":"/a\nb"}')), getShape)).toBeNull()
    expect(await registryCard(await podRequest(withOption('environment', '{"HOME":1}')), getShape)).toBeNull()
    expect(await registryCard(await podRequest(withOption('environment', 'HOME=/a')), getShape)).toBeNull()
    const manyVariables = JSON.stringify(Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`V${index}`, 'x'])))
    expect(await registryCard(await podRequest(withOption('environment', manyVariables)), getShape)).toBeNull()
  })

  it('falls back for operations without presentation and for chained requests', async () => {
    expect(await registryCard(await shapedRequest(gitAdapter, ['git', 'push']), getShape)).toBeNull()

    const pod = await podRequest()
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

  it('lead with the requester title only above an exact command the approval binds', async () => {
    const { gitPush, podRun, unknown, graphGate } = await buildCardFixtures()
    const headline = (grant: GrantWithCard) => requesterHeadline(grant, grantBindingLine(grant, 'en'))
    const withoutRegistry = (grant: GrantWithCard): GrantWithCard => ({ ...grant, card: { registry: null, requester: null } })

    expect(headline(unknown)).toBe('Deploy the hotfix')
    expect(headline(graphGate)).toBe('62 Personen haben sich Ihr Profil angesehen')
    // A registry title keeps the lead.
    expect(headline(gitPush)).toBeNull()
    expect(headline(podRun)).toBeNull()
    // Without the registry adapter, only an exact-only permission binds nothing but the shown command.
    expect(headline(withoutRegistry(gitPush))).toBe('Read-only status check')
    expect(headline({ ...withoutRegistry(podRun), request: { ...podRun.request, command: podArgv } })).toBeNull()
    // A plain command request is bound by its command hash alone.
    const plain: GrantWithCard = { id: 'g', status: 'pending', created_at: 0, request: { requester: 'agent@example.com', target_host: 'macmini', audience: 'escapes', command: ['ls', '-la'], cmd_hash: 'SHA-256:1', summary: { title: 'List the folder' } } }
    expect(headline(plain)).toBe('List the folder')
    expect(headline({ ...plain, request: { ...plain.request, command: undefined, permissions: ['files.read'] } })).toBeNull()
  })

  it('keep the command line in the lead without a title or with an unsafe title', async () => {
    const { unknown } = await buildCardFixtures()
    const titled = (title: string | undefined): GrantWithCard => ({ ...unknown, request: { ...unknown.request, summary: title === undefined ? undefined : { title } } })
    const headline = (grant: GrantWithCard) => requesterHeadline(grant, grantBindingLine(grant, 'en'))

    expect(headline(titled(undefined))).toBeNull()
    expect(headline(titled('   '))).toBeNull()
    expect(headline(titled('  Deploy the hotfix  '))).toBe('Deploy the hotfix')
    for (const unsafe of ['Deploy\u202Eexif.exe', 'two\nlines', 'zero\u200Bwidth', 'line\u2028separator', 'x'.repeat(121)])
      expect(headline(titled(unsafe))).toBeNull()
  })

  it('render a grant the IdP resolved without a client adapter digest and flag an untested version', async () => {
    const { gitUntested, gitPush } = await buildCardFixtures()
    expect(gitUntested.card!.registry?.title.en).toBe('Push feature/rebase to origin')
    expect(gitUntested.card!.program).toEqual({ sha256: UNTESTED_GIT_SHA256, version_tested: false })
    expect(gitPush.card!.program).toBeNull()

    // The card follows the IdP's current registry entry, not a digest recorded at request time.
    const request = await idpResolvedRequest({ name: 'git', sha256: UNTESTED_GIT_SHA256 }, pushArgv.slice(1))
    const changed = async (cliId: string) => ({ ...(await getShape(cliId))!, digest: 'SHA-256:newer-adapter' })
    expect((await registryCard({ ...request, execution_context: { ...request.execution_context!, adapter_digest: 'SHA-256:stale' } }, changed))?.title.en).toBe('Push feature/rebase to origin')
    // Still re-derived from the argv: a forged command cannot borrow the meaning.
    expect(await registryCard({ ...request, command: [...request.command!.slice(0, -1), 'main'] }, getShape)).toBeNull()

    const [unknownProgram] = await withGrantCards([{ id: 'g', status: 'pending', created_at: 0, request: await idpResolvedRequest({ name: 'acme', sha256: UNTESTED_GIT_SHA256 }, ['deploy']) }], { getShape, findUser })
    expect(unknownProgram!.card.program).toEqual({ sha256: UNTESTED_GIT_SHA256, version_tested: null })
  })

  // After an adapter change: UPDATE_GRANT_CARD_FIXTURES=1 pnpm vitest run test/grant-card.test.ts
  it('browser fixtures equal the rendering of the registry adapters', async () => {
    const file = join(__dirname, 'fixtures/grant-cards.json')
    const built = await buildCardFixtures()
    if (process.env.UPDATE_GRANT_CARD_FIXTURES) writeFileSync(file, `${JSON.stringify(built, null, 2)}\n`)
    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual(JSON.parse(JSON.stringify(built)))
  })
})
