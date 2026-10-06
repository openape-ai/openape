import type { Client } from '@libsql/client'
import type { PlansSnapshot } from '../server/utils/plans-migration'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@libsql/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrateReports } from '../server/database/migrate'
import { RECOVERY_MS } from '../shared/html-publication'
import { signPlansBridge, verifyPlansBridge } from '../shared/plans-bridge'
import { manageHtml, purgeHtml, readHtml, row } from '../server/utils/html-store'
import { applyPlansRollback, capturePlans, importPlans, plansSnapshotDigest, reconcilePlans, rollbackPlansSnapshot } from '../server/utils/plans-migration'
import { listPlans, readPlan, writePlan } from '../server/utils/plans-store'
import { acceptPlanInvite, mutateTeam, previewPlanInvite } from '../server/utils/plans-teams'
import { editRedirect } from '../server/middleware/report-pages'

const owner = { subject: 'owner@example.com', actor: 'owner@example.com' }
const editor = { subject: 'editor@example.com', actor: 'editor@example.com' }
const outsider = { subject: 'outsider@example.com', actor: 'outsider@example.com' }
const viewer = { subject: 'viewer@example.com', actor: 'viewer@example.com' }
const now = Date.now(); const seconds = Math.floor(now / 1000)
const secret = 'synthetic-test-secret-1429-at-least-32-characters'
const fixture: PlansSnapshot = {
  schema: 1,
  teams: [{ id: 'team', name: 'Example', description: null, created_by: owner.subject, created_at: seconds, archived_at: null }],
  team_members: [owner, editor, viewer].map((person, index) => ({ team_id: 'team', user_email: person.subject, role: ['owner', 'editor', 'viewer'][index]!, joined_at: seconds })),
  team_invites: [],
  plans: [{ id: 'plan', team_id: 'team', title: 'Migration', body_md: '# Source\n\n<div class="callout">Original source</div>\n<script>bad()</script>', status: 'active', owner_email: owner.subject, created_at: seconds, updated_at: seconds, updated_by: owner.subject, deleted_at: null }],
}
let client: Client; let directory: string
beforeEach(async () => { directory = mkdtempSync(join(tmpdir(), 'plans-migration-')); client = createClient({ url: `file:${join(directory, 'reports.db')}` }); await migrateReports(client) })
afterEach(() => { client.close(); rmSync(directory, { recursive: true }) })

