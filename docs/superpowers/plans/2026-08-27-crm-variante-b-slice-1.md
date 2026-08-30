# CRM Variante B — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After login the user works in Variante-B-Shell (Rail · Liste · Detail): Vorgänge in drei festen Phasen, Stufe per Pipeline-Track, Historie/Notizen, ⌘K-Suche, Kontakte in der Shell. Kein Kanban, keine editierbaren Stufen.

**Architecture:** Domain logic lives in `apps/openape-crm/shared/` (no DB). APIs keep `/api/deals` (Vorgang = `deals` row) and add `phase` + `stufe`. Boot plugin migrates existing deals from `pipeline_stages.outcome`. UI is one Fokus-layout; rail panes are routes that share the layout.

**Tech Stack:** Nuxt 4, Vue 3, Vitest, happy-dom, Drizzle + LibSQL, @nuxt/ui 4, Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-08-27-crm-variante-b-design.md`

## Global Constraints

- UI-Tokens 1:1 Demo: `--bg:#0c0e13`, `--panel:#12151c`, `--accent:#7c6cff`. No emerald Kanban.
- Pipelines are code in `shared/pipelines.ts`, never a table.
- Table `deals` stays the Vorgang. English schema, German UI.
- Endmarker: `gewonnen` → phase `kunde`, stufe `onboarding`; `konvertiert` → phase `deal`, stufe `inbound`.
- Existing deals migrate to phase `deal`; outcome `open`→`inbound`, `won`→`gewonnen`, `lost`→`verloren`. Won deals do **not** move to Kunde.
- `requireCaller` + `requireRole` on every authenticated handler. Never trust `workspace_id` as auth.
- Tests: `pnpm --filter @openape-crm/app test`. No production code before a failing test.
- Do not commit unless the user asks.

## Follow-up (not this plan)

- Slice 2: Katalog, Verträge, Angebots-Wizard, Signatur-Stub.
- Slice 3: Graph — ein O365-Konto für Inbox, Send, Termine, OneDrive.
- Slice 4: Aufgaben.

---

### Task 1: Pipelines + Endmarker + Migration mapping

**Files:**
- Create: `apps/openape-crm/shared/pipelines.ts`
- Create: `apps/openape-crm/tests/pipelines.test.ts`
- Leave: `apps/openape-crm/shared/stages.ts` until Task 6 (stage APIs gone).

**Interfaces:**
- Consumes: nothing
- Produces:

```ts
export type Phase = 'lead' | 'deal' | 'kunde'
export interface Stufe {
  id: string
  label: string
  endmarker?: Phase
  endstufe?: boolean
}
export const PIPELINES: Record<Phase, { label: string, stufen: readonly Stufe[] }>
export function isPhase(value: unknown): value is Phase
export function stufe(phase: Phase, id: string): Stufe | undefined
export function setzeStufe(
  vorgang: { phase: Phase, stufe: string },
  stufeId: string,
): { phase: Phase, stufe: string, konvertiert: boolean, logTitle?: string, logText?: string }
export function migrateFromOutcome(outcome: 'open' | 'won' | 'lost'): { phase: 'deal', stufe: string }
export function groupByStufe<T extends { stufe: string }>(
  items: T[],
  phase: Phase,
): { stufe: Stufe, items: T[] }[]
```

- [ ] **Step 1: Write the failing test**

