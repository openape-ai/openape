// The generic grant card (issue 1473): registry meaning only from adapters in
// the IdP's shapes table, matched by adapter digest and re-derived from the
// grant's own argv. Requester context leads the card, while bound authority
// stays visible and the complete technical description remains inspectable.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { OpenApeGrant } from '@openape/core'
import { computeArgvHash } from '@openape/grants'
import { describe, expect, it, vi } from 'vitest'
import { bindsExactCommand, registryCard, withGrantCards } from '../src/runtime/server/utils/grant-card'
import { formatGrantDuration, grantBindingLine, grantScope, grantScopeNote, grantValidity, requesterHeadline } from '../src/runtime/utils/grant-card'
import type { GrantWithCard } from '../src/runtime/utils/grant-card'
import { buildCardFixtures, findUser, getShape, gitAdapter, graphGateArgv, idpResolvedRequest, POD_ID, podArgv, podRuntimeAdapter, pushArgv, shapedRequest, UNTESTED_GIT_SHA256 } from './helpers/grant-card-fixtures'

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

  it('verify that an approval binds nothing but the exact command, and fail closed otherwise', async () => {
    const { gitPush, gitUntested, podRun, graphGate } = await buildCardFixtures()
    const gate = graphGate.request
    const [detail] = gate.authorization_details!

    // A command no adapter describes: its exact-only detail and permission name the hash of exactly this argv.
    expect(gate.permissions).toEqual([`pods-graph-gate.cli[name=pods-graph-gate].argv[hash=${await computeArgvHash(graphGateArgv)}]#exec`])
    expect(await bindsExactCommand(gate)).toBe(true)
    expect(await bindsExactCommand({ ...gate, permissions: [] })).toBe(true)
    // A plain command without permissions is bound by its command hash; its exact permission alone is too.
    const plain = { requester: 'agent@example.com', target_host: 'macmini', audience: 'escapes', command: ['ls', '-la'] }
    expect(await bindsExactCommand(plain)).toBe(true)
    expect(await bindsExactCommand({ ...plain, permissions: [`ls.cli[name=ls].argv[hash=${await computeArgvHash(['ls', '-la'])}]#exec`] })).toBe(true)

    // An additional broad permission.
    expect(await bindsExactCommand({ ...gate, permissions: [...gate.permissions!, 'pods.approval:b-gate'] })).toBe(false)
    expect(await bindsExactCommand({ ...plain, permissions: ['files.read'] })).toBe(false)
    // The Pods gate batch permission is not bound to the command (issue 1477 follow-up).
    expect(await bindsExactCommand({ ...gate, authorization_details: undefined, permissions: ['pods.approval:11111111-1111-4111-8111-111111111111'] })).toBe(false)
    // A detail of another type, or one that is not exact-only.
    expect(await bindsExactCommand({ ...gate, authorization_details: [detail!, { type: 'openape_grant', action: 'exec' }] })).toBe(false)
    expect(await bindsExactCommand({ ...gate, authorization_details: [{ ...detail!, constraints: {} } as typeof detail] })).toBe(false)
    // A command, argv or argv hash that differs from what the permission names.
    expect(await bindsExactCommand({ ...gate, command: [...graphGateArgv.slice(0, 2), '{}'] })).toBe(false)
    expect(await bindsExactCommand({ ...gate, execution_context: { argv: ['pods-graph-gate', 'approve'], argv_hash: 'SHA-256:00', adapter_id: 'x', adapter_version: 'x', adapter_digest: 'x', resolved_executable: 'x', context_bindings: {} } })).toBe(false)
    expect(await bindsExactCommand({ ...gate, permissions: ['pods-graph-gate.cli[name=pods-graph-gate].argv[hash=SHA-256:00]#exec'] })).toBe(false)
    // Structured grants, resolved by the requester or by the IdP, and requests without a command.
    expect(await bindsExactCommand(gitPush.request)).toBe(false)
    expect(await bindsExactCommand(gitUntested.request)).toBe(false)
    expect(await bindsExactCommand({ ...podRun.request, command: podArgv })).toBe(false)
    expect(await bindsExactCommand({ ...plain, command: [] })).toBe(false)
  })

  it('lead with safe requester context independently of the binding type', async () => {
    const { gitPush, unknown, graphGate } = await buildCardFixtures()
    const headline = (grant: GrantWithCard) => requesterHeadline(grant, grantBindingLine(grant, 'en'))

    expect(graphGate.card?.binds_exact_command).toBe(true)
    expect(headline(unknown)).toBe('Deploy the hotfix')
    expect(headline(graphGate)).toBe('Produktneuigkeiten für Oktober')
    expect(gitPush.card?.binds_exact_command).toBe(false)
    expect(headline(gitPush)).toBe('Read-only status check')
    expect(headline({ ...gitPush, card: { ...gitPush.card!, registry: null } })).toBe('Read-only status check')
    expect(headline({ ...graphGate, card: undefined })).toBe('Produktneuigkeiten für Oktober')
    expect(headline({ ...graphGate, card: { ...graphGate.card!, binds_exact_command: false } })).toBe('Produktneuigkeiten für Oktober')
  })

  it('formats requested durations exactly instead of rounding ninety minutes to two hours', async () => {
    const { unknown } = await buildCardFixtures()
    expect(formatGrantDuration(5400)).toBe('1 h 30 min')
    expect(formatGrantDuration(3661)).toBe('1 h 1 min 1 s')
    expect(grantValidity({ ...unknown, request: { ...unknown.request, grant_type: 'timed', duration: 5400 } }, 'de')).toBe('Befristet, 1 h 30 min')
  })

  it('never promotes a requested registry consequence into a bound-scope claim', async () => {
    const { gitPush } = await buildCardFixtures()
    const card = { ...gitPush, card: { ...gitPush.card!, registry: { ...gitPush.card!.registry!, allows: { de: 'Alle Dateien lesen', en: 'Read all files', requested: true as const }, does_not_allow: { de: 'Keine Änderungen', en: 'No writes', requested: true as const } } } }
    expect(grantScope(card, 'en')).not.toContain('Read all files')
    expect(grantScopeNote(card, 'en')).toBeNull()
    expect(grantBindingLine(card, 'en').text).toBe('Push feature/rebase to origin')
  })

  it('keeps plain permissions and delegation scopes visible without a registry card', async () => {
    const { unknown } = await buildCardFixtures()
    const plain = { ...unknown, card: { ...unknown.card!, binds_exact_command: false }, request: { ...unknown.request, authorization_details: undefined, permissions: ['files:read'] } }
    expect(grantScope(plain, 'en')).toContain('files:read')
    expect(grantScope(plain, 'en')).toContain(plain.request.target_host)
    const delegation = { ...plain, request: { ...plain.request, delegate: 'helper@example.test', scopes: ['grants:read'] } }
    expect(grantScope(delegation, 'en')).toContain('helper@example.test')
    expect(grantScope(delegation, 'en')).toContain('grants:read')
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