describe('Plans single-store compatibility', () => {
  it('imports exact source and policy, reconciles repeatably, and never overwrites newer versions', async () => {
    expect(await importPlans(client, fixture, now)).toMatchObject({ imported: 1, replayed: false })
    const migrated = await readPlan(client, 'plan', editor, now)
    expect(migrated.result).toMatchObject({ id: 'plan', status: 'active', body_md: fixture.plans[0]!.body_md, version: 1, caller_role: 'editor' })
    expect(migrated.version.html).not.toContain('<script>bad()')
    expect((await readHtml(client, 'plan', viewer, undefined, now)).version.metadata).toContain('plans.status')
    await expect(readPlan(client, 'plan', outsider, now)).rejects.toMatchObject({ status: 404 })
    await expect(writePlan(client, viewer, { status: 'done', expected_version: 1 }, { id: 'plan' }, now)).rejects.toMatchObject({ status: 403 })
    await expect(writePlan(client, editor, { status: 'done' }, { id: 'plan' }, now)).rejects.toMatchObject({ status: 428, code: 'UPGRADE_REQUIRED' })
    await writePlan(client, editor, { body_md: '# Updated source', status: 'done', expected_version: 1 }, { id: 'plan' }, now + 1000)
    await expect(writePlan(client, editor, { status: 'draft', expected_version: 1 }, { id: 'plan' }, now + 1000)).rejects.toMatchObject({ status: 409 })
    expect(await importPlans(client, fixture, now + 2000)).toMatchObject({ imported: 0, replayed: true })
    expect(await reconcilePlans(client, fixture)).toMatchObject({ reconciled: true, changed: 1, differences: [] })
    expect((await readPlan(client, 'plan', owner, now + 2000)).result.body_md).toBe('# Updated source')
    const divergent = structuredClone(fixture); divergent.plans[0]!.body_md = 'Different baseline'
    await expect(importPlans(client, divergent)).rejects.toMatchObject({ status: 409 })
    const rollback = await rollbackPlansSnapshot(client, now + 2000)
    expect(rollback.plans[0]).toMatchObject({ body_md: '# Updated source', status: 'done', updated_by: editor.subject })
  })
  it('detects permission drift and applies a conflict-checked reverse migration to the legacy schema', async () => {
    await importPlans(client, fixture, now)
    const legacy = createClient({ url: `file:${join(directory, 'legacy.db')}` })
    try {
      for (const table of ['teams', 'team_members', 'team_invites']) {
        const definition = (await client.execute({ sql: 'SELECT sql FROM sqlite_master WHERE name=?', args: [table] })).rows[0]!
        await legacy.execute(String(definition.sql))
      }
      await legacy.execute('CREATE TABLE plans (id TEXT PRIMARY KEY,team_id TEXT,title TEXT,body_md TEXT,status TEXT,owner_email TEXT,created_at INTEGER,updated_at INTEGER,updated_by TEXT,deleted_at INTEGER)')
      const empty = await capturePlans(legacy)
      await applyPlansRollback(legacy, plansSnapshotDigest(empty), fixture)
      await writePlan(client, editor, { body_md: '# Preserved new source', status: 'done', expected_version: 1 }, { id: 'plan' }, now + 1000)
      const delta = await rollbackPlansSnapshot(client, now + 1000)
      expect(await applyPlansRollback(legacy, plansSnapshotDigest(fixture), delta)).toMatchObject({ plans: 1 })
      expect((await capturePlans(legacy)).plans[0]).toMatchObject({ body_md: '# Preserved new source', status: 'done' })
      await expect(applyPlansRollback(legacy, plansSnapshotDigest(fixture), delta)).rejects.toMatchObject({ status: 409 })
      await client.execute('UPDATE team_members SET role=\'editor\' WHERE user_email=\'viewer@example.com\'')
      expect(await reconcilePlans(client, fixture)).toMatchObject({ reconciled: false, differences: ['team_members: viewer@example.com: metadata or permission drift'] })
    }
    finally { legacy.close() }
  })
  it('applies lifetime denial to legacy reads, restores owner-only, and never resurrects purged imports', async () => {
    await importPlans(client, fixture, now)
    await manageHtml(client, 'plan', owner, 'retention', { lifetime: { expiresIn: '1m' }, expectedRetentionRevision: 1 }, now)
    await expect(readPlan(client, 'plan', owner, now + 60000)).rejects.toMatchObject({ status: 410 })
    expect(await listPlans(client, 'team', editor, now + 60000)).toEqual([])
    await manageHtml(client, 'plan', owner, 'restore', { lifetime: { permanent: true } }, now + 60001)
    await expect(readPlan(client, 'plan', editor, now + 60002)).rejects.toMatchObject({ status: 404 })
    expect((await readPlan(client, 'plan', owner, now + 60002)).result.version).toBe(1)
    await expect(rollbackPlansSnapshot(client, now + 60002)).rejects.toMatchObject({ status: 409 })
    await manageHtml(client, 'plan', owner, 'remove', { expectedVersion: 1 }, now + 70000)
    await purgeHtml(client, now + 70000 + RECOVERY_MS)
    expect(await importPlans(client, fixture)).toMatchObject({ replayed: true })
    await expect(readPlan(client, 'plan', owner)).rejects.toMatchObject({ status: 404 })
    expect(await reconcilePlans(client, fixture)).toMatchObject({ reconciled: true, purged: 1 })
    expect((await rollbackPlansSnapshot(client)).plans).toEqual([])
  })
  it('atomically limits invite uses and enforces membership revocation on all versions', async () => {
    await importPlans(client, fixture, now)
    const invite = await mutateTeam(client, owner, 'POST', ['team', 'invites'], { max_uses: 1, expires_in: '1h' }, false, secret, 'https://plans.example.test', now) as { token: string }
    expect(await previewPlanInvite(client, invite.token, secret, now)).toMatchObject({ uses_remaining: 1 })
    const newcomer = { subject: 'new@example.com', actor: 'new@example.com' }
    const attempts = await Promise.allSettled([acceptPlanInvite(client, invite.token, secret, outsider, now), acceptPlanInvite(client, invite.token, secret, newcomer, now)])
    expect(attempts.filter(attempt => attempt.status === 'fulfilled')).toHaveLength(1)
    const joined = attempts[0]!.status === 'fulfilled' ? outsider : newcomer
    expect(await acceptPlanInvite(client, invite.token, secret, joined, now)).toMatchObject({ already_member: true })
    await readPlan(client, 'plan', joined, now)
    await mutateTeam(client, owner, 'DELETE', ['team', 'members', joined.subject], {}, false, secret, '', now)
    await expect(readHtml(client, 'plan', joined, 1, now)).rejects.toMatchObject({ status: 404 })
    await expect(mutateTeam(client, owner, 'DELETE', ['team'], {}, false, secret, '', now)).rejects.toMatchObject({ status: 409 })
    expect(await mutateTeam(client, owner, 'DELETE', ['team'], {}, true, secret, '', now)).toMatchObject({ cascade_soft_deleted_plans: 1 })
    expect(await row(client, 'SELECT * FROM teams WHERE id=?', ['team'])).toBeUndefined()
    await expect(readPlan(client, 'plan', owner, now)).rejects.toMatchObject({ status: 410 })
  })
  it('preserves already-deleted orphan team references without creating membership', async () => {
    const input = structuredClone(fixture)
    input.plans.push({ ...input.plans[0]!, id: 'deleted-orphan', team_id: 'removed-team', deleted_at: seconds - 1 })
    expect(await importPlans(client, input, now)).toMatchObject({ imported: 2 })
    expect(await reconcilePlans(client, input)).toMatchObject({ reconciled: true })
    await expect(readPlan(client, 'deleted-orphan', owner, now)).rejects.toMatchObject({ status: 410 })
    expect(await row(client, 'SELECT * FROM teams WHERE id=?', ['removed-team'])).toBeUndefined()
    expect((await rollbackPlansSnapshot(client, now)).plans).toHaveLength(2)
  })
  it('binds compatibility assertions to identity, operation, bytes and a single use', async () => {
    const token = await signPlansBridge(secret, owner.subject, editor.actor, 'PATCH', '/plans/plan', '{"expected_version":1}')
    await expect(verifyPlansBridge(secret, token, 'PATCH', '/plans/other', '{"expected_version":1}')).rejects.toThrow('mismatch')
    await expect(verifyPlansBridge(secret, token, 'PATCH', '/plans/plan', '{"expected_version":2}')).rejects.toThrow('mismatch')
    expect(await verifyPlansBridge(secret, token, 'PATCH', '/plans/plan', '{"expected_version":1}')).toEqual({ subject: owner.subject, actor: editor.actor })
    await expect(verifyPlansBridge(secret, token, 'PATCH', '/plans/plan', '{"expected_version":1}')).rejects.toThrow('replay')
  })
})

describe('retired browser editor', () => {
  it('sends old edit links to the report, keeping an exact version and nothing else', () => {
    expect(editRedirect('/d/01M48ZPPY22PGEDKFX64H6YRKD/edit', '')).toBe('/d/01M48ZPPY22PGEDKFX64H6YRKD')
    expect(editRedirect('/d/legacy-plan-id/edit/', '?v=3')).toBe('/d/legacy-plan-id?v=3')
    expect(editRedirect('/d/plan/edit', '?v=0&next=https://evil.example')).toBe('/d/plan')
    for (const path of ['/d/plan', '/d//edit', '/d/%2F%2Fevil.example/edit', '/d/a/b/edit', '/x/d/plan/edit']) expect(editRedirect(path, '')).toBeNull()
  })
})