```ts
// apps/openape-crm/tests/pipelines.test.ts
import { describe, expect, it } from 'vitest'
import { groupByStufe, migrateFromOutcome, PIPELINES, setzeStufe, stufe } from '../shared/pipelines'

describe('PIPELINES', () => {
  it('has three phases with the demo stage keys', () => {
    expect(PIPELINES.lead.stufen.map(s => s.id)).toEqual(
      ['kalt', 'warm', 'kontaktiert', 'konvertiert', 'disqualifiziert', 'blacklist'],
    )
    expect(PIPELINES.deal.stufen.map(s => s.id)).toEqual(
      ['inbound', 'termin', 'demo', 'followup', 'angebot', 'gewonnen', 'spaet', 'verloren'],
    )
    expect(PIPELINES.kunde.stufen.map(s => s.id)).toEqual(
      ['onboarding', 'zahlend', 'abwehr', 'gekuendigt'],
    )
  })

  it('marks conversion stages as endmarkers', () => {
    expect(stufe('lead', 'konvertiert')?.endmarker).toBe('deal')
    expect(stufe('deal', 'gewonnen')?.endmarker).toBe('kunde')
  })
})

describe('setzeStufe', () => {
  it('moves a deal onto a normal stage in the same phase', () => {
    expect(setzeStufe({ phase: 'deal', stufe: 'inbound' }, 'demo')).toEqual({
      phase: 'deal', stufe: 'demo', konvertiert: false,
    })
  })

  it('converts through an endmarker onto the first stage of the next phase', () => {
    const r = setzeStufe({ phase: 'deal', stufe: 'angebot' }, 'gewonnen')
    expect(r.konvertiert).toBe(true)
    expect(r.phase).toBe('kunde')
    expect(r.stufe).toBe('onboarding')
    expect(r.logTitle).toContain('Kunde')
  })

  it('does not convert a normal kunde stage', () => {
    expect(setzeStufe({ phase: 'kunde', stufe: 'onboarding' }, 'zahlend').konvertiert).toBe(false)
  })
})

describe('migrateFromOutcome', () => {
  it('maps old board outcomes onto deal stages without jumping to kunde', () => {
    expect(migrateFromOutcome('open')).toEqual({ phase: 'deal', stufe: 'inbound' })
    expect(migrateFromOutcome('won')).toEqual({ phase: 'deal', stufe: 'gewonnen' })
    expect(migrateFromOutcome('lost')).toEqual({ phase: 'deal', stufe: 'verloren' })
  })
})

describe('groupByStufe', () => {
  it('groups items under the phase stages and skips empty groups', () => {
    const groups = groupByStufe(
      [{ id: 'a', stufe: 'demo' }, { id: 'b', stufe: 'demo' }, { id: 'c', stufe: 'inbound' }],
      'deal',
    )
    expect(groups.map(g => [g.stufe.id, g.items.map(i => i.id)])).toEqual([
      ['inbound', ['c']],
      ['demo', ['a', 'b']],
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @openape-crm/app test tests/pipelines.test.ts`

Expected: FAIL — cannot find module `../shared/pipelines`

- [ ] **Step 3: Write minimal implementation**

Port labels and keys from `apps/openape-crm/demo/data.js` `PIPELINES`. `setzeStufe` looks up the target Stufe in the current phase; if `endmarker`, set `phase` to that value and `stufe` to `PIPELINES[ziel].stufen[0].id`, plus log strings matching the demo (`Automatisch in Phase „…“ überführt`). If the stufeId is unknown, throw `Error('unknown stufe')`. `groupByStufe` walks `PIPELINES[phase].stufen` and omits empty groups.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @openape-crm/app test tests/pipelines.test.ts`

Expected: PASS

---

### Task 2: Suche

**Files:**
- Create: `apps/openape-crm/shared/search.ts`
- Create: `apps/openape-crm/tests/search.test.ts`

**Interfaces:**
- Consumes: `PIPELINES`, `stufe` from Task 1
- Produces:

```ts
export type SearchHit = { typ: 'Vorgang' | 'Person' | 'Firma', id: string, label: string, sub: string }
export function suche(q: string, data: {
  vorgaenge: { id: string, titel: string, phase: Phase, stufe: string, firma: string, personen: string[], emails: string[], historie: string[] }[]
  personen: { id: string, name: string, email: string }[]
  firmen: { id: string, name: string, ort: string }[]
}): SearchHit[]
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { suche } from '../shared/search'

const data = {
  vorgaenge: [{
    id: 'v1', titel: 'Kepler Labs – Plattform', phase: 'kunde' as const, stufe: 'zahlend',
    firma: 'Kepler Labs GmbH', personen: ['Julia Pfeiffer'], emails: ['julia@keplerlabs.io'],
    historie: ['Interesse an Dokumentensafe revisionssicher'],
  }],
  personen: [{ id: 'k6', name: 'Julia Pfeiffer', email: 'julia@keplerlabs.io' }],
  firmen: [{ id: 'f5', name: 'Kepler Labs GmbH', ort: 'Wien' }],
}

