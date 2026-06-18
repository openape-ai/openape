# @openape/sp-tasks

`@openape/sp-tasks` provides an SP-side task queue with an Agent2Agent-shaped task model, SQS-style leasing, and h3 handlers for service-agent workers.

## What it exports

`@openape/sp-tasks` exports:

- `agentTasks` — Drizzle SQLite table definition for persisted task rows
- `AgentTaskRow` — inferred row type for `agentTasks`
- queue helpers from `queue.ts`
- retry hardening helpers from `harden.ts`
- task and message types from `types.ts`

## Data model

The package stores tasks in an `agent_tasks` table with these fields:

- `id` — task id
- `contextId` — shared context id for the task conversation
- `type` — application-defined task type
- `state` — current task state
- `history` — JSON-encoded A2A-style messages
- `artifacts` — JSON-encoded task artifacts
- `assignee` — current worker identity for an active lease
- `leaseUntil` — lease expiry timestamp in milliseconds
- `deliveryCount` — number of times the task has been leased
- `createdAt` / `updatedAt` — timestamps in milliseconds

Indexes exist for `state` and `leaseUntil` so workers can claim available work.

## Queue API

### `DEFAULT_LEASE_MS`

The default task lease duration is 30 seconds.

### `SpTaskError`

`SpTaskError` is thrown when a worker tries to resolve a task without a valid active lease, or when the task does not exist.

### `type SpTaskDb`

`SpTaskDb` is a Drizzle libsql database handle that includes the `agentTasks` table.

### `dataMessage(data, role?)`

Builds a task history message with one `data` part. The default role is `user`.

### `textMessage(text, role?)`

Builds a task history message with one `text` part. The default role is `user`.

### `dataArtifact(data, name?)`

Builds an artifact with one `data` part.

### `textArtifact(text, name?)`

Builds an artifact with one `text` part.

### `enqueueTask(db, opts)`

Adds a new task in the `submitted` state.

`opts` includes:

- `type` — task type string
- `message` — first history message
- `now` — current timestamp in milliseconds
- `id` — optional task id
- `contextId` — optional context id

The function returns the created task object. If `id` or `contextId` is omitted, the package generates them.

### `leaseNextTask(db, opts)`

Claims the oldest available task for a worker.

`opts` includes:

- `assignee` — worker identity
- `leaseMs` — lease duration in milliseconds
- `now` — current timestamp in milliseconds

The function atomically:

- picks the oldest `submitted` task, or the oldest `working` task whose lease has expired
- sets `state` to `working`
- records the worker in `assignee`
- sets `leaseUntil`
- increments `deliveryCount`

It returns the leased task, or `null` when no task is claimable.

### `resolveTask(db, opts)`

Applies a worker update to a leased task.

`opts` includes:

- `id` — task id
- `assignee` — worker identity
- `state` — next task state
- `now` — current timestamp in milliseconds
- `artifact` — optional artifact to append
- `statusMessage` — optional message to append to history
- `leaseMs` — optional replacement lease duration for non-terminal updates

For non-terminal states such as `working`, the function keeps the task assigned and extends the lease. For terminal states (`completed`, `failed`, `canceled`, `rejected`), it clears `assignee` and `leaseUntil`.

The function throws `SpTaskError` if the caller is not the current assignee or the lease has expired.

### `getTask(db, id)`

Returns one task by id, or `null` if the task is missing.

## h3 handler factories

### `defineGetNextTaskHandler(opts)`

Creates an h3 handler for a `GetNextTask` endpoint.

`opts` includes:

- `db` — a `SpTaskDb` instance or a function that returns one
- `resolveAgent` — resolves the calling service-agent identity
- `leaseMs` — optional lease duration override
- `now` — optional clock function for tests

The handler:

- returns `401` when `resolveAgent` does not return an identity
- leases one task for the caller
- responds with `{ task }`, where `task` is `null` when nothing is available

### `defineResolveTaskHandler(opts)`

Creates an h3 handler for a `ResolveTask` endpoint.

The request body includes:

- `id`
- `state`
- optional `artifact`
- optional `statusMessage`

The handler:

- returns `401` when `resolveAgent` does not return an identity
- returns `400` when `id` or `state` is missing
- resolves the task for the current worker
- returns `409` when the lease is stale or invalid
- responds with `{ task }`

## Types

The package exports A2A-shaped types for:

- `TaskState`
- `Task`
- `TaskStatus`
- `Message`
- `Artifact`
- `Part`
- `TextPart`
- `DataPart`
- `FilePart`

`TaskState` supports:

- `submitted`
- `working`
- `input-required`
- `auth-required`
- `completed`
- `failed`
- `canceled`
- `rejected`

## Example

```ts
import { defineGetNextTaskHandler, defineResolveTaskHandler, enqueueTask, textArtifact, textMessage } from '@openape/sp-tasks'

const task = await enqueueTask(db, {
  type: 'summarize',
  message: textMessage('Summarize this document'),
  now: Date.now(),
})

const getNextTask = defineGetNextTaskHandler({
  db,
  resolveAgent: () => 'agent:writer',
})

const resolveTask = defineResolveTaskHandler({
  db,
  resolveAgent: () => 'agent:writer',
})

await resolveTask(db, {
  id: task.id,
  assignee: 'agent:writer',
  state: 'completed',
  artifact: textArtifact('Summary text', 'summary.txt'),
  now: Date.now(),
})
```

In this flow, `enqueueTask` creates a submitted task, `defineGetNextTaskHandler` exposes a claim endpoint for a service-agent, and `resolveTask` completes the task with an artifact after the worker holds the lease.
