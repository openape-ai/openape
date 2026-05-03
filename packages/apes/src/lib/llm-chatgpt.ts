// Helpers for `apes agents llm setup chatgpt`. The proxy lives in the
// spawning user's home (per-machine, per-user — multiple agents share one
// ChatGPT subscription). Idempotent end-to-end so re-running setup is safe.

import { execFileSync, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const PROVIDER = 'chatgpt' as const
export const PLIST_LABEL = 'eco.hofmann.apes.llm.chatgpt'
export const PROXY_PORT = 4000
export const PROXY_HOST = '127.0.0.1'

export function installDir(): string {
  return join(homedir(), '.local', 'share', 'apes', 'llm', PROVIDER)
}

export function plistPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${PLIST_LABEL}.plist`)
}

export function statePath(): string {
  return join(installDir(), 'state.json')
}

export function chatgptAuthPath(): string {
  return join(homedir(), '.config', 'litellm', 'chatgpt', 'auth.json')
}

export interface State {
  provider: 'chatgpt'
  installed_at: number
  port: number
  master_key: string
  install_dir: string
}

export function readState(): State | null {
  const path = statePath()
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as State
  }
  catch {
    return null
  }
}

export function writeState(state: State): void {
  mkdirSync(installDir(), { recursive: true })
  writeFileSync(statePath(), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
}

export function isProxyHealthy(masterKey: string, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const req = request({
      host: PROXY_HOST,
      port: PROXY_PORT,
      path: '/v1/models',
      method: 'GET',
      headers: { Authorization: `Bearer ${masterKey}` },
      timeout: timeoutMs,
    }, (res) => {
      res.resume()
      resolve((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300)
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
    req.end()
  })
}

export function findPython(): string {
  for (const cand of ['python3.13', 'python3.12']) {
    try {
      const path = execFileSync('which', [cand], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
      if (path) return path
    }
    catch {
      // try next
    }
  }
  throw new Error(
    'Need python3.13 or python3.12 on PATH (`brew install python@3.13`). '
    + 'Python 3.14 currently lacks an orjson prebuilt wheel.',
  )
}

export function ensureVenv(dir: string): string {
  const venvPython = join(dir, 'venv', 'bin', 'python')
  if (existsSync(venvPython)) return venvPython
  const python = findPython()
  mkdirSync(dir, { recursive: true })
  execFileSync(python, ['-m', 'venv', join(dir, 'venv')], { stdio: 'inherit' })
  return venvPython
}

export function installLitellm(venvPython: string): void {
  execFileSync(venvPython, ['-m', 'pip', 'install', '--quiet', '--upgrade', 'pip', 'litellm[proxy]'], {
    stdio: 'inherit',
  })
}

function findPythonSiteVersion(venvDir: string): string {
  const libDir = join(venvDir, 'lib')
  if (!existsSync(libDir)) {
    throw new Error(`venv lib dir missing: ${libDir}`)
  }
  const py = readdirSync(libDir).find(e => e.startsWith('python3.'))
  if (!py) {
    throw new Error(`no python3.x dir under ${libDir}`)
  }
  return py
}

export function applyOutputItemsPatch(venvDir: string): void {
  // Mirror of patches/apply.py from agent-copy-test. Idempotent.
  // litellm 1.83.14 only reads response.completed.output, but the Codex
  // backend ships items via response.output_item.done events and sends
  // response.completed with output:[]. Accumulate items.
  const target = join(
    venvDir,
    'lib',
    findPythonSiteVersion(venvDir),
    'site-packages',
    'litellm',
    'llms',
    'chatgpt',
    'responses',
    'transformation.py',
  )
  if (!existsSync(target)) {
    throw new Error(`patch target missing: ${target}`)
  }
  const src = readFileSync(target, 'utf8')
  if (src.includes('accumulated_items')) return
  const replacements: Array<[string, string]> = [
    [
      `        completed_response = None
        error_message = None
        for chunk in body_text.splitlines():`,
      `        completed_response = None
        error_message = None
        # Codex backend ships items via response.output_item.done events and
        # then sends response.completed with output:[]. Accumulate.
        accumulated_items: list = []
        for chunk in body_text.splitlines():`,
    ],
    [
      `            event_type = parsed_chunk.get("type")
            if event_type == ResponsesAPIStreamEvents.RESPONSE_COMPLETED:`,
      `            event_type = parsed_chunk.get("type")
            if event_type == "response.output_item.done":
                item = parsed_chunk.get("item")
                if isinstance(item, dict):
                    accumulated_items.append(item)
                continue
            if event_type == ResponsesAPIStreamEvents.RESPONSE_COMPLETED:`,
    ],
    [
      `                            response_payload["created_at"]
                        )
                    try:`,
      `                            response_payload["created_at"]
                        )
                    if not response_payload.get("output") and accumulated_items:
                        response_payload["output"] = accumulated_items
                    try:`,
    ],
  ]
  let out = src
  for (const [oldStr, newStr] of replacements) {
    if (!out.includes(oldStr)) {
      throw new Error('patch hunks no longer match — litellm version drift')
    }
    out = out.replace(oldStr, newStr)
  }
  writeFileSync(target, out)
}

export function writeConfig(dir: string): void {
  const config = `model_list:
  - model_name: gpt-5.4
    litellm_params:
      model: chatgpt/gpt-5.4
    model_info:
      mode: responses

  - model_name: gpt-5.3-codex
    litellm_params:
      model: chatgpt/gpt-5.3-codex
    model_info:
      mode: responses

