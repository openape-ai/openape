# @openape/ape-coder

`ape-coder` is the terminal client for `coder.openape.ai`. It lets you list projects, read and edit project user-stories, and sync story files between a local repository and the Coder service.

The CLI uses the shared OpenApe SSO session from `apes login`. It has the same permissions as the web app: reads and writes are accepted or rejected by the Coder API for the signed-in identity.

## Install

```sh
pnpm add -g @openape/ape-coder
```

Or run it from this workspace:

```sh
pnpm --filter @openape/ape-coder exec ape-coder --help
```

## Sign in

Sign in once with the shared OpenApe CLI session:

```sh
apes login you@example.com
ape-coder whoami
```

`ape-coder login` is only a pointer to `apes login`; it does not create a separate Coder login. `ape-coder logout` clears the cached Coder service token for this CLI and leaves the shared IdP session untouched.

## Commands

### `ape-coder projects list`

Lists the projects visible to the signed-in user.

```sh
ape-coder projects list
ape-coder projects list --json
```

### `ape-coder stories list <project>`

Lists the user-stories in a project. Use the project id from `ape-coder projects list`.

```sh
ape-coder stories list 01HPROJECT
ape-coder stories list 01HPROJECT --json
```

### `ape-coder stories show <project> <story>`

Shows one user-story.

```sh
ape-coder stories show 01HPROJECT 01HSTORY
ape-coder stories show 01HPROJECT 01HSTORY --json
```

### `ape-coder stories set-title <project> <story> <title>`

Renames a story when the signed-in user has the same write grant required in the web app.

```sh
ape-coder stories set-title 01HPROJECT 01HSTORY "Describe the checkout flow"
```

### `ape-coder sync`

Syncs the current repository with the bound Coder project. The repository binding lives in `.ape-coder/config`:

```toml
projectId = "01HPROJECT"
# optional; defaults to https://coder.openape.ai
coderUrl = "https://coder.openape.ai"
# optional; defaults to .ape-coder/stories
storiesDir = ".ape-coder/stories"
```

Run sync from the repository root:

```sh
ape-coder sync
ape-coder sync --json
```

When both the local story file and the remote story changed since the last sync, the CLI reports a conflict and does not silently overwrite either side. Resolve a conflict explicitly:

```sh
ape-coder sync --resolve 01HSTORY=local
ape-coder sync --resolve 01HSTORY=remote
```

## Output for scripts

Read commands support `--json` so scripts and agents can consume structured project and story data:

```sh
ape-coder projects list --json
ape-coder stories list 01HPROJECT --json
ape-coder stories show 01HPROJECT 01HSTORY --json
```

## Service URL

By default, `ape-coder` talks to `https://coder.openape.ai`. For development or tests, set `OPENAPE_CODER_URL`:

```sh
OPENAPE_CODER_URL=http://localhost:3000 ape-coder projects list
```
