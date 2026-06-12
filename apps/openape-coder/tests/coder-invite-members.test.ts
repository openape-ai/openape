// story: coder-invite-members
//
// All 7 criteria of stories/coder-invite-members.md.
//
// Store-level criteria (1, 2, 3, 6, 7) run against a real in-memory SQLite
// (drizzle + libsql), the same level coder-projects.test.ts uses:
//   schema  server/database/schema.ts   (project_members + invites + audit_log)
//   init    server/database/init.ts     → ensureCoderSchema(db)
//   members server/utils/members.ts     → createMembershipStore(db)
//   audit   server/utils/audit.ts       → createAuditLog(db)
// Endpoint criteria (4, 5) — admin-only and human-only enforcement — are pinned
// at handler level with the same global-stub pattern as coder-sign-in.test.ts.
//
// The UI flow (invite dialog, per-member permission switches) becomes a
// Story-Kit guide story in the green phase.

import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAuditLog } from '../server/utils/audit'
import { INVITE_RATE_LIMIT, createMembershipStore } from '../server/utils/members'
import { createProjectStore } from '../server/utils/projects'
import { ensureCoderSchema } from '../server/database/init'

const ALICE = 'alice@example.com'
const BOB = 'bob@example.com'
const PROJECT = 'p1'

async function freshDb() {
  const db = drizzle(createClient({ url: ':memory:' }))
  await ensureCoderSchema(db)
  return db
}

describe('membership store (issue #585)', () => {
  // story: coder-invite-members — criterion 1
  it('an invited email becomes a member of the project after accepting on sign-in', async () => {
    const members = createMembershipStore(await freshDb())
    await members.invite({ projectId: PROJECT, email: BOB, invitedBy: ALICE })
    expect(await members.getMembership(PROJECT, BOB)).toBeNull()

    const membership = await members.acceptInvite(PROJECT, BOB)
    expect(membership.role).toBe('member')
    expect(await members.getMembership(PROJECT, BOB)).not.toBeNull()
  })

  // story: coder-invite-members — criterion 2
  it('a fresh member is read-only until an admin unlocks a write capability one by one', async () => {
    const members = createMembershipStore(await freshDb())
    await members.invite({ projectId: PROJECT, email: BOB, invitedBy: ALICE })
    await members.acceptInvite(PROJECT, BOB)

    expect(await members.hasCapability(PROJECT, BOB, 'writeStories')).toBe(false)
    expect(await members.hasCapability(PROJECT, BOB, 'editScope')).toBe(false)

    await members.setCapability({ projectId: PROJECT, email: BOB, capability: 'writeStories', granted: true, actorEmail: ALICE })

    expect(await members.hasCapability(PROJECT, BOB, 'writeStories')).toBe(true)
    // unlocking one capability must not unlock the other
    expect(await members.hasCapability(PROJECT, BOB, 'editScope')).toBe(false)
  })

  // story: coder-invite-members — criterion 3
  it('a permission change takes effect at once and is recorded with author and time', async () => {
    const db = await freshDb()
    const members = createMembershipStore(db)
    const audit = createAuditLog(db)
    await members.invite({ projectId: PROJECT, email: BOB, invitedBy: ALICE })
    await members.acceptInvite(PROJECT, BOB)

    const before = Date.now()
    await members.setCapability({ projectId: PROJECT, email: BOB, capability: 'writeStories', granted: true, actorEmail: ALICE })
    expect(await members.hasCapability(PROJECT, BOB, 'writeStories')).toBe(true)

    const trail = await audit.list(PROJECT)
    const grant = trail.find(e => e.action === 'capability.grant' && e.subject === BOB)
    expect(grant).toBeTruthy()
    expect(grant?.actorEmail).toBe(ALICE)
    expect(grant?.at).toBeGreaterThanOrEqual(before)
  })

  // story: coder-invite-members — criterion 6
  it('inviting reveals nothing about whether the address already exists anywhere', async () => {
    const members = createMembershipStore(await freshDb())
    const known = await members.invite({ projectId: PROJECT, email: ALICE, invitedBy: ALICE })
    const stranger = await members.invite({ projectId: PROJECT, email: 'nobody@example.com', invitedBy: ALICE })

    // the acknowledgement carries no existence-revealing field that differs
    expect(Object.keys(known).sort()).toEqual(Object.keys(stranger).sort())
    expect(known.acceptedAt).toBeNull()
    expect(stranger.acceptedAt).toBeNull()
  })

  // story: coder-invite-members — criterion 7
  it('an inviter blasting more than the burst budget is throttled', async () => {
    const members = createMembershipStore(await freshDb())
    for (let i = 0; i < INVITE_RATE_LIMIT; i++) {
      await members.invite({ projectId: PROJECT, email: `inv${i}@example.com`, invitedBy: ALICE })
    }
    await expect(
      members.invite({ projectId: PROJECT, email: 'overflow@example.com', invitedBy: ALICE }),
    ).rejects.toThrow()
  })

  // story: coder-invite-members — criterion 8 (being added shows in the member's inbox)
  it('an accepted invite surfaces in the new member\'s inbox until they dismiss it', async () => {
    const db = await freshDb()
    const members = createMembershipStore(db)
    const projects = createProjectStore(db)
    const project = await projects.create({ name: 'Apollo', creatorEmail: ALICE })

    await members.invite({ projectId: project.id, email: BOB, invitedBy: ALICE })
    // before sign-in nothing is accepted yet → empty inbox
    expect(await members.listInbox(BOB)).toEqual([])

    await members.acceptPendingInvites(BOB)
    const inbox = await members.listInbox(BOB)
    expect(inbox).toHaveLength(1)
    expect(inbox[0]).toMatchObject({ projectId: project.id, projectName: 'Apollo', invitedBy: ALICE })

    await members.markInboxSeen(project.id, BOB)
    expect(await members.listInbox(BOB)).toEqual([])
  })

  // story: coder-invite-members — criterion 8 (no self-notification for the creator)
  it('creating a project does not put the creator into their own inbox', async () => {
    const db = await freshDb()
    const projects = createProjectStore(db)
    const members = createMembershipStore(db)
    await projects.create({ name: 'Apollo', creatorEmail: ALICE })
    expect(await members.listInbox(ALICE)).toEqual([])
  })
})

