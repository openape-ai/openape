import { chmod, mkdir, rename, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface LauncherTarget { executable: string, script: string, socket: string }

const quote = (value: string) => `'${value.replaceAll('\'', '\'\\\'\'')}'`
const moved = 'OpenApe Pods moved or was removed. Open the app once to repair the Codex connection.'

// Codex's configuration points at this stable script; the app rewrites it at
// every start, so updates and bundle moves followed by a start keep working.
// Without the bundle it still answers MCP with the reason, because Codex
// reports a launcher that only exits as a bare handshake failure.
export function launcherScript(target: LauncherTarget): string {
  return `#!/bin/sh
# Written by OpenApe Pods; Codex starts it as the openape-pods MCP server.
app=${quote(target.executable)}
script=${quote(target.script)}
if [ -x "$app" ] && [ -f "$script" ]; then
  ELECTRON_RUN_AS_NODE=1 OPENAPE_PODS_CODEX_SOCKET=${quote(target.socket)} exec "$app" "$script"
fi
message='${moved}'
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\\([0-9][0-9]*\\).*/\\1/p')
  [ -z "$id" ] && continue
  case "$line" in
    *'"initialize"'*) printf '{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{"name":"openape-pods","version":"1"},"instructions":"%s"}}\\n' "$id" "$message" ;;
    *'"tools/list"'*) printf '{"jsonrpc":"2.0","id":%s,"result":{"tools":[{"name":"pods_control","description":"%s","inputSchema":{"type":"object"}}]}}\\n' "$id" "$message" ;;
    *'"tools/call"'*) printf '{"jsonrpc":"2.0","id":%s,"result":{"isError":true,"content":[{"type":"text","text":"%s"}]}}\\n' "$id" "$message" ;;
    *) printf '{"jsonrpc":"2.0","id":%s,"error":{"code":-32601,"message":"%s"}}\\n' "$id" "$message" ;;
  esac
done
`
}

export async function writeLauncher(path: string, target: LauncherTarget): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(`${path}.tmp`, launcherScript(target), { mode: 0o700 }); await chmod(`${path}.tmp`, 0o700)
  await rename(`${path}.tmp`, path)
}

// Only an owner who connected Codex has a launcher; nothing is created otherwise.
export async function refreshLauncher(path: string, target: LauncherTarget): Promise<boolean> {
  const exists = await stat(path).then(() => true, (error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return false; throw error })
  if (exists) await writeLauncher(path, target)
  return exists
}