describe('suche', () => {
  it('returns nothing for blank query', () => {
    expect(suche('  ', data)).toEqual([])
  })

  it('finds a firm by name', () => {
    expect(suche('kepler', data).some(t => t.typ === 'Firma' && t.id === 'f5')).toBe(true)
  })

  it('finds a vorgang via historie full text', () => {
    expect(suche('revisionssicher', data).some(t => t.typ === 'Vorgang' && t.id === 'v1')).toBe(true)
  })

  it('caps at 12 hits', () => {
    const many = {
      vorgaenge: [],
      personen: [],
      firmen: Array.from({ length: 20 }, (_, i) => ({ id: `f${i}`, name: `Acme ${i}`, ort: 'Wien' })),
    }
    expect(suche('acme', many)).toHaveLength(12)
  })
})
```

- [ ] **Step 2: Run** `pnpm --filter @openape-crm/app test tests/search.test.ts` — expected FAIL missing module

- [ ] **Step 3: Implement** case-insensitive includes, order Vorgang then Person then Firma, slice 0..12. `sub` for Vorgang is `${PIPELINES[phase].label} · ${stufe(phase, stufeId).label}`.

- [ ] **Step 4: Run** — expected PASS

---

### Task 3: Schema + boot migration

**Files:**
- Modify: `apps/openape-crm/server/database/schema.ts`
- Modify: `apps/openape-crm/server/plugins/02.database.ts`
- Modify: `apps/openape-crm/server/api/workspaces/index.post.ts` — stop inserting `pipeline_stages`
- Test: `apps/openape-crm/tests/migrate-deals.test.ts` (pure function extracted from the plugin)

**Interfaces:**
- Consumes: `migrateFromOutcome`
- Produces: `deals.phase`, `deals.stufe`; `notes.kind`, `notes.title`; org address columns; `contact_emails`, `contact_phones`, `deal_contacts`. Helper:

```ts
export function dealMigrationPatch(outcome: 'open' | 'won' | 'lost'): { phase: 'deal', stufe: string }
```

This is `migrateFromOutcome` — do not duplicate. The test in this task covers the SQL-shaped mapping used by the plugin: given a list of `{ id, outcome }`, produce patches. Put `export function planDealMigration(rows: { id: string, outcome: 'open' | 'won' | 'lost' }[])` in `shared/pipelines.ts`.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from 'vitest'
import { planDealMigration } from '../shared/pipelines'

it('plans one patch per deal from the old stage outcome', () => {
  expect(planDealMigration([
    { id: 'a', outcome: 'open' },
    { id: 'b', outcome: 'won' },
  ])).toEqual([
    { id: 'a', phase: 'deal', stufe: 'inbound' },
    { id: 'b', phase: 'deal', stufe: 'gewonnen' },
  ])
})
```

- [ ] **Step 2: Run** — FAIL `planDealMigration` not exported

- [ ] **Step 3:** Add `planDealMigration` as a map over `migrateFromOutcome`. Then schema:

`deals`: add `phase` text notNull default `'deal'`, `stufe` text notNull default `'inbound'`. Keep `stage` column (SQLite) but stop using it in new code.

`notes`: add `kind` text notNull default `'notiz'`, `title` text notNull default `'Notiz'`.

`organizations`: add `website`, `address`, `postalCode`, `city`, `country` (all text nullable).

`contacts`: add `firstName`, `lastName`, `title`, `gender` nullable. Keep `name`. Keep `email`/`phone` until copied.

New tables `contact_emails` (`id`, `contactId`, `email`, `position`), `contact_phones`, `deal_contacts` (`dealId`, `contactId`, PK both).

In `02.database.ts`: `CREATE TABLE IF NOT EXISTS` for new tables; `ALTER TABLE … ADD COLUMN` wrapped so a repeat boot does not fail (try/catch or `PRAGMA table_info` check — same style as a comment in that file: explicit ALTER). Then:

1. For each deal whose `phase` is null/empty OR whose `stage` is not a known stufe of `phase`: look up `pipeline_stages.outcome` for `(workspace_id, stage)`; if missing treat as `open`; apply `migrateFromOutcome`; `UPDATE deals SET phase=?, stufe=?`.
2. Copy `deals.contact_id` into `deal_contacts` where missing.
3. Copy `contacts.email` / `phone` into child tables where missing.

Stop inserting `defaultStageRows` in workspace POST and in the unseeded-workspace loop.

