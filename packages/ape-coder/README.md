# @openape/ape-coder

CLI for [coder.openape.ai](https://coder.openape.ai). Use it to list the projects you can access, read project stories, rename a story, and sync repo story files with the service.

`ape-coder` uses the shared OpenApe SSO session from [`apes login`](../apes/README.md). It does not keep a separate login.

## Install

```bash
pnpm add -D @openape/ape-coder
```

## Authentication

Sign in once on the device with the shared OpenApe CLI session:

```bash
apes login <email>
```

Then check the active identity:

```bash
ape-coder whoami
```

To clear only the cached token for coder.openape.ai:

```bash
ape-coder logout
```

If you are not signed in, commands fail with a prompt to run `apes login`.

## Commands

### `ape-coder projects list`

Lists the projects the current identity can see.

```bash
ape-coder projects list
ape-coder projects list --json
```

### `ape-coder stories list <project>`

Lists the stories in a project.

```bash
ape-coder stories list <project-id>
ape-coder stories list <project-id> --json
```

### `ape-coder stories show <project> <story>`

Shows one story.

```bash
ape-coder stories show <project-id> <story-id>
ape-coder stories show <project-id> <story-id> --json
```

### `ape-coder stories set-title <project> <story> <title>`

Renames a story. The API applies the same permissions as the web app.

```bash
ape-coder stories set-title <project-id> <story-id> "New title"
ape-coder stories set-title <project-id> <story-id> "New title" --json
```

### `ape-coder sync`

Synchronizes repo story files with the bound project in coder.openape.ai.

```bash
ape-coder sync
ape-coder sync --json
ape-coder sync --resolve <story-id>=local
ape-coder sync --resolve <story-id>=remote
```

When both the repo and the service changed the same story since the last sync, `ape-coder` reports a conflict and leaves both sides unchanged until you resolve it explicitly.

## Repo binding

`ape-coder sync` reads `.ape-coder/config` from the repo root.

Example:

```ini
projectId = "proj_123"
coderUrl = "https://coder.openape.ai"
storiesDir = ".ape-coder/stories"
```

Fields:

- `projectId` — required project id to sync against.
- `coderUrl` — optional service URL; defaults to `https://coder.openape.ai`.
- `storiesDir` — optional repo-relative story folder; defaults to `.ape-coder/stories`.

## Story file format

Each local story file is Markdown with frontmatter.

```md
---
id: story_123
rev: 2e7b2c...
title: "Rename stories from the CLI"
storySentence: "As a writer, I want to rename a story from the terminal."
status: approved
repos: ["openape-ai/openape"]
links: ["https://coder.openape.ai/projects/proj_123/stories/story_123"]
testReferences: ["packages/ape-coder/test/coder-cli.test.ts"]
---

- Renaming updates the service story.
- Permission errors are returned as-is.
```

Frontmatter fields map to the service story fields:

- `id`
- `rev` — last synced content hash.
- `title`
- `storySentence`
- `status` — one of `draft`, `consistent`, `approved`, `red`, `green`, `documented`.
- `repos`
- `links`
- `testReferences`

The Markdown body becomes `acceptanceCriteria`.

## JSON output

These commands support `--json` for machine-readable output:

- `ape-coder projects list`
- `ape-coder stories list <project>`
- `ape-coder stories show <project> <story>`
- `ape-coder stories set-title <project> <story> <title>`
- `ape-coder sync`

## Authentication behavior

- `ape-coder` exchanges the shared `apes login` session for a service token for coder.openape.ai.
- `ape-coder login` is a stub that points to `apes login`.
- `ape-coder logout` clears the cached coder service token only. It does not end the shared IdP session.

## Environment

- `OPENAPE_CODER_URL` — override the default `https://coder.openape.ai`.

## Development

Package scripts:

```bash
pnpm --filter @openape/ape-coder lint
pnpm --filter @openape/ape-coder typecheck
pnpm --filter @openape/ape-coder test
```

## Package contents

- `src/cli.ts`: CLI entrypoint and command registration.
- `src/coder-api.ts`: authenticated API client for coder.openape.ai.
- `src/handlers.ts`: command handlers for listing projects and reading or editing stories.
- `src/sync.ts`: repo config parsing, story file parsing, diffing, conflict handling, and sync execution.
- `src/commands/*`: command definitions for auth helpers, projects, stories, and sync.
