---
"@openape/apes": patch
---

apes: `apes proxy --` now sets all common proxy env-var variants

Wider tool coverage for the env-var-based egress mediation. Previously
only `HTTPS_PROXY`, `HTTP_PROXY`, and `NO_PROXY` (uppercase) were set.
Now also: `https_proxy` / `http_proxy` / `no_proxy` (lowercase, libcurl
+ many Python tools), `ALL_PROXY` / `all_proxy` (curl, rsync, ftp), and
`NODE_USE_ENV_PROXY=1` (Node 24+ native `fetch` via undici).

Net effect: a wrapped command's child Node code (e.g. Claude Code's
WebFetch tool calling out via undici) now routes through the proxy
without per-app ProxyAgent wiring, and lowercase-only tools that
previously bypassed (some Python `urllib`, older curl distro builds)
are now covered.

No CLI-flag change. Hard kernel-level enforcement (block direct
sockets) remains a separate opt-in milestone.
