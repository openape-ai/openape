# @openape/ape-coder

`ape-coder` is the CLI for `coder.openape.ai`. It lets you browse the projects you can access, read project stories, rename a story, inspect the current OpenApe identity, and sync repo story files with a bound coder project.

## Install

```bash
pnpm add -D @openape/ape-coder
```

Run the CLI with your package manager:

```bash
pnpm exec ape-coder --help
```

## Authentication

`ape-coder` reuses the shared OpenApe SSO session from `apes login`.

```bash
apes login <email>
ape-coder whoami
```

Available auth commands:

- `ape-coder whoami` shows the current shared OpenApe identity and token expiry.
- `ape-coder login` prints a CLI error that tells you to run `apes login <email>`.
- `ape-coder logout` clears the cached service-provider token for `coder.openape.ai` and leaves the shared IdP session in place.

If no shared session is available, API calls fail with a message that tells you to run `apes login`.

## Commands

### `ape-coder projects list`

Lists the projects visible to the signed-in user.

```bash
ape-coder projects list
ape-coder projects list --json
```

Default output prints a table with project IDs and names. `--json` prints the full API response.

### `ape-coder stories list <project>`

Lists the stories of a project.

```bash
ape-coder stories list <project-id>
ape-coder stories list <project-id> --json
```

Default output prints a table with story ID, status, and title. `--json` prints the full story records.

### `ape-coder stories show <project> <story>`

Shows one story.

```bash
ape-coder stories show <project-id> <story-id>
ape-coder stories show <project-id> <story-id> --json
```

Default output prints the title, status, story sentence, and acceptance criteria. `--json` prints the full story record.

### `ape-coder stories set-title <project> <story> <title>`

Renames a story.

```bash
ape-coder stories set-title <project-id> <story-id> "New title"
ape-coder stories set-title <project-id> <story-id> "New title" --json
```

The command uses the same server-side permission checks as the web app. Default output prints a success line with the updated story ID and title. `--json` prints the updated story record.

### `ape-coder sync`

Synchronizes repo story files with the bound coder project.

```bash
ape-coder sync
ape-coder sync --json
ape-coder sync --resolve <story-id>=local
ape-coder sync --resolve <story-id>=remote
```

The command:

- reads the project binding from `.ape-coder/config`
- reads local story files from `.ape-coder/stories` by default
- fetches remote stories from the coder API
- compares both sides against the last synced revision hash
- reports conflicts instead of overwriting either side silently

With `--json`, the command prints:

```json
{
  "pushed": 0,
  "pulled": 0,
  "conflicts": []
}
```

If conflicts exist, the command prints each conflicting story ID and waits for explicit `--resolve <story-id>=local|remote` choices.

## Repo binding

`ape-coder sync` reads a repo-local config file at `.ape-coder/config`.

```ini
projectId = "<project-id>"
coderUrl = "https://coder.openape.ai"
storiesDir = ".ape-coder/stories"
```

- `projectId` is required.
- `coderUrl` is optional and defaults to `https://coder.openape.ai`.
- `storiesDir` is optional and defaults to `.ape-coder/stories`.

If the file is missing or `projectId` is not set, sync stops with a CLI error instead of guessing a target project.

## Story file format

Each local story file is Markdown with frontmatter.

```md
---
id: story_123
rev: 0123456789abcdef
title: "CLI sync a bound repo"
storySentence: "As a maintainer, I sync repo stories from the terminal."
status: draft
repos: ["openape-ai/openape"]
links: ["https://coder.openape.ai"]
testReferences: ["packages/ape-coder/test/coder-repo-sync.test.ts"]
---

Acceptance criteria go here.
```

Supported story statuses:

- `draft`
- `consistent`
- `approved`
- `red`
- `green`
- `documented`

The sync logic hashes these syncable fields:

- `title`
- `storySentence`
- `acceptanceCriteria`
- `repos`
- `links`
- `testReferences`
- `status`

## Programmatic API

The package exports these documented modules.

### `coder-api`

`coder-api.ts` defines the API client, data models, and error types for `coder.openape.ai`.

#### `resolveCoderUrl(override?: string): string`

Returns the coder base URL, using the explicit argument first, then `OPENAPE_CODER_URL`, then `https://coder.openape.ai`. The return value has no trailing slash.

#### `CoderApi`

`new CoderApi(coderUrl?: string)` builds a client for one coder service base URL.

Methods:

- `listProjects(): Promise<Project[]>`
- `getProject(projectId: string): Promise<Project>`
- `listStories(projectId: string): Promise<Story[]>`
- `getStory(projectId: string, storyId: string): Promise<Story>`
- `updateStory(projectId: string, storyId: string, patch: StoryPatch): Promise<Story>`

Each request authenticates with a bearer token from `@openape/cli-auth`. If no shared login session exists, the client throws a `CliError` that tells the user to run `apes login <email>`.

