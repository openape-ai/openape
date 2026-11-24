# OpenApe

[![Version](https://img.shields.io/badge/version-0.0.0-blue.svg)](https://github.com/openape-ai/openape)

OpenApe is the reference implementation of **DDISA** (DNS-Discoverable Identity & Service
Authorization): people sign in with their e-mail domain and a passkey, agents with a
registered Ed25519 key and a signed challenge, and services authorize both through revocable
grants. On top of that identity layer the monorepo ships the
IdP, the secrets vault, work apps (tasks, timetrack, monitor, dashboard), evidence services
(Reports, Plans, PR reviews), Pods for automation on the Mac, and the `apes` CLI.

[MAP.md](MAP.md) shows which part does what and where it runs;
[ARCHITECTURE.md](ARCHITECTURE.md) explains how the parts fit together.

## Quick Start

```bash
. ./scripts/activate-node.sh
pnpm install --frozen-lockfile
pnpm run doctor
pnpm --filter openape-free-idp dev   # one app; see MAP.md for the others
```

[Local development](docs/operations/local-development.md) covers the local stack and test
fixtures, [AGENTS.md](AGENTS.md) the checks and release rules.

## Documentation

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

## Project Structure

- `packages/` — publishable libraries (@openape/*)
- `modules/` — publishable Nuxt modules
- `apps/` — deployable applications (private)
- `examples/` — example apps + E2E tests

## License

MIT

## Preserved legacy applications

Nest, Troop, ape-agent, CRM, Chat with their CLIs, and Question Service are maintained separately in
[OpenApe Legacy](https://github.com/patrick-hofmann/legacy). See the
[extraction and runtime boundary](docs/operations/legacy-apps.md).
