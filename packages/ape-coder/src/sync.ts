// story: coder-repo-sync — red-phase contract (#585).
//
// Defines the `.ape-coder/config` schema, the repo story-file format (frontmatter
// ↔ service story records) and the client-side, two-way sync logic. The sync runs
// entirely from the CLI: it reads the bound project from `.ape-coder/config`, reads
// the local story files, fetches the service stories, diffs them per story via a
// content hash against the last-synced revision, and reports conflicts loudly —
// it never silently overwrites a side (Vision: "Sync-Konflikte sind laut statt
// still"). The service is never told the repo address, credentials, or any repo
// content beyond the story data itself (criterion 4).
//
// Every function throws until the green phase implements it — nothing here
// fulfils an acceptance criterion yet. The pure functions (parseConfig,
// parseStoryFile, hashStory, diffStories, planSync) are designed to be testable
// against in-memory representations of the repo side and the service side, with
// no filesystem or network.

import type { Story, StoryPatch, StoryStatus } from './coder-api'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CoderApi } from './coder-api'
import { CliError } from './errors'

// ---------------------------------------------------------------------------
// .ape-coder/config — binds a repo to exactly one project. Lives at the repo
// root under `.ape-coder/config` (TOML-ish key=value, parsed leniently). The
// config carries NO repo address and NO credentials — only the binding plus an
// optional folder for the story files. Criterion 4: the service never learns
// where the repo is, so nothing here is ever sent upstream.
// ---------------------------------------------------------------------------

export interface CoderConfig {
  /** The bound project's id. Required — a config without it is invalid (criterion 6). */
  projectId: string
  /** Service base URL (defaults to coder.openape.ai). Bound here so a repo pins its home. */
  coderUrl?: string
  /** Repo-relative folder holding the story files. Defaults to `.ape-coder/stories`. */
  storiesDir?: string
}

/**
 * Parses the raw `.ape-coder/config` text into a {@link CoderConfig}.
 * Throws a {@link CliError} with a human-readable message when the binding is
 * missing or malformed (criterion 6: "verständliche Meldung", never guess a target).
 */
export function parseConfig(raw: string): CoderConfig {
  const values = parseKeyValues(raw)
  const projectId = values.projectId
  if (!projectId) {
    throw new CliError(
      'No project binding found in `.ape-coder/config`. Add `projectId = "<id>"` so the sync knows which project this repo belongs to.',
    )
  }
  const config: CoderConfig = { projectId }
  if (values.coderUrl) config.coderUrl = values.coderUrl
  if (values.storiesDir) config.storiesDir = values.storiesDir
  return config
}

/**
 * Lenient TOML-ish `key = value` parser: ignores blank lines and `#` comments,
 * strips surrounding single/double quotes from values. Enough for the flat
 * binding config — no nested tables, no arrays.
 */
function parseKeyValues(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (key) out[key] = value
  }
  return out
}

// ---------------------------------------------------------------------------
// Repo story-file format. Each story is one Markdown file with YAML frontmatter
// whose fields map 1:1 to the service story record. `rev` is the revision the
// file was last synced from (the service story's content hash at pull time); it
// is how the diff tells "changed since last sync" from "unchanged" on each side.
// ---------------------------------------------------------------------------

export interface StoryFile {
  /** Stable story id (service id once known; locally-authored stories may start without one). */
  id: string | null
  /** Service content hash this file was last synced against (null = never synced / new local story). */
  rev: string | null
  title: string
  storySentence: string
  acceptanceCriteria: string
  repos: string[]
  links: string[]
  testReferences: string[]
  status: Story['status']
}

/**
 * Parses one repo story file (frontmatter + body) into a {@link StoryFile}.
 * Throws on malformed frontmatter so a broken file aborts loudly rather than
 * syncing partial data.
 */
const STATUSES: readonly StoryStatus[] = ['draft', 'consistent', 'approved', 'red', 'green', 'documented']