#### `ApiError`

`ApiError` extends `CliError` and carries the HTTP status code from a non-OK API response.

#### `Project`

```ts
interface Project {
  id: string
  name: string
  visionMd: string
  repos: string[]
  createdAt: number
  updatedAt: number
}
```

#### `STORY_STATUSES` and `StoryStatus`

`STORY_STATUSES` is the readonly status list:

```ts
['draft', 'consistent', 'approved', 'red', 'green', 'documented']
```

`StoryStatus` is the union of those values.

#### `Story`

```ts
interface Story {
  id: string
  projectId: string
  title: string
  storySentence: string
  acceptanceCriteria: string
  repos: string[]
  links: string[]
  testReferences: string[]
  status: StoryStatus
  createdAt: number
  updatedAt: number
}
```

#### `StoryPatch`

`StoryPatch` is a partial update shape with these optional fields:

- `title`
- `storySentence`
- `acceptanceCriteria`
- `repos`
- `links`
- `testReferences`

### `handlers`

`handlers.ts` exposes command-oriented wrapper functions around a `CoderApi`-compatible client.

#### `CliContext`

```ts
interface CliContext {
  api: Pick<CoderApi, 'listProjects' | 'listStories' | 'getStory' | 'updateStory'>
}
```

#### `listProjects(ctx: CliContext): Promise<Project[]>`

Returns the projects from `ctx.api.listProjects()`.

#### `listStories(ctx: CliContext, projectId: string): Promise<Story[]>`

Returns the stories from `ctx.api.listStories(projectId)`.

#### `editStory(ctx: CliContext, projectId: string, storyId: string, patch: StoryPatch): Promise<Story>`

Forwards a story update to `ctx.api.updateStory(projectId, storyId, patch)`.

### `sync`

`sync.ts` defines the repo binding format, story file format, sync diffing, sync planning, and the `runSync` orchestration entry point.

#### `CoderConfig`

```ts
interface CoderConfig {
  projectId: string
  coderUrl?: string
  storiesDir?: string
}
```

#### `parseConfig(raw: string): CoderConfig`

Parses `.ape-coder/config` content and returns the bound project configuration. Throws `CliError` when `projectId` is missing.

#### `StoryFile`

```ts
interface StoryFile {
  id: string | null
  rev: string | null
  title: string
  storySentence: string
  acceptanceCriteria: string
  repos: string[]
  links: string[]
  testReferences: string[]
  status: Story['status']
}
```

#### `parseStoryFile(text: string): StoryFile`

Parses one Markdown story file with frontmatter. Throws `CliError` when the frontmatter is missing or malformed.

#### `serializeStoryFile(file: StoryFile): string`

Serializes a `StoryFile` back to frontmatter and Markdown body text.

#### `SyncableStory`

```ts
type SyncableStory = Pick<Story,
  'title' | 'storySentence' | 'acceptanceCriteria' | 'repos' | 'links' | 'testReferences' | 'status'
>
```

#### `hashStory(story: SyncableStory): string`

Builds a stable SHA-256 hash from the syncable story fields.

#### `SyncAction`

```ts
type SyncAction = 'unchanged' | 'push' | 'pull' | 'create-remote' | 'create-local' | 'conflict'
```

#### `StoryDiff`

```ts
interface StoryDiff {
  id: string
  action: SyncAction
  local: StoryFile | null
  remote: Story | null
}
```

#### `diffStories(local: StoryFile[], remote: Story[]): StoryDiff[]`

Pairs local and remote stories by ID and classifies each one as unchanged, push, pull, create-remote, create-local, or conflict.

#### `ConflictResolution`

```ts
type ConflictResolution = 'local' | 'remote'
```

#### `SyncPlanInput`

```ts
interface SyncPlanInput {
  diff: StoryDiff[]
  canWrite: boolean
  resolutions?: Record<string, ConflictResolution>
}
```

#### `SyncPlan`

```ts
interface SyncPlan {
  push: { id: string, patch: StoryPatch }[]
  pull: StoryFile[]
  unresolvedConflicts: StoryDiff[]
  pushRefusedNoWriteAccess: boolean
}
```

#### `planSync(input: SyncPlanInput): SyncPlan`

Builds a sync plan from a diff, optional conflict resolutions, and the caller's write permission.

#### `SyncResult`

```ts
interface SyncResult {
  pushed: number
  pulled: number
  conflicts: StoryDiff[]
}
```

#### `runSync(opts: { cwd: string, resolutions?: Record<string, ConflictResolution> }): Promise<SyncResult>`

Loads `.ape-coder/config`, reads local story files, fetches remote stories, plans the sync, pushes updates, and returns the sync summary.

### `errors`

#### `CliError`

```ts
class CliError extends Error {
  constructor(message: string, exitCode?: number)
}
```

`CliError` is the user-facing error type used by the CLI entrypoint and the package modules.
