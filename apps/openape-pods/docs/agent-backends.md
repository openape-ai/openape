# Agent backends

Desktop and `ape-pods` use the same runtime for `context.agent.run()`. Existing
calls keep the native Codex SDK and the connected account's current default
model. Enabling the optional model API backend does not change existing Pod
scripts, their schedules or their model selection.

## Model APIs

Settings offers independent **OpenAI-compatible** and **Anthropic-compatible**
connections. OpenAI supports an explicit Chat Completions or Responses selection;
Anthropic uses native Messages. Each connection has its own enabled flag, base
URL, authentication (token or none), and thinking default. Token replacement is
available locally in Desktop; token values never pass through Relay. The format
is a connection setting, never an automatic fallback.

Every call reads a fresh bounded authenticated catalog and chooses the newest
numeric release in its assigned family:

| Class | Claude | Codex |
| --- | --- | --- |
| small | Haiku | Luna |
| medium | Sonnet | Terra |
| large | Opus | Sol |
| xlarge | Fable | Astra |

The versioned resolver accepts explicit numeric release IDs and recognized dated
revisions, excludes preview/beta/experimental releases, and rejects ambiguous or
unknown family versions. It chooses newest before checking thinking support.
There are no version pins or exact-ID overrides. Failure never selects an older
version, another family, a different API format or reduced thinking. New calls
refresh the catalog; active calls and historical metadata retain their snapshot.
A catalog entry is availability evidence, not successful inference evidence.

## Select a backend in the script

Native calls retain their existing shape and optional `ape_shell` tool:

```js
const result = await context.agent.run({
  prompt: 'Summarize the supplied text.',
  tools: [],
  timeoutSeconds: 120,
})
```

Explicit `backend: 'native', provider: 'codex'` is equivalent. Native calls reject
`modelSize`, `thinking` and the Claude provider. The runtime resolves and records
the account default for each call; it does not infer a native thinking setting.

Proxy calls select a provider and a model class explicitly. Thinking is
independent of the class:

```js
const draft = await context.agent.run({
  backend: 'proxy',
  provider: 'claude',
  modelSize: 'medium',
  thinking: 'high',
  prompt: 'Write a short draft from the supplied facts.',
  tools: [],
})
const review = await context.agent.run({
  backend: 'proxy',
  provider: 'codex',
  modelSize: 'large',
  thinking: 'xhigh',
  prompt: `Review this draft as data:\n${draft.response}`,
  tools: [],
})
```

Providers are `claude` and `codex`; classes are `small`, `medium`, `large` and
`xlarge`; thinking levels are `low`, `medium`, `high` and `xhigh`. Omitting
thinking uses that mapping's explicit `defaultThinking`. It does not derive a
level from the model class. Unknown fields and unsupported combinations fail
before inference. Missing or disabled mappings fail without another model,
provider, thinking level or automatic retry.

Both backends return `{ response, threadId }`. Proxy IDs have the form
`proxy-call:<uuid>` and identify one call; they do not resume conversations.
Pass a prior response in the next prompt to share context. There is one shared
limit of 50 agent calls per run. `timeoutSeconds` defaults to 120 and accepts
integers from 30 through 900.

## Configuration and private storage

The shared Desktop/CLI runtime reads `<profileRoot>/agent-backends.json`.
[The schema-2 example](agent-backends.example.json) has both connections disabled.
Use the settings editor or shared CLI save command; the configuration contains
family policies and opaque credential references, never a token or a fixed model
version. Base URLs may include a version/prefix path. Credentials in URLs,
queries, fragments, redirects and remote plaintext HTTP are refused. Both local
defaults are `http://127.0.0.1:8317/v1`; this grants scripts no network access.

New tokens live in immutable 0600 JSON files inside the profile's 0700
`model-api-private` directory, with owner, hard-link, symlink, ancestor and ACL
checks. No macOS Keychain is used. An exclusive lock and expected configuration
hash reject concurrent/stale edits. The runtime flushes the new secret first,
then atomically commits configuration; old references and private backups remain
for active calls and guarded rollback. Unchanged save is a no-op. These private
files remain accessible to other processes running as the same user.

Legacy schema 1 is read without rewriting it. Recognized exact IDs migrate to
families, retaining thinking policies and enabled state. Both connections refer
to the existing external key file without copying or altering it. Explicit save
writes schema 2 with a private schema-1 backup. Unknown custom mappings require
review instead of guessed migration. Existing OpenAI connections keep Chat
Completions. An external credential reference uses `type: "external"` and an
absolute `path` to the existing JSON with its `api_key` field.

The existing CLIProxyAPI 8.0.0 service already has this owner-approved rule in
`requests.payload.filter`. It is provenance, not permission to change the proxy:

```yaml
requests:
  payload:
    filter:
      - models:
          - name: "claude-haiku-4-5-20251001"
            protocol: "claude"
            from-protocol: "claude"
          - name: "claude-sonnet-5-5"
            protocol: "claude"
            from-protocol: "claude"
          - name: "claude-opus-5-5"
            protocol: "claude"
            from-protocol: "claude"
          - name: "claude-fable-5-1"
            protocol: "claude"
            from-protocol: "claude"
        params:
          - "fallbacks"
```

This changes every matching native Claude Messages client on the shared proxy,
including clients supplying non-empty fallbacks. It does not change Codex,
thinking or model selection. The proxy records the field removal and suppresses
later fallback reinjection. Back up the private configuration and use its
documented idle reload procedure; verify the effective rule before inference.