- [ ] **Step 4: Run pipelines tests + typecheck** `pnpm --filter @openape-crm/app test tests/pipelines.test.ts` PASS. `pnpm --filter @openape-crm/app typecheck` may still fail until APIs catch up — allowed until Task 4.

---

### Task 4: Deal APIs speak phase + stufe

**Files:**
- Modify: `apps/openape-crm/server/utils/stages.ts` — replace `requireStage` usage; add `apps/openape-crm/server/utils/pipelines.ts` with `parsePhaseStufe(phase, stufe)` that throws `createProblemError({ status: 400, title: 'unknown stufe' })` if `stufe(phase, id)` is missing. `firstStufe('lead')` → `{ phase: 'lead', stufe: 'kalt' }` for new deals (demo: new work starts as lead). Spec: new Vorgang without phase → `lead`/`kalt`.
- Modify: `apps/openape-crm/server/api/deals/index.get.ts` — select `phase`, `stufe`; join `deal_contacts` + contacts for `people: { id, name }[]`; keep `contact_id` as first person for CLI compatibility this slice.
- Modify: `apps/openape-crm/server/api/deals/index.post.ts` — body `phase?`, `stufe?`; default lead/kalt; write `phase`/`stufe`; still write `stage = stufe` so old column is not null.
- Modify: `apps/openape-crm/server/api/deals/[id].patch.ts` — if `stufe` (and optional `phase`) provided, run `setzeStufe` on current row then persist; if converted, append a note kind `notiz` with `logTitle`/`logText`. Reject unknown stufe 400.
- Modify: `apps/openape-crm/server/api/deals/reorder.post.ts` — filter by `stufe` instead of `stage` (`body.stage` still accepted as alias for `stufe`).
- Modify: `apps/openape-crm/app/utils/board.ts` — extend `Deal` with `phase`, `stufe`, `people`. Keep `formatEuro`, `NO_SELECTION`. `buildColumns` unused by UI after Task 7; leave until Task 8 deletes kanban tests.
- Test: `apps/openape-crm/tests/setze-stufe-api.test.ts` — unit-test a helper `applyStufePatch(deal, stufeId)` in `server/utils/pipelines.ts` so we do not boot Nitro in vitest.

**Interfaces:**
- Produces: `applyStufePatch(deal: { phase: Phase, stufe: string }, stufeId: string)` → `{ fields: { phase, stufe, closedAt: number | null }, log?: { title: string, body: string } }`. `closedAt` set when the resulting stufe has `endstufe: true`, else null if moving to a non-endstufe.

- [ ] **Step 1: Failing test** for `applyStufePatch` (endmarker writes kunde/onboarding and a log; `verloren` sets closedAt; `inbound` clears closedAt).

- [ ] **Step 2: Run** FAIL

- [ ] **Step 3: Implement helper + wire APIs**

GET response shape:

```ts
{
  id, title, value_cents, phase, stufe, position,
  contact_id, contact_name, org_id, org_name,
  people: { id: string, name: string }[],
  created_at, closed_at
}
```

- [ ] **Step 4: Run** `pnpm --filter @openape-crm/app test` — board tests still use `stage`; update `Deal` factory in `tests/board.test.ts` to include `phase`/`stufe` so TypeScript compiles. Kanban tests may stay until Task 8.

---

### Task 5: Historie fields on notes

**Files:**
- Modify: `apps/openape-crm/server/api/deals/[id]/notes.get.ts` — return `kind`, `title`, `body`, `author_email`, `created_at`
- Modify: `apps/openape-crm/server/api/deals/[id]/notes.post.ts` — body `{ body, title?, kind? }`; default kind `notiz`, title `Notiz`; allowed kinds `mail|notiz|aufgabe|termin|dokument`
- Test: `apps/openape-crm/tests/note-kind.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { parseNoteKind, parseNoteTitle } from '../server/utils/notes'

it('defaults to notiz', () => {
  expect(parseNoteKind(undefined)).toBe('notiz')
  expect(parseNoteTitle(undefined)).toBe('Notiz')
})

it('rejects unknown kinds', () => {
  expect(() => parseNoteKind('foto')).toThrow()
})
```

