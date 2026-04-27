---
"@openape/proxy": patch
"@openape/apes": patch
---

proxy + apes: Node-runnable build for `@openape/proxy`, depended on by `@openape/apes`

`@openape/proxy` is now distributed as a Node-runnable bundle (`dist/index.js` with
`#!/usr/bin/env node` shebang, exec bit set, target node22) instead of a Bun-only
TypeScript source. The package's `bin` entry now points at `dist/index.js`, the
package ships `dist/`, `config.example.toml`, and `README.md`.

`@openape/apes` adds `@openape/proxy` as a `workspace:*` dependency. This is
foundation work for the upcoming `apes proxy -- <cmd>` subcommand: a global
`npm i -g @openape/apes` install will from now on also install the proxy
binary, and `apes` can locate it via
`require.resolve('@openape/proxy/package.json')` plus the `bin` field — no
`bun` runtime required on the user's machine.

No CLI behavior change today. `apes proxy --` lands in the next milestone.