export function parseStoryFile(text: string): StoryFile {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) {
    throw new CliError('Malformed story file: missing `---` frontmatter block.')
  }
  const front = parseFrontmatter(match[1]!)
  const body = (match[2] ?? '').trim()

  const status = String(front.status ?? 'draft')
  if (!STATUSES.includes(status as StoryStatus)) {
    throw new CliError(`Malformed story file: unknown status "${status}".`)
  }

  return {
    id: stringOrNull(front.id),
    rev: stringOrNull(front.rev),
    title: String(front.title ?? ''),
    storySentence: String(front.storySentence ?? ''),
    acceptanceCriteria: body,
    repos: toStringList(front.repos),
    links: toStringList(front.links),
    testReferences: toStringList(front.testReferences),
    status: status as StoryStatus,
  }
}

/** Serializes a {@link StoryFile} back to frontmatter+body text for writing into the repo. */
export function serializeStoryFile(file: StoryFile): string {
  const lines = ['---']
  if (file.id !== null) lines.push(`id: ${file.id}`)
  if (file.rev !== null) lines.push(`rev: ${file.rev}`)
  lines.push(`title: ${quote(file.title)}`)
  lines.push(`storySentence: ${quote(file.storySentence)}`)
  lines.push(`status: ${file.status}`)
  lines.push(`repos: ${serializeList(file.repos)}`)
  lines.push(`links: ${serializeList(file.links)}`)
  lines.push(`testReferences: ${serializeList(file.testReferences)}`)
  lines.push('---', '', file.acceptanceCriteria, '')
  return lines.join('\n')
}

/**
 * Tiny flat-YAML frontmatter parser for the known story fields: `key: value`
 * lines plus inline `[a, b]` arrays. No nesting — story files are flat by design.
 */
function parseFrontmatter(block: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const line of block.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const key = line.slice(0, colon).trim()
    const raw = line.slice(colon + 1).trim()
    out[key] = parseScalarOrList(raw)
  }
  return out
}

function parseScalarOrList(raw: string): unknown {
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1).trim()
    if (!inner) return []
    return inner.split(',').map(s => unquote(s.trim()))
  }
  return unquote(raw)
}

function unquote(value: string): string {
  return value.replace(/^["']|["']$/g, '')
}

function stringOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  return String(value)
}

function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (value === null || value === undefined || value === '') return []
  return [String(value)]
}

function quote(value: string): string {
  return JSON.stringify(value)
}

function serializeList(items: string[]): string {
  return `[${items.map(quote).join(', ')}]`
}

// ---------------------------------------------------------------------------
// Content hash + diff. The hash covers only the syncable story fields (title,
// sentence, criteria, repos, links, testReferences, status) so a hash match on
// both sides means "no change". Comparing each side's current hash to the shared
// `rev` baseline yields, per story, one of: unchanged / push / pull / conflict.
// ---------------------------------------------------------------------------

/** The story fields that participate in the sync (and thus in the content hash). */
export type SyncableStory = Pick<Story,
  'title' | 'storySentence' | 'acceptanceCriteria' | 'repos' | 'links' | 'testReferences' | 'status'
>

/**
 * Stable content hash of the syncable fields. Two stories with equal syncable
 * content MUST hash equal regardless of field order or object identity.
 */
export function hashStory(story: SyncableStory): string {
  const canonical = JSON.stringify({
    title: story.title,
    storySentence: story.storySentence,
    acceptanceCriteria: story.acceptanceCriteria,
    repos: story.repos,
    links: story.links,
    testReferences: story.testReferences,
    status: story.status,
  })
  return createHash('sha256').update(canonical).digest('hex')
}

function syncable(s: SyncableStory): SyncableStory {
  return {
    title: s.title,
    storySentence: s.storySentence,
    acceptanceCriteria: s.acceptanceCriteria,
    repos: s.repos,
    links: s.links,
    testReferences: s.testReferences,
    status: s.status,
  }
}

/** What the sync wants to do for a single story after diffing both sides against `rev`. */
export type SyncAction = 'unchanged' | 'push' | 'pull' | 'create-remote' | 'create-local' | 'conflict'

export interface StoryDiff {
  /** Stable story id, or a repo-local placeholder for a brand-new local story. */
  id: string
  action: SyncAction
  /** Repo side, if present. */
  local: StoryFile | null
  /** Service side, if present. */
  remote: Story | null
}