`parseNoteKind` throws via `createProblemError` — in vitest that is an H3 error; assert `e.statusCode === 400` or catch and check `statusMessage`. If `createProblemError` is awkward in unit tests, throw a small `Error('unknown kind')` and map in the handler. Prefer: return null and let the handler throw problem. Simplest: `export const NOTE_KINDS = [...] as const` + `export function isNoteKind(v: unknown): v is NoteKind`.

- [ ] Implement `server/utils/notes.ts` + wire POST/GET
- [ ] Run tests PASS

---

### Task 6: Remove editable stages

**Files:**
- Delete: `apps/openape-crm/server/api/stages/index.get.ts`, `index.post.ts`, `[key].patch.ts`, `[key].delete.ts`
- Delete: `apps/openape-crm/app/components/StageHeader.vue`, `BoardColumn.vue`, `DealCard.vue`
- Delete: `apps/openape-crm/tests/stage-header.test.ts`, `tests/deal-card.test.ts`
- Modify: `apps/openape-crm/tests/board.test.ts` — delete `buildColumns` / `dropInto` describes; keep `formatEuro` and selection sentinel tests
- Modify: `apps/openape-crm/app/utils/board.ts` — delete `buildColumns`, `dropInto`, `Column`
- Modify: `packages/ape-crm/src/commands/deals.ts` — `--phase`, `--stufe` instead of `--stage`; `move` positional is stufe key; print `phase/stufe`
- Modify: `packages/ape-crm` stages command — delete or replace with a static list from shared (copy keys, do not import app shared from the package: duplicate the three phase labels in the CLI help string, or print from a tiny duplicated const). Duplicate `PHASES` keys in the CLI file as documentation, not a new package.
- Modify: `apps/openape-crm/nuxt.config.ts` manifest grants — drop stage paths if listed

- [ ] **Step 1:** Rewrite `tests/board.test.ts` so it no longer imports `buildColumns`. Run `pnpm --filter @openape-crm/app test` — expected FAIL if DealCard tests still import deleted files after deletion. Delete those tests first, then delete components, then run — all remaining tests PASS.
- [ ] **Step 2:** CLI: `packages/ape-crm` `deals move <id> <stufe>` sends `{ stufe }`. Filter `deals list --phase deal`.

---

### Task 7: Fokus theme + layout

**Files:**
- Modify: `apps/openape-crm/app/assets/main.css` — `:root` tokens from `demo/variante-b-fokus.html`
- Modify: `apps/openape-crm/app/app.config.ts` — `primary: 'violet'`
- Modify: `apps/openape-crm/app/layouts/default.vue` — three-column shell
- Modify: `apps/openape-crm/app/app.vue` — theme-color `#0c0e13`
- Create: `apps/openape-crm/app/components/AppRail.vue`
- Test: `apps/openape-crm/tests/app-rail.test.ts` happy-dom — rail shows Vorgänge, Aufgaben, Support, Kontakte, Katalog; Support has a dot slot when `unread > 0`

Visual: copy structure from demo — `.app` grid `52px 300px minmax(0,1fr)`, rail `#090b0f`, 34px icon buttons, accent-soft for `.on`. Use Lucide icons via `UIcon` (`i-lucide-panel-left`, `i-lucide-check`, `i-lucide-mail`, `i-lucide-contact`, `i-lucide-list`, `i-lucide-search`). Do not invent a new palette.

Layout slot: left AppRail, middle `<slot name="pane">` or a single default slot where pages render pane+detail. Pages own pane+detail; layout only provides rail + full-height background.

Empty panes (Aufgaben, Support, Katalog) render a muted “Kommt in der nächsten Scheibe” line — do not fake data.

- [ ] Write rail test, watch FAIL, implement, PASS
- [ ] Wire layout; login still `layout: false`

---

### Task 8: Vorgänge page (list + track + detail)

**Files:**
- Create: `apps/openape-crm/app/pages/vorgaenge.vue`
- Create: `apps/openape-crm/app/components/DealList.vue`
- Create: `apps/openape-crm/app/components/PipelineTrack.vue`
- Create: `apps/openape-crm/app/components/DealDetail.vue`
- Modify: `apps/openape-crm/app/pages/board.vue` — `navigateTo('/vorgaenge', { replace: true })` only
- Modify: `apps/openape-crm/app/pages/index.vue` — after login go to `/vorgaenge`
- Test: `apps/openape-crm/tests/pipeline-track.test.ts`, `tests/deal-list.test.ts`