litellm_settings:
  drop_params: true

general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY
`
  writeFileSync(join(dir, 'config.yaml'), config)
}

export function generateMasterKey(): string {
  return `sk-litellm-${randomBytes(24).toString('base64url')}`
}

export function writeEnv(dir: string, masterKey: string): void {
  writeFileSync(join(dir, '.env'), `LITELLM_MASTER_KEY=${masterKey}\n`, { mode: 0o600 })
}

export function writeStartScript(dir: string): void {
  const sh = `#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
set -a
. ./.env
set +a
exec ./venv/bin/litellm --config ./config.yaml --host ${PROXY_HOST} --port ${PROXY_PORT}
`
  const path = join(dir, 'start.sh')
  writeFileSync(path, sh, { mode: 0o755 })
}

export function ensureLogDir(dir: string): void {
  mkdirSync(join(dir, 'logs'), { recursive: true })
}

/**
 * Runs the proxy in the foreground (no launchd) until either:
 *  - the device-code line appears → invoke onDeviceCode (caller prints
 *    URL + code so the user can complete OAuth) → keep waiting
 *  - "Application startup complete" appears → resolve and kill child
 */
export function runProxyUntilReady(
  dir: string,
  masterKey: string,
  onDeviceCode: (info: { url: string, code: string }) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, LITELLM_MASTER_KEY: masterKey }
    const child = spawn(join(dir, 'start.sh'), [], { env, stdio: ['ignore', 'pipe', 'pipe'] })

    let resolved = false
    const settle = (err?: Error) => {
      if (resolved) return
      resolved = true
      try { child.kill('SIGTERM') }
      catch {
        // already gone
      }
      if (err) reject(err)
      else resolve()
    }

    let buffer = ''
    let pendingUrl: string | null = null
    let promptedCode = false
    const handle = (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      let nl = buffer.indexOf('\n')
      while (nl >= 0) {
        const line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        // Visit https://auth.openai.com/...
        const visitIdx = line.indexOf('Visit ')
        if (visitIdx >= 0) {
          pendingUrl = line.slice(visitIdx + 6).trim()
        }
        // Enter code: ABCD-EFGH
        const codeIdx = line.indexOf('Enter code:')
        if (codeIdx >= 0 && pendingUrl && !promptedCode) {
          const code = line.slice(codeIdx + 'Enter code:'.length).trim()
          if (code) {
            promptedCode = true
            onDeviceCode({ url: pendingUrl, code })
          }
        }
        if (line.includes('Application startup complete')) {
          setTimeout(settle, 500)
        }
        nl = buffer.indexOf('\n')
      }
    }

    child.stdout.on('data', handle)
    child.stderr.on('data', handle)
    child.on('exit', code => settle(code === 0 ? undefined : new Error(`litellm exited ${code} before startup completed`)))
    child.on('error', err => settle(err))

    // Hard cap. OAuth UX can take a few minutes; 10 is the upper bound
    // beyond which something is broken.
    setTimeout(() => settle(new Error('Timed out waiting for litellm startup (10 min)')), 10 * 60 * 1000)
  })
}

export function buildPlist(dir: string, label: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${join(dir, 'start.sh')}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${dir}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>StandardOutPath</key>
    <string>${join(dir, 'logs', 'stdout.log')}</string>
    <key>StandardErrorPath</key>
    <string>${join(dir, 'logs', 'stderr.log')}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
</dict>
</plist>
`
}

export function writePlist(): void {
  mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true })
  writeFileSync(plistPath(), buildPlist(installDir(), PLIST_LABEL))
}

export function uid(): number {
  return Number.parseInt(execFileSync('id', ['-u']).toString().trim(), 10)
}

export function bootstrapPlist(): void {
  try { execFileSync('launchctl', ['bootout', `gui/${uid()}/${PLIST_LABEL}`], { stdio: 'ignore' }) }
  catch {
    // not loaded — ignore
  }
  execFileSync('launchctl', ['bootstrap', `gui/${uid()}`, plistPath()], { stdio: 'inherit' })
}

export function bootoutPlist(): void {
  try { execFileSync('launchctl', ['bootout', `gui/${uid()}/${PLIST_LABEL}`], { stdio: 'ignore' }) }
  catch {
    // not loaded — ignore
  }
}

export function deletePlistFile(): void {
  if (existsSync(plistPath())) rmSync(plistPath())
}

export function deleteInstallDir(): void {
  if (existsSync(installDir())) rmSync(installDir(), { recursive: true, force: true })
}

export function revokeOAuth(): void {
  if (existsSync(chatgptAuthPath())) rmSync(chatgptAuthPath())
}