describe('invite + permission endpoints (issue #585)', () => {
  const requireHumanMock = vi.fn()
  const members = {
    invite: vi.fn(),
    acceptInvite: vi.fn(),
    getMembership: vi.fn(),
    hasCapability: vi.fn(),
    setCapability: vi.fn(),
  }

  beforeEach(() => {
    requireHumanMock.mockReset().mockResolvedValue({ email: ALICE, act: 'human' })
    for (const fn of Object.values(members)) fn.mockReset()
    members.getMembership.mockResolvedValue({ projectId: PROJECT, email: ALICE, role: 'admin', capabilities: [] })
    vi.stubGlobal('requireHuman', requireHumanMock)
    vi.stubGlobal('useMembershipStore', () => members)
    vi.stubGlobal('defineEventHandler', (fn: any) => fn)
    vi.stubGlobal('createError', (opts: any) => Object.assign(new Error(opts.statusMessage), opts))
    vi.stubGlobal('getRouterParam', (event: any, name: string) => event?.params?.[name])
    vi.stubGlobal('readBody', async (event: any) => event?.body)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function callForError(load: () => Promise<{ default: unknown }>, event: Record<string, unknown> = {}) {
    return (async () => {
      const handler = (await load()).default as (event: unknown) => Promise<unknown>
      return handler(event)
    })().then(() => null, (err: any) => err)
  }

  const invite = () => import('../server/api/projects/[id]/invites/index.post')
  const setCap = () => import('../server/api/projects/[id]/members/[email]/index.patch')

  // story: coder-invite-members — criterion 4
  it('a member (any capabilities) may neither invite nor change permissions', async () => {
    requireHumanMock.mockResolvedValue({ email: BOB, act: 'human' })
    members.getMembership.mockResolvedValue({ projectId: PROJECT, email: BOB, role: 'member', capabilities: ['writeStories', 'editScope'] })

    const inviteErr = await callForError(invite, { params: { id: PROJECT }, body: { email: 'x@example.com' } })
    expect(inviteErr?.statusCode).toBe(403)
    expect(members.invite).not.toHaveBeenCalled()

    const capErr = await callForError(setCap, { params: { id: PROJECT, email: BOB }, body: { capability: 'editScope', granted: true } })
    expect(capErr?.statusCode).toBe(403)
    expect(members.setCapability).not.toHaveBeenCalled()
  })

  // story: coder-invite-members — criterion 5
  it('an agent token (act != human) is rejected for inviting and permission changes', async () => {
    requireHumanMock.mockRejectedValue(Object.assign(new Error('Human session required'), { statusCode: 403 }))

    const inviteErr = await callForError(invite, { params: { id: PROJECT }, body: { email: 'x@example.com' } })
    expect(inviteErr?.statusCode).toBe(403)

    const capErr = await callForError(setCap, { params: { id: PROJECT, email: BOB }, body: { capability: 'editScope', granted: true } })
    expect(capErr?.statusCode).toBe(403)

    expect(members.invite).not.toHaveBeenCalled()
    expect(members.setCapability).not.toHaveBeenCalled()
  })
})