PipelineTrack: buttons for `PIPELINES[phase].stufen`; class `on` for current, `done` for earlier index, `mark` if `endmarker`. Emit `select` with stufe id. 8 buttons on deal phase.

DealList: phase segment Lead/Deal/Kunde; groups from `groupByStufe`; item shows `org_name` (or title) and first person. Emit `open`.

DealDetail: h1 org/title, phase pill, track, historie list, note input. Mail/Termin/Angebot buttons visible but disabled with title “Kommt mit Microsoft / Slice 2” — no silent no-op.

- [ ] Track test: mount with phase `deal` stufe `demo` → 8 buttons, `Demo durchgeführt` has class containing `on`, `Inbound` is `done`, `Gewonnen` has `mark`. Click `followup` emits `followup`.
- [ ] List test: two deals in `angebot` and `inbound` → both group headers visible, selected id has `on`.
- [ ] Implement components + page: load deals/contacts/orgs/notes like current `board.vue`, without stage editor modals.

---

### Task 9: Command palette

**Files:**
- Create: `apps/openape-crm/app/components/CommandPalette.vue`
- Modify: layout to open on ⌘/Ctrl+K
- Test: `apps/openape-crm/tests/command-palette.test.ts` — typing `kepler` with stub data shows a Firma hit; empty query shows “Tippen zum Suchen”

Uses `suche()` from Task 2. Selecting a Vorgang `$router.push({ path: '/vorgaenge', query: { phase, id } })`. Person/Firma: find a vorgang in the loaded list with that person/org; else toast “Kein Vorgang zu diesem Treffer” via `useToast()`.

---

### Task 10: Kontakte pane in the shell

**Files:**
- Modify: `apps/openape-crm/app/pages/contacts.vue` — render inside Fokus layout (list of firms/people, no `max-w-7xl` board chrome)
- AppRail link `/kontakte` — add route redirect `contacts.vue` path: either rename page to `kontakte.vue` and redirect `/contacts` → `/kontakte`, or keep `/contacts`. Spec says `/kontakte`. Create `app/pages/kontakte.vue` (move logic), `contacts.vue` redirects.

Create-firm/create-person forms stay. Detail: clicking a firm with a deal goes to `/vorgaenge?id=`.

---

### Task 11: Workspace in user menu + leftovers

**Files:**
- Modify: `AppRail.vue` — user button opens menu: workspace select, link `/workspace`, later “Microsoft verbinden” disabled.
- Modify: `app/pages/docs/*` — leave as-is (own pages, default layout still has rail; acceptable).
- Modify: `apps/docs/content/5.apps/10.crm.md` only if it claims Kanban as the only UI — one paragraph: Pipeline is now Fokus master-detail, three phases.

Proof for Slice 1:

```
pnpm --filter @openape-crm/app test
pnpm --filter @openape-crm/app typecheck
```

Manual: `pnpm --filter @openape-crm/app dev`, login, `/vorgaenge` shows rail+list+detail, switching Lead/Deal/Kunde, clicking a stufe on the track persists after reload, ⌘K finds a firm, `/board` redirects.

---

## Spec coverage (self-review)

| Spec item | Task |
|-----------|------|
| Shell rail/list/detail, tokens, routes `/vorgaenge` `/board`→redirect | 7, 8 |
| Fixed pipelines + endmarker | 1, 4 |
| Deal migration by outcome | 1, 3 |
| Historie kinds | 5 |
| Firma address / person split / n:m | 3 (schema); contacts UI 10 (address fields in form if columns exist — show if present, editing website/address in firm form) |
| ⌘K | 2, 9 |
| Drop stage APIs / Kanban | 6, 8 |
| CLI phase/stufe | 6 |
| Empty Aufgaben/Support/Katalog | 7 |
| Graph, Verträge, OneDrive, Aufgaben | follow-up plans |

## E2E (Slice 1)

1. `pnpm --filter @openape-crm/app test` — 0 fail
2. `pnpm --filter @openape-crm/app typecheck` — 0 fail
3. Dev server port 3024: login → Vorgänge, Track has 8 deal stages, note saves, reload keeps stufe, `/board` → `/vorgaenge`