/**
 * Diffs the repo stories against the service stories, pairing by id and using each
 * file's `rev` baseline:
 *   - changed on neither side                → 'unchanged'
 *   - changed only locally                   → 'push'
 *   - changed only remotely                  → 'pull'
 *   - changed on BOTH since `rev`            → 'conflict' (both states retained, criterion 2)
 *   - exists only locally (no service id)    → 'create-remote'
 *   - exists only remotely (not in repo)     → 'create-local'
 */
export function diffStories(local: StoryFile[], remote: Story[]): StoryDiff[] {
  const remoteById = new Map(remote.map(s => [s.id, s]))
  const diffs: StoryDiff[] = []
  const seenRemote = new Set<string>()

  for (const file of local) {
    // A local story without a service id has never been pushed → create remotely.
    if (file.id === null) {
      diffs.push({ id: repoLocalId(file), action: 'create-remote', local: file, remote: null })
      continue
    }
    const remoteStory = remoteById.get(file.id)
    if (!remoteStory) {
      // Bound id but gone from the service → re-create it remotely.
      diffs.push({ id: file.id, action: 'create-remote', local: file, remote: null })
      continue
    }
    seenRemote.add(file.id)

    const baseline = file.rev
    const localChanged = baseline === null || hashStory(syncable(file)) !== baseline
    const remoteChanged = baseline === null || hashStory(syncable(remoteStory)) !== baseline

    let action: SyncAction
    if (localChanged && remoteChanged) action = 'conflict'
    else if (localChanged) action = 'push'
    else if (remoteChanged) action = 'pull'
    else action = 'unchanged'

    diffs.push({ id: file.id, action, local: file, remote: remoteStory })
  }

  // Stories that exist only on the service → pull into the repo as new files.
  for (const remoteStory of remote) {
    if (seenRemote.has(remoteStory.id)) continue
    diffs.push({ id: remoteStory.id, action: 'create-local', local: null, remote: remoteStory })
  }

  return diffs
}

/** Stable placeholder id for a brand-new local story that has no service id yet. */
function repoLocalId(file: StoryFile): string {
  return `local:${hashStory(syncable(file)).slice(0, 12)}`
}

// ---------------------------------------------------------------------------
// Sync planning. Turns the diff into a concrete plan, honoring the caller's
// write permission and the per-story conflict resolutions. The plan is loud
// about conflicts and never resolves them on its own (criterion 3).
// ---------------------------------------------------------------------------

/** Per-story conflict resolution chosen by the user: which side wins. */
export type ConflictResolution = 'local' | 'remote'

export interface SyncPlanInput {
  diff: StoryDiff[]
  /** True only when the signed-in user holds the project's write grant (criterion 5). */
  canWrite: boolean
  /** User-chosen winner per conflicting story id. A conflict left unresolved blocks the plan. */
  resolutions?: Record<string, ConflictResolution>
}

export interface SyncPlan {
  /** Stories to write to the service (create or update). Empty when `canWrite` is false. */
  push: { id: string, patch: StoryPatch }[]
  /** Stories to write into the repo (always allowed — pull is read-only on the service). */
  pull: StoryFile[]
  /** Conflicts the user still has to resolve before the push half can run (criterion 2+3). */
  unresolvedConflicts: StoryDiff[]
  /**
   * True when `canWrite` is false and the diff contains local changes that would
   * need a push. The push half is then refused with a clear message while the
   * pull half stays available (criterion 5).
   */
  pushRefusedNoWriteAccess: boolean
}

/**
 * Builds the sync plan from a diff:
 *   - unresolved conflicts are surfaced (both states), never auto-resolved (criterion 2+3)
 *   - without write access the push half is refused but pull still proceeds (criterion 5)
 */
