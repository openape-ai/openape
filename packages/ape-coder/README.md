# @openape/ape-coder

`@openape/ape-coder` is the command-line interface for [coder.openape.ai](https://coder.openape.ai). It lets you list projects, read and update stories, and run client-side repo sync from the terminal.

The CLI does not keep its own login state. It reuses the shared OpenApe session from `apes login`, then exchanges that session for a coder-scoped bearer token with the same permissions the web app enforces.

## Install

```bash
pnpm add -g @openape/ape-coder
```

## Authentication

Sign in once with the shared OpenApe CLI session:

```bash
apes login <email>
```

Then check the active identity:

```bash
ape-coder whoami
```

`ape-coder login` is a stub that points back to `apes login`. `ape-coder logout` clears the cached coder service-provider token without ending the shared IdP session.

## Commands

### `ape-coder projects list`

List the projects visible to the current user.

```bash
ape-coder projects list
ape-coder projects list --json
```

### `ape-coder stories list <project>`

List the stories of a project.

```bash
ape-coder stories list <project-id>
ape-coder stories list <project-id> --json
```

### `ape-coder stories show <project> <story>`

Read one story.

```bash
ape-coder stories show <project-id> <story-id>
ape-coder stories show <project-id> <story-id> --json
```

### `ape-coder stories set-title <project> <story> <title>`

Rename a story. The request succeeds only when the current user has the same write access the app requires.

```bash
ape-coder stories set-title <project-id> <story-id> "New title"
ape-coder stories set-title <project-id> <story-id> "New title" --json
```

### `ape-coder sync`

Sync a bound repo with coder.openape.ai. Sync is client-side and two-way: the CLI reads local story files, fetches remote stories, computes diffs from the last synced revision, and reports conflicts without overwriting either side silently.

```bash
ape-coder sync
ape-coder sync --json
ape-coder sync --resolve <story-id>=local
ape-coder sync --resolve <story-id>=remote
```

## Repo binding and story files

`ape-coder sync` reads a repo-local config file at `.ape-coder/config`.

Example:

```ini
projectId = "proj_123"
coderUrl = "https://coder.openape.ai"
storiesDir = ".ape-coder/stories"
```

- `projectId` is required.
- `coderUrl` is optional and defaults to `https://coder.openape.ai`.
- `storiesDir` is optional and defaults to `.ape-coder/stories`.

Story files are Markdown files with frontmatter plus the acceptance-criteria body.

```md
---
id: story_123
rev: 0123456789abcdef
title: "Rename project from CLI"
storySentence: "As a maintainer I want to rename a project so that the CLI matches the app"
status: green
repos: ["openape-ai/openape"]
links: ["https://git.openape.ai/openape-ai/openape/issues/585"]
testReferences: ["packages/ape-coder/test/sync.test.ts"]
---

Given a project with write access
When I rename it from the CLI
Then the updated title is stored by the service
```

## API surface

The package exports the service client and sync helpers from source:

- `resolveCoderUrl(override?)`
- `STORY_STATUSES`
- `ApiError`
- `CoderApi`
- `parseConfig(raw)`
- `parseStoryFile(text)`
- `serializeStoryFile(file)`
- `hashStory(story)`
- `diffStories(local, remote)`
- `planSync(input)`
- `runSync(opts)`

`CoderApi` provides these methods:

- `listProjects()`
- `getProject(projectId)`
- `listStories(projectId)`
- `getStory(projectId, storyId)`
- `updateStory(projectId, storyId, patch)`

## Errors and permissions

When no shared login is available, the CLI tells the reader to run `apes login <email>`. When the service denies an action, `ape-coder` surfaces the server error instead of bypassing it. API failures are raised as `ApiError` with the HTTP status code.