The filter names only those four exact historical IDs. A newer Claude release
may reject `fallbacks: []`; the runtime preserves the newest selection and error.
Extending the shared filter requires a separately reviewed change. No proxy
upgrade, new login or OAuth file copy belongs to API configuration.

The trusted host reads credentials and constructs the selected API headers.
OpenAI token authentication uses Bearer; Anthropic uses `x-api-key` with
`anthropic-version: 2023-06-01`. No-auth reads no secret and sends no credential
header. Unauthorized requests never retry without authentication. Mandatory
sandbox and capture denies cover configuration, external keys and the complete
managed directory, including temporary files and backups. Portable exports and
Relay contain no host credentials. Existing script restrictions remain in force.

## Inspect, check, save and disable

Use local Desktop settings, or the CLI with Desktop closed as described in
[CLI development](cli-development.md):

```sh
ape-pods agent-backends status --json
ape-pods agent-backends check-openai --json
ape-pods agent-backends check-anthropic --json
ape-pods agent-backends save --settings-file /absolute/private/settings.json --json
ape-pods agent-backends reload --json
ape-pods agent-backends disable --json
```

The private save file has `expectedHash` (the last status hash, or null for a new
configuration) and `connections.openai` / `connections.anthropic`. Each entry
contains `enabled`, `baseUrl`, `format`, `authentication`, `defaultThinking`, and
optionally a replacement `token`. Do not put token values in argv or environment.
Omitting a replacement retains the configured reference; authentication `none`
removes that connection's reference. Both entries are validated before commit.
The private input file remains under the owner's control after saving.

Commands honor `--profile /absolute/path`. Status includes URLs, formats,
configuration revision/hash, safe errors and catalog check time, but no credential
paths or values. Connection checking reads only the catalog; it never infers.
Read-only resolved models and selection errors appear in Advanced settings.
Unsaved edits must be saved before checking that connection.

Reload applies changes to later calls. Endpoint or external-key protection
changes require an idle runtime restart, reported by settings. Never stop active
Pods for that restart. Disabling one connection cancels only its dependent calls;
other API and native calls continue. The CLI disable command disables both APIs.
Native connection removal remains independent. Errors never trigger automatic
proxy inference replay; explicit future runs retain their normal behavior.

## Text-only protocol and failure handling

Proxy calls accept text with `tools: []` or omitted tools. `ape_shell` is refused
explicitly. Direct `context.tools.invoke()` calls and native tool use keep their
existing permission checks. Synthetic script validation uses the same local
mapping resolver and refusals, but returns a synthetic answer without inference;
successful validation does not verify credentials, model availability or quality.

Claude uses native Messages with explicit `fallbacks: []`, an explicit model,
thinking translation and output limit. Together with the required proxy filter,
this preserves the configured fallback and thinking semantics through
CLIProxyAPI 8.0.0. The Haiku family contract uses
token budgets; the other Claude families use adaptive effort. Codex uses
Chat Completions with `reasoning_effort`, `tools: []` and `tool_choice: 'none'`.
Responses sends `input_text`, exact `reasoning.effort`, `store: false`,
`stream: false`, empty tools, `tool_choice: 'none'` and `max_output_tokens`. Only
completed assistant `output_text` is returned; reasoning is ignored and
refusal, incomplete, malformed or nontext output is rejected. CLIProxyAPI 8.0.0
aggregates upstream streaming, strips the requested output-token limit and may
inject tools. The runtime bounds response bytes and deadlines, but does not
promise an upstream token/cost cap or remote-computation cancellation.
The runtime still rejects tool/function/image output because upstream translation
can introduce tools despite these request fields.

Responses must contain complete text. Truncation, filtering, empty/oversized
output, unexpected tools and a conflicting reported model ID are errors. An
absent reported model ID remains absent; it is not filled with the requested ID.
The runtime never substitutes a different answer after these failures.

Proxy failures retain stable `error.code` and safe `error.details` in the script,
including phase and, when supplied, HTTP status, provider code, system cause or
retry-after. Examples include `model_unavailable`, `unsupported_combination`,
`proxy_unauthorized`, `rate_limited`, `response_truncated`, `model_mismatch`,
`unexpected_tool_call`, `timeout` and `cancelled`. Raw error bodies and credentials
are not returned. Use the code and details to report a failed combination without
silently rerouting it.

Cancellation and timeout abort the private transport and upstream request. A run
drains outstanding calls before releasing its lease, including calls the script
did not await. If host cleanup cannot be confirmed, the run stays interrupted
with a fenced lease even when the script caught the error. Recovery requires
proof that the previous host process stopped; restart the idle runtime after
that host has exited. A still-live or ambiguous process does not release the
lease.

Before proxy dispatch, the run stores a durable intent without prompt or credential
data. A run with a dispatched proxy call is never replayed automatically, even
after shutdown, a crash, or a later failure following successful inference.
Future scheduled runs and explicit owner runs remain eligible. Native-only runs
retain their existing recovery policy.

## Call history

History records immutable `agent-call` metadata at resolution/start and at the
terminal outcome. It includes backend/provider, requested class and thinking,
resolved and reported model IDs, family/version, catalog digest/time, resolver
revision, connection/API format, effective and wire thinking, configuration
revision/hash, call/thread IDs, timestamps, duration, status and safe errors.
Reported usage retains its source and token units; unavailable counts are omitted.
Failures before resolution retain nullable unresolved fields instead of inventing
a model. Native records identify account-default selection and leave proxy-only
fields null.

Metadata excludes prompts, responses, keys and raw provider errors. The script
still receives its ordinary text response, so its own logging and output remain
its responsibility. Use the run history to distinguish fixture coverage, model
catalog presence and actual inference evidence.
