# @openape/sp-tasks

`@openape/sp-tasks` provides a small task queue for service providers that store agent tasks in a Drizzle/libsql database. It uses Agent2Agent-shaped task records and an SQS-style lease model so one worker can claim a task, report progress, and resolve it.

## What it exports

### `agentTasks`

`agentTasks` is the Drizzle SQLite table definition for persisted tasks.

Each row stores:
- task identity: `id`, `contextId`, `type`
- task state: `state`
- A2A payloads: `history`, `artifacts`
- lease bookkeeping: `assignee`, `leaseUntil`, `deliveryCount`
- timestamps: `createdAt`, `updatedAt`

### `AgentTaskRow`

`AgentTaskRow` is the inferred row type for `agentTasks`.

### Queue types and helpers

#### `SpTaskDb`

`SpTaskDb` is the Drizzle/libsql database type expected by the queue helpers and HTTP handlers.

#### `DEFAULT_LEASE_MS`

`DEFAULT_LEASE_MS` is the default task lease duration in milliseconds (`30000`).

#### `SpTaskError`

`SpTaskError` is thrown when a worker tries to resolve a task without holding a valid lease.

#### `dataMessage(data, role?)`

Creates an A2A-style `Message` with one data part. `role` defaults to `'user'`.

#### `textMessage(text, role?)`

Creates an A2A-style `Message` with one text part. `role` defaults to `'user'`.

#### `dataArtifact(data, name?)`

Creates an `Artifact` with one data part.

#### `textArtifact(text, name?)`

Creates an `Artifact` with one text part.

#### `enqueueTask(db, opts)`

Adds a new task in `submitted` state.

`opts` includes:
- `type`: queue-specific task type
- `message`: initial A2A message stored as `history[0]`
- `now`: timestamp in milliseconds
- optional `id`
- optional `contextId`

The function returns the created `Task`.

#### `leaseNextTask(db, opts)`

Atomically claims the oldest available task for one assignee.

A task is claimable when it is:
- in `submitted` state, or
- in `working` state with an expired lease

`opts` includes:
- `assignee`: worker identity
- `leaseMs`: lease duration in milliseconds
- `now`: current timestamp in milliseconds

The function returns the leased `Task`, or `null` when nothing is available.

#### `resolveTask(db, opts)`

Applies an update from the worker that currently holds the lease.

`opts` includes:
- `id`: task id
- `assignee`: worker identity
- `state`: next task state
- `now`: current timestamp in milliseconds
- optional `artifact`
- optional `statusMessage`
- optional `leaseMs`

Behavior:
- non-terminal states keep the task assigned and extend the lease
- terminal states (`completed`, `failed`, `canceled`, `rejected`) release the lease
- `artifact` is appended to `artifacts`
- `statusMessage` is appended to `history`

The function throws `SpTaskError` when the lease is stale or held by a different assignee.

#### `getTask(db, id)`

Returns one task by id, or `null` when it does not exist.

### Hardening export

The package re-exports `withBusyRetry` from `./harden`.

### Task model exports

The package re-exports all public task types from `./types`, including:
- `TaskState`
- `TERMINAL_STATES`
- `TextPart`, `DataPart`, `FilePart`, `Part`
- `Message`
- `Artifact`
- `TaskStatus`
- `Task`

## HTTP handlers

### `defineGetNextTaskHandler(opts)`

Creates an h3 handler for a `GetNextTask` endpoint.

The handler:
- resolves the caller identity with `resolveAgent`
- returns `401` when no service-agent identity is available
- claims one task with `leaseNextTask`
- returns `{ task }`, where `task` may be `null`

### `defineResolveTaskHandler(opts)`

Creates an h3 handler for a `ResolveTask` endpoint.

The handler:
- resolves the caller identity with `resolveAgent`
- reads `id`, `state`, optional `artifact`, and optional `statusMessage` from the request body
- returns `400` when `id` or `state` is missing
- calls `resolveTask`
- maps `SpTaskError` to `409`
- returns `{ task }`

### `SpTaskHandlerOptions`

Both handler factories accept `SpTaskHandlerOptions`:
- `db`: a `SpTaskDb` instance or a function that returns one
- `resolveAgent(event)`: resolves the calling service-agent identity
- optional `leaseMs`: lease duration override
- optional `now()`: clock injection for tests

## Example

This example shows a service provider that defines the table, enqueues a task, and exposes the two worker endpoints.

```ts
import { drizzle } from 'drizzle-orm/libsql'
import { agentTasks, dataMessage, defineGetNextTaskHandler, defineResolveTaskHandler, enqueueTask } from '@openape/sp-tasks'

const db = drizzle(process.env.DATABASE_URL!)

await enqueueTask(db, {
  type: 'summarize-document',
  message: dataMessage({ documentId: 'doc_123' }),
  now: Date.now(),
})

const resolveAgent = async (event) => {
  // Replace with your SP auth check.
  return event.context.agentId ?? null
}

export const getNextTask = defineGetNextTaskHandler({ db, resolveAgent })
export const postResolveTask = defineResolveTaskHandler({ db, resolveAgent })
```
