# @openape/shapes

`@openape/shapes` resolves CLI commands into OpenApe authorization details. It loads adapter definitions, matches commands or capability requests against those adapters, builds grant requests, and installs adapters from the shapes registry when needed.

## Install

```bash
pnpm add @openape/shapes
```

## What it provides

This package is the command-resolution and adapter layer in the OpenApe monorepo. Apps and CLIs use it to:

- load adapter files from local, user, or system locations
- resolve a concrete command into authorization details and execution context
- resolve capability requests into one or more CLI permissions
- build grant requests from exact commands or structured adapter matches
- fetch and search the shapes registry
- install and remove adapter files
- parse shell input and fall back to generic exact-command grants when no adapter exists
- read the current `apes` login context and call OpenApe APIs with that token

## Load adapters

Use `loadAdapter` when you know the CLI id or executable and want to read an installed adapter.

```ts
import { loadAdapter, resolveAdapterPath, tryLoadAdapter } from '@openape/shapes'

const source = resolveAdapterPath('git')
const loaded = loadAdapter('git')
const optional = tryLoadAdapter('gh')
```

`loadAdapter` reads adapters from these locations, in order:

1. `./.openape/shapes/adapters`
2. `~/.openape/shapes/adapters`
3. `/etc/openape/shapes/adapters`

If no adapter exists and you want a generic fallback instead of an error, use `resolveGenericOrReject`.

```ts
import { resolveGenericOrReject } from '@openape/shapes'

const resolved = await resolveGenericOrReject('custom-cli', ['custom-cli', 'deploy'], {
  genericEnabled: true,
})
```

## Resolve command permissions

Use `resolveCommand` to match a concrete argv against an adapter operation and produce OpenApe authorization details.

```ts
import { loadAdapter, resolveCommand } from '@openape/shapes'

const loaded = loadAdapter('git')
const resolved = await resolveCommand(loaded, ['git', 'push', 'origin', 'main'])

console.log(resolved.detail)
console.log(resolved.executionContext)
console.log(resolved.permission)
```

The resolved result includes the matched adapter, the parsed bindings, the authorization detail, the execution context, and the canonical permission string.

## Resolve capability requests

Use `resolveCapabilityRequest` when you want to request permissions by resource chain and action instead of by a full command line.

```ts
import { loadAdapter, resolveCapabilityRequest } from '@openape/shapes'

const loaded = loadAdapter('acme')
const capability = resolveCapabilityRequest(loaded, {
  resources: ['project', 'task'],
  selectors: ['project.id=123', 'task.id=456'],
  actions: ['read', 'update'],
})

console.log(capability.details)
console.log(capability.permissions)
console.log(capability.summary)
```

This flow validates selectors against the adapter's declared resource chain and returns one authorization detail per requested action.

## Build grant requests

Use the request builders to turn resolved commands or capabilities into OpenApe grant requests.

### Structured CLI grant request

```ts
import { buildStructuredCliGrantRequest, loadAdapter, resolveCommand } from '@openape/shapes'

const loaded = loadAdapter('git')
const resolved = await resolveCommand(loaded, ['git', 'push', 'origin', 'main'])

const { request } = await buildStructuredCliGrantRequest(resolved, {
  requester: 'alice@example.com',
  target_host: 'chatty.example.net',
  grant_type: 'once',
  reason: 'Push the release branch',
})
```

### Exact-command grant request

```ts
import { buildExactCommandGrantRequest } from '@openape/shapes'

const { request } = await buildExactCommandGrantRequest(['bash', '-lc', 'npm publish'], {
  requester: 'alice@example.com',
  target_host: 'chatty.example.net',
  audience: 'shapes',
  grant_type: 'timed',
})
```

Use `buildExactCommandGrantRequest` for exact command execution. Use `buildStructuredCliGrantRequest` when you already resolved an adapter-backed command or capability.

## Parse shell commands

Use the shell parser helpers when you receive shell-style input.

```ts
import { extractShellCommandString, parseShellCommand } from '@openape/shapes'

const raw = extractShellCommandString(['bash', '-c', 'git status'])
const parsed = raw ? parseShellCommand(raw) : null

console.log(parsed)
```

`parseShellCommand` detects compound operators such as `&&`, `|`, redirections, subshells, and backticks. Callers can use `isCompound` to decide whether to fall back to a generic shell grant flow.

If you want automatic adapter installation during shell handling, use `loadOrInstallAdapter`.

```ts
import { loadOrInstallAdapter } from '@openape/shapes'

const loaded = await loadOrInstallAdapter('gh')
```

This first checks local adapters, then looks up the registry, installs a matching adapter, and records an audit log entry for the auto-install.

## Shapes registry

Use the registry helpers to fetch adapter metadata and search the remote index.

```ts
import { fetchRegistry, findAdapter, searchAdapters } from '@openape/shapes'

const index = await fetchRegistry()
const git = findAdapter(index, 'git')
const results = searchAdapters(index, 'github')
```

`fetchRegistry` caches the registry under `~/.openape/shapes/cache/registry.json` for one hour by default.

## Install and remove adapters

Use the installer helpers to manage adapter files from registry entries.

```ts
import { fetchRegistry, findAdapter, installAdapter, isInstalled, removeAdapter } from '@openape/shapes'

const index = await fetchRegistry(true)
const entry = findAdapter(index, 'git')

if (entry && !isInstalled(entry.id, false)) {
  await installAdapter(entry)
}

removeAdapter('git', false)
```

The installer verifies the downloaded SHA-256 digest before writing the adapter file.

Additional installer helpers:

```ts
import { findConflictingAdapters, getInstalledDigest } from '@openape/shapes'

const digest = getInstalledDigest('git', false)
const conflicts = findConflictingAdapters('git', 'git')
```

## Endpoint and auth helpers

Use the config and HTTP helpers when you need the current OpenApe login context or an API endpoint.

```ts
import { apiFetch, discoverEndpoints, getAuthToken, getGrantsEndpoint, getIdpUrl, getRequesterIdentity, loadAuth } from '@openape/shapes'

const auth = loadAuth()
const idp = getIdpUrl()
const token = getAuthToken()
const requester = getRequesterIdentity()
const discovery = idp ? await discoverEndpoints(idp) : {}
const grantsEndpoint = idp ? await getGrantsEndpoint(idp) : ''

const profile = await apiFetch('/api/me')
```

These helpers read the current `apes` login from `~/.config/apes/auth.json` and attach the bearer token automatically.

## Generic fallback helpers

Use the generic helpers when a CLI has no registered adapter but you still need an exact-command authorization detail.

```ts
import { buildGenericAdapter, buildGenericResolved, GENERIC_OPERATION_ID, isGenericResolved } from '@openape/shapes'

const adapter = buildGenericAdapter('custom-cli')
const resolved = await buildGenericResolved('custom-cli', ['custom-cli', 'deploy'])

console.log(GENERIC_OPERATION_ID)
console.log(isGenericResolved(resolved))
```

Generic resolved commands always use:

- operation id `_generic.exec`
- risk level `high`
- `exact_command: true`
- a resource chain that binds the CLI name and argv hash

## Audit log helper

Use `appendAuditLog` to append JSONL audit entries without interrupting the main flow if logging fails.

```ts
import { appendAuditLog } from '@openape/shapes'

appendAuditLog({ action: 'adapter-auto-install', cli_id: 'gh' })
```