export function planSync(input: SyncPlanInput): SyncPlan {
  const resolutions = input.resolutions ?? {}
  const push: { id: string, patch: StoryPatch }[] = []
  const pull: StoryFile[] = []
  const unresolvedConflicts: StoryDiff[] = []
  let wantsPush = false

  for (const diff of input.diff) {
    switch (diff.action) {
      case 'unchanged':
        break

      case 'pull':
      case 'create-local':
        if (diff.remote) pull.push(storyToFile(diff.remote))
        break

      case 'push':
      case 'create-remote':
        wantsPush = true
        if (input.canWrite && diff.local) push.push({ id: diff.id, patch: toPatch(diff.local) })
        break

      case 'conflict': {
        const choice = resolutions[diff.id]
        if (!choice) {
          unresolvedConflicts.push(diff)
          break
        }
        if (choice === 'local') {
          wantsPush = true
          if (input.canWrite && diff.local) push.push({ id: diff.id, patch: toPatch(diff.local) })
        }
        else if (diff.remote) {
          pull.push(storyToFile(diff.remote))
        }
        break
      }
    }
  }

  return {
    push: input.canWrite ? push : [],
    pull,
    unresolvedConflicts,
    pushRefusedNoWriteAccess: !input.canWrite && wantsPush,
  }
}

function toPatch(file: StoryFile): StoryPatch {
  return {
    title: file.title,
    storySentence: file.storySentence,
    acceptanceCriteria: file.acceptanceCriteria,
    repos: file.repos,
    links: file.links,
    testReferences: file.testReferences,
  }
}

function storyToFile(story: Story): StoryFile {
  return {
    id: story.id,
    rev: hashStory(syncable(story)),
    title: story.title,
    storySentence: story.storySentence,
    acceptanceCriteria: story.acceptanceCriteria,
    repos: story.repos,
    links: story.links,
    testReferences: story.testReferences,
    status: story.status,
  }
}

// ---------------------------------------------------------------------------
// Orchestration entry point used by the `ape-coder sync` command. Wires the
// pure pieces above to the filesystem (read/write story files) and the API
// client (fetch/push). Kept thin; the testable logic lives in the pure
// functions. Re-exported so the command module stays declarative.
// ---------------------------------------------------------------------------

export interface SyncResult {
  pushed: number
  pulled: number
  conflicts: StoryDiff[]
}

const DEFAULT_STORIES_DIR = '.ape-coder/stories'

/** Throws {@link CliError} on missing/invalid binding (criterion 6) before any I/O. */
export async function runSync(opts: { cwd: string, resolutions?: Record<string, ConflictResolution> }): Promise<SyncResult> {
  const config = await loadConfig(opts.cwd)

  const api = new CoderApi(config.coderUrl)
  const storiesDir = join(opts.cwd, config.storiesDir ?? DEFAULT_STORIES_DIR)

  const [local, remote, canWrite] = await Promise.all([
    readStoryFiles(storiesDir),
    api.listStories(config.projectId),
    canWriteProject(api, config.projectId),
  ])

  const diff = diffStories(local, remote)
  const plan = planSync({ diff, canWrite, resolutions: opts.resolutions })

  for (const item of plan.push) {
    await api.updateStory(config.projectId, item.id, item.patch)
  }

  return {
    pushed: plan.push.length,
    pulled: plan.pull.length,
    conflicts: plan.unresolvedConflicts,
  }
}

/**
 * Reads and parses `.ape-coder/config`, aborting loudly (criterion 6) when the
 * file is missing or carries no project binding — never guesses a target.
 */
async function loadConfig(cwd: string): Promise<CoderConfig> {
  const path = join(cwd, '.ape-coder', 'config')
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  }
  catch {
    throw new CliError(
      `No \`.ape-coder/config\` in ${cwd}. Bind this repo to a project first: create \`.ape-coder/config\` with \`projectId = "<id>"\`.`,
    )
  }
  return parseConfig(raw)
}

async function readStoryFiles(dir: string): Promise<StoryFile[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  }
  catch {
    return []
  }
  const files: StoryFile[] = []
  for (const name of names) {
    if (!name.endsWith('.md')) continue
    const text = await readFile(join(dir, name), 'utf8')
    files.push(parseStoryFile(text))
  }
  return files
}

/**
 * The signed-in user holds the project's write grant when the service lists the
 * project as writable. The server is the source of truth — a member without the
 * grant gets `canWrite: false`, so the push half is refused (criterion 5).
 */
async function canWriteProject(api: CoderApi, projectId: string): Promise<boolean> {
  const project = await api.getProject(projectId)
  return (project as { canWrite?: boolean }).canWrite !== false
}
