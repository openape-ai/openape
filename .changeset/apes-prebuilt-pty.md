---
"@openape/apes": patch
---

apes: switch from `node-pty` to `@lydell/node-pty` so install no longer requires Python or a C++ compiler

Upstream `node-pty` ships prebuilt binaries only for darwin and win32. Linux users had to compile via `node-gyp`, which means Python + a working C++ toolchain on every install. `@lydell/node-pty` distributes per-platform binaries (`@lydell/node-pty-darwin-arm64`, `-darwin-x64`, `-linux-arm64`, `-linux-x64`, `-win32-arm64`, `-win32-x64`) via `optionalDependencies`, the same pattern as `esbuild`, `swc`, and `lightningcss`. npm/pnpm only resolves the matching platform's binary tarball; no install scripts, no compilation, no toolchain dependency.

Side effects:

- Removes the `postinstall` perm-fix hack (`scripts/fix-node-pty-perms.mjs`); the per-platform packages preserve the spawn-helper exec bit through pnpm 10's tarball extraction.
- Removes `node-pty` from the root `pnpm.onlyBuiltDependencies` allowlist.

No public API change. The PTY bridge keeps the same behavior (PS1-marker prompt detection, line-completion frames, exit-code capture).
