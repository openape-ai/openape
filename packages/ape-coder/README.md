# @openape/ape-coder

`ape-coder` is the terminal client for `coder.openape.ai`. It lets you list projects, read and edit user stories, inspect the current OpenApe identity, and sync repo story files with a bound coder project.

## Install

```bash
pnpm add -D @openape/ape-coder
```

Run the CLI with your package manager of choice, for example:

```bash
pnpm exec ape-coder --help
```

## Authentication

`ape-coder` does not keep its own login session. It reuses the shared OpenApe SSO session from `apes login`.

```bash
apes login <email>
ape-coder whoami
```

- `ape-coder login` prints a pointer to `apes login <email>`.
- `ape-coder logout` clears the cached SP token for `coder.openape.ai` and leaves the shared IdP session in place.
- If no shared session is available, API calls fail with a message that tells the reader to run `apes login`.

## Commands

### `ape-coder projects list`

Lists the projects visible to the signed-in user.

```bash
ape-coder projects list
ape-coder projects list --json
```

Human-readable output prints project ids and names. `--json` returns the raw project records from the API.

### `ape-coder stories list <project>`

Lists the stories of a project.

```bash
ape-coder stories list <project-id>
ape-coder stories list <project-id> --json
```

Human-readable output prints story id, status, and title. `--json` returns the full story objects.

### `ape-coder stories show <project> <story>`

Prints one story.

```bash
ape-coder stories show <project-id> <story-id>
ape-coder stories show <project-id> <story-id> --json
```

Without `--json`, the command prints the title, status, story sentence, and acceptance criteria.

### `ape-coder stories set-title <project> <story> <title>`

Renames a story through the same server-side permission model as the web app.

```bash
ape-coder stories set-title <project-id> <story-id> "New title"
ape-coder stories set-title <project-id> <story-id> "New title" --json
```

Without `--json`, the command prints a success line with the updated story id and title.

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
- compares both sides by content hash and last-synced revision
- reports conflicts instead of overwriting either side silently

With `--json`, the command returns:

```json
{
  "pushed": 0,
  "pulled": 0,
  "conflicts": []
}
```

If conflicts exist, `ape-coder sync` prints the conflicting story ids and waits for an explicit `--resolve <story-id>=local|remote` choice.

## Repo binding and story files

`ape-coder sync` expects a repo-local config file at `.ape-coder/config`.

```ini
projectId = "<project-id>"
coderUrl = "https://coder.openape.ai"
storiesDir = ".ape-coder/stories"
```

- `projectId` is required.
- `coderUrl` is optional and defaults to `https://coder.openape.ai`.
- `storiesDir` is optional and defaults to `.ape-coder/stories`.

Each story file is Markdown with frontmatter:

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

Supported statuses are:

- `draft`
- `consistent`
- `approved`
- `red`
- `green`
- `documented`

## API surface

The package exports the CLI entry and the sync/helpers used by the implementation:

- `CoderApi`
- `ApiError`
- `resolveCoderUrl()`
- `STORY_STATUSES`
- `listProjects()`
- `listStories()`
- `editStory()`
- `parseConfig()`
- `parseStoryFile()`
- `serializeStoryFile()`
- `hashStory()`
- `diffStories()`
- `planSync()`
- `runSync()`
- `CliError`

See `src/coder-api.ts`, `src/handlers.ts`, and `src/sync.ts` for the exported types that accompany these functions.
