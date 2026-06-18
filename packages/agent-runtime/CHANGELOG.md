# @openape/agent-runtime

## 0.2.3

### Patch Changes

- Updated dependencies [12d7dd6]
  - @openape/cli-auth@0.5.2

## 0.2.2

### Patch Changes

- e8f559f: runApeShell accepts an optional cwd

## 0.2.1

### Patch Changes

- 3e3dfea: Consolidate the SSRF guard (isBlockedAddress + assertPublicUrl) into @openape/core as the single source of truth; nuxt-auth-sp and agent-runtime now consume it. No behaviour change.
- Updated dependencies [3e3dfea]
  - @openape/core@0.18.0

## 0.2.0

### Minor Changes

- bb4a318: Extract the agent-execution cluster (in-process run loop, agent tools, coding agent) from `@openape/apes` into a new dependency-light `@openape/agent-runtime` package. apes re-exports the surface, so `@openape/ape-agent` is unaffected. No behaviour change.

### Patch Changes

- 2d5f64b: Add an SSRF guard to the agent `http.get`/`http.post` tools: validate the URL scheme, DNS-resolve the host and reject private/loopback/link-local/CGNAT/ULA/cloud-metadata targets, and re-validate every redirect hop (manual redirect following). Prevents a prompt-injected agent from reaching internal infrastructure via the HTTP tool.
