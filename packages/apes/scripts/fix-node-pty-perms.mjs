#!/usr/bin/env node
/**
 * Workaround for pnpm 10 losing execute permissions on `spawn-helper`
 * binaries shipped in node-pty prebuilds.
 *
 * Without exec bit, `pty.spawn(...)` fails at runtime with
 *   Error: posix_spawnp failed.
 *
 * This script runs after `pnpm install` and chmods the helper for every
 * platform's prebuild directory that it can find. Missing directories are
 * ignored silently so it's safe to run on any host.
 */
import { chmodSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)

let ptyRoot
try {
  ptyRoot = dirname(require.resolve('node-pty/package.json'))
}
catch {
  // node-pty not installed yet (prepare runs before install in some flows) — nothing to do.
  process.exit(0)
}

const platforms = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64']
for (const platform of platforms) {
  const helper = join(ptyRoot, 'prebuilds', platform, 'spawn-helper')
  if (existsSync(helper)) {
    try {
      chmodSync(helper, 0o755)
    }
    catch (err) {
      console.warn(`[fix-node-pty-perms] failed to chmod ${helper}:`, err instanceof Error ? err.message : String(err))
    }
  }
}
