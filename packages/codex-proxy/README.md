# @openape/codex-proxy

Subscription-only access to ChatGPT (via OpenAI **Codex** auth) for OpenApe agents.

Owns the Codex OAuth credential (device flow + refresh) and exposes a thin
**OpenAI-compatible** `/v1/chat/completions` proxy over the Codex **Responses**
backend, so `@openape/agent-runtime` keeps speaking Chat Completions while the
model runs on the owner's ChatGPT subscription.

Pattern adapted from OpenClaw (own the token, don't shell out to `codex login`).
No API keys, no keyed fallback — agents need the subscription. See ape-plan
`01KTCBFW…` (M3).
