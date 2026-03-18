# OpenClaw Plugin Grants — Progress

## Current State
- **Status:** All milestones complete
- **Last Updated:** 2026-03-18
- **Tests:** 104 passing (12 test files)
- **Build:** OK (typecheck + build)

## Milestone 1: Package Scaffolding & Plugin Grundgerüst ✅
- Package directory, package.json, tsconfig, tsup, vitest
- openclaw.plugin.json manifest
- src/types.ts — PluginConfig, OpenClaw API types, Grant types
- src/index.ts — register(api) with tool, hook, HTTP route, CLI

## Milestone 2: Adapter System ✅
- TOML parser (quote-aware array splitting)
- Adapter types, loader with search path priority
- Command → operation matching with disambiguation
- Resource chain → permission string resolution
- Fallback for unknown commands (hash-based)
- Bundled adapters: gh.toml, az.toml, exo.toml

## Milestone 3: Local Mode ✅
- Grant store (in-memory + file persistence)
- Grant cache (permission-based keys, coverage matching)
- Local JWT signing (Ed25519, jose)
- JWKS HTTP route
- Channel approval (grant-approve/deny commands)
- Audit log (JSONL)
- grant_exec full flow

## Milestone 4: IdP Mode ✅
- DNS discovery (email → DDISA → IdP URL)
- OIDC discovery with endpoint resolution
- Ed25519 challenge-response auth
- IdP grant flow: create → poll → token → verify → execute
- RFC 9396 authorization_details
- JWT verification via @openape/grants

## Milestone 5: apes Integration ✅
- apes binary detection
- Privileged execution via apes + JWT
- Fallback to direct execution

## Milestone 6: Tests & CLI ✅
- 104 tests across 12 files
- Plugin integration tests (register, hooks, CLI)
- CLI commands: status, list, revoke, adapters
- Full build + typecheck passing
