# openclaw spike — findings (Task 1)

**Version:** openclaw `2026.6.8` (build 844f405), npm `openclaw`, CalVer. Pin this.
Date: 2026-06-17.

## 1. Per-instance config + state isolation — SOLVED (clean)
- Default config file: `~/.openclaw/openclaw.json`. State under `~/.openclaw/`.
- Override per instance via env (proven): `OPENCLAW_CONFIG_PATH=<home>/openclaw.json`
  `OPENCLAW_STATE_DIR=<home>/.openclaw-state`. `openclaw config file` echoed the override.
- Also `--profile <name>` / `--dev` isolate under `~/.openclaw-<name>`; and plain
  `HOME=<agent-home>` redirects the default `~/.openclaw`.
- **Decision:** isolate each of our agents by setting `OPENCLAW_CONFIG_PATH` + `OPENCLAW_STATE_DIR`
  (+ `HOME`) in the process env — exactly our existing pm2-env pattern. openclaw's own
  `agents add` multi-agent isolation is NOT needed (one openclaw instance per our agent).

## 2. Config writes — use `openclaw config patch` (don't hand-template)
- `openclaw config patch --stdin` (or `--file`) does a **validated** merge write (objects merge,
  arrays/scalars replace, null deletes). `openclaw config schema` prints the JSON schema;
  `config get/set/unset` exist too.
- **Decision:** the adapter writes the provider + agent block via `config patch --stdin`
  (schema-validated, robust to openclaw schema drift) rather than emitting raw JSON5.

## 3. Run model — one-shot embedded is the MVP path (NOT a daemon) — KEY FINDING
- Two shapes exist:
  - **Gateway daemon:** `openclaw daemon start` (launchd/systemd) + `openclaw agent` runs one
    turn *against* the gateway. Heavier; openclaw owns sessions/cron/channels.
  - **One-shot embedded:** `openclaw agent --local --message <text> --json [--model openape/gpt-5.5]`
    runs the loop embedded, no daemon — "requires model provider API keys in your shell".
    Session continuity via `--session-id` / `--session-key agent:<id>:<key>`.
    `--deliver` defaults off → with `--local --json` and no channel it is pure compute
    (no messaging integration needed; channels stay out of scope).
- **Decision (MVP):** **one-shot embedded.** The nest execs `openclaw agent --local --json
  --message <incoming> --session-key agent:<name>:<thread>` per chat message, env =
  `{ OPENCLAW_CONFIG_PATH, OPENCLAW_STATE_DIR, HOME, OPENAI_API_KEY:<DDISA token> }`.
  No pm2 daemon, no port/lifecycle to supervise.

### Contract impact (feeds back into the design)
The design's `RuntimeAdapter` was daemon-shaped (`launchSpec` → a long-running pm2 process).
openclaw MVP is **request/response, not a daemon**. So the contract needs a second shape:
- `bridge` → daemon: `launchSpec(ctx)` (long-lived, nest delivers messages to it).
- `openclaw` → one-shot: `invoke(ctx, { message, sessionKey }): Promise<{ text }>` (nest execs per message).
Model the adapter as a discriminated union: `{ kind: 'daemon', prepare, launchSpec }` |
`{ kind: 'oneshot', prepare, invoke }`. The nest's chat router picks the path by `kind`.
This is a small, honest generalization — and it means openclaw needs **no** change to
`pm2-supervisor` (only daemon adapters touch it); the one-shot path hooks the chat router
(`session-host`/`troop-ws`) instead.

## 4. Provider key on every call — high confidence, verify at E2E
- `--local` uses the configured OpenAI-compatible provider (`models.providers.<name>.{baseUrl,apiKey}`,
  apiKey falls back to `OPENAI_API_KEY`). Standard OpenAI client → bearer on every model call
  incl. tool-result turns. Not yet packet-captured; confirm in Task 5 via the gateway access log
  (every line for the session carries the agent's DDISA token).

## Net effect on the plan
- Task 2 contract: make `RuntimeAdapter` a `daemon | oneshot` union (above).
- Task 4 openclaw-adapter: implement `kind:'oneshot'` — `prepare` via `config patch`, `invoke`
  shells `openclaw agent --local`. No `pm2-supervisor` change for openclaw.
- Sharp edge #1 (token expiry) is *softer* in one-shot mode: a fresh token is read per invoke,
  so long-lived staleness mostly disappears — re-read `auth.json` at each `invoke`.
- Sharp edge #3 (run syntax) RESOLVED: `openclaw agent --local --json --message … --session-key …`.
