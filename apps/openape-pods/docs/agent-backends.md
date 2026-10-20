# Agent backends

Desktop and `ape-pods` use the same runtime for `context.agent.run()`. Existing
calls keep the native Codex SDK and the connected account's current default
model. Enabling the optional CLIProxyAPI backend does not change existing Pod
scripts, their schedules or their model selection.

## Verified proxy configuration

The eight example model mappings have real acceptance evidence for the selected
thinking levels. Revision 2 also verified Sonnet/high followed by Sol/xhigh in
one disposable Pod with explicit response handoff. The complete mapping/thinking
matrix uses fixtures; successful catalog listing alone is not inference evidence.

CLIProxyAPI 8.0.0 needs the exact Claude payload filter below. Without it, the
upstream rejects the explicit empty `fallbacks` list with HTTP 400. Omitting the
field in Pods would instead allow the proxy to inject fallback models. Preserve
the explicit field in Pods and remove it only through the reviewed proxy filter.

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

## Configure the existing gateway

The selected profile owns `agent-backends.json`. Start from
[the configuration example](agent-backends.example.json), which is disabled by
default. Configure the documented existing CLIProxyAPI connection and its
private key-file reference. Pods does not log in to the proxy's accounts, copy
OAuth files or install a second proxy. The example's model entries describe
explicit mappings, not proof that a provider currently accepts each combination.
Enable only combinations with the required verification evidence.

The base URL ends in `/v1`, contains no credentials, query or fragment, and uses
HTTPS for remote hosts. HTTP is accepted only for loopback. On the gateway host,
the documented local URL is `http://127.0.0.1:8317/v1`. Do not expose that port as
a general Pod network destination.

For the existing CLIProxyAPI 8.0.0 service, append this rule to
`requests.payload.filter` in its private configuration, preserving other rules:

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

The configuration and the existing credential JSON must be regular files owned
by the runtime user, without group/other access or additional hard links. Direct
symlinks are refused. Use private permissions such as `0600`; the credential
file contains the existing `api_key` field and the configuration refers to it
through an absolute `keyFile` path and `keyField: 'api_key'`. Do not paste key
values into scripts, configuration examples, logs, reports or chat.

The trusted host reads the key. It never sends it to the worker, renderer,
script, Pod snapshot/export or child environment. Mandatory denies cover the
configured and canonical configuration/key paths in both sandbox levels and
override assigned folders. Key files are also refused as imports and snapshots.
The script's existing network restrictions stay in force.

Each mapping specifies `modelId`, protocol, output limit, default thinking,
all four thinking translations and their enabled flags, plus a
`capabilityEvidenceVersion`. `schemaVersion` is 1. Change `revision` when changing
the configuration; the runtime also records its content hash. A missing,
malformed or unsafe configuration disables the proxy while native Codex remains
available independently.

## Inspect, reload and disable

Use desktop connection settings, or the CLI with the desktop closed as described
in [CLI development](cli-development.md):

```sh
ape-pods agent-backends status --json
ape-pods agent-backends reload --json
ape-pods agent-backends disable --json
```

These commands honor `--profile /absolute/path`. Status exposes availability,
configuration revision/hash, mappings, supported thinking levels and safe error
details. It never returns the base URL, private paths or keys. Status is local
configuration/readiness information, not a live inference check. The owner MCP
runtime reference also reports backend availability and the common selection
enums.

A reload applies mapping and enabled-flag changes to new calls. Active calls
keep their immutable starting configuration. Changing `baseUrl` or `keyFile`
requires an idle runtime restart, including adding a first configuration to an
already running unconfigured runtime. Stop active work before that restart.
Rotate key contents securely at the same path: each call rereads the key and
fails explicitly if it is unavailable. Reload updates displayed readiness.

Disable aborts active proxy calls, waits for their cleanup and persists
`proxy.enabled: false`. Re-enable by editing the private configuration and
reloading it. Removing a native connection aborts only active native calls;
disabling/removing proxy availability aborts only proxy calls. A script may catch
ordinary backend errors and continue its other work.
If a run fails after a proxy error, automatic run recovery does not repeat that
inference. A script can handle the error explicitly; existing native recovery
and independently scheduled future runs retain their current behavior.

## Text-only protocol and failure handling

Proxy calls accept text with `tools: []` or omitted tools. `ape_shell` is refused
explicitly. Direct `context.tools.invoke()` calls and native tool use keep their
existing permission checks. Synthetic script validation uses the same local
mapping resolver and refusals, but returns a synthetic answer without inference;
successful validation does not verify credentials, model availability or quality.

Claude uses native Messages with explicit `fallbacks: []`, an explicit model,
thinking translation and output limit. Together with the required proxy filter,
this preserves the configured fallback and thinking semantics through
CLIProxyAPI 8.0.0. The sample Haiku mapping uses
token budgets; the other sample Claude models use adaptive effort. Codex uses
Chat Completions with `reasoning_effort`, `tools: []` and `tool_choice: 'none'`.
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

## Call history

History records immutable `agent-call` metadata at resolution/start and at the
terminal outcome. It includes backend/provider, requested class and thinking,
resolved and reported model IDs, effective and wire thinking, configuration
revision/hash, call/thread IDs, timestamps, duration, status and safe errors.
Reported usage retains its source and token units; unavailable counts are omitted.
Failures before resolution retain nullable unresolved fields instead of inventing
a model. Native records identify account-default selection and leave proxy-only
fields null.

Metadata excludes prompts, responses, keys and raw provider errors. The script
still receives its ordinary text response, so its own logging and output remain
its responsibility. Use the run history to distinguish fixture coverage, model
catalog presence and actual inference evidence.
