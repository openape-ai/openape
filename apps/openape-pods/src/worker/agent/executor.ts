import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { sandboxPolicy, superviseProcess, verifyExecutable } from '../runtime/sandbox'
import type { ScriptRuntime } from '../runs/runner'
import { startAgentGateway } from './gateway'
import type { AgentGatewayServices } from './gateway'

export interface AgentRuntime extends ScriptRuntime { binary: string, catalog: string, manifest: string, sdkHost: string }
const disabledFeatures = ['shell_tool', 'unified_exec', 'shell_snapshot', 'apps', 'plugins', 'remote_plugin', 'browser_use', 'computer_use', 'in_app_browser', 'code_mode', 'code_mode_host', 'multi_agent', 'multi_agent_v2', 'hooks', 'memories', 'image_generation', 'view_image', 'goals', 'skill_search', 'skill_mcp_dependency_install', 'workspace_dependencies', 'enable_request_compression', 'sleep_tool']
const quote = (value: string) => `'${value.replaceAll('\'', '\'\\\'\'')}'`
export async function executeAgent(runtime: AgentRuntime, privateRoot: string, prompt: string, references: string[], services: AgentGatewayServices, signal: AbortSignal, event: (value: unknown) => void): Promise<{ threadId: string, response: string }> {
  if (!prompt.trim() || prompt.length > 128 * 1024) throw new Error('Invalid agent prompt')
  const manifest = JSON.parse(await readFile(runtime.manifest, 'utf8')) as { sdk: string, binaryHash: string, catalogHash: string }
  if (manifest.sdk !== '0.153.4') throw new Error('Unsupported SDK runtime')
  await verifyExecutable(runtime.binary, manifest.binaryHash); await verifyExecutable(runtime.catalog, manifest.catalogHash)
  const root = join(privateRoot, `agent-${randomUUID()}`); const confined = join(root, 'confined'); const home = join(confined, 'home'); const workspace = join(confined, 'workspace'); const codexHome = join(home, 'codex')
  await Promise.all([mkdir(workspace, { recursive: true, mode: 0o700 }), mkdir(codexHome, { recursive: true, mode: 0o700 })])
  const lifecycle = new AbortController()
  const activeSignal = AbortSignal.any([signal, lifecycle.signal, AbortSignal.timeout(120000)])
  const gateway = await startAgentGateway(services, activeSignal)
  try {
    const profile = join(root, 'codex.sb')
    await writeFile(profile, sandboxPolicy({ executable: runtime.binary, workspace: confined, readFiles: [runtime.catalog, ...references], runtimeDirectories: [], networkPorts: [gateway.port] }), { flag: 'wx', mode: 0o600 })
    const launcher = join(root, 'launch-codex')
    await writeFile(launcher, `#!/bin/sh\nexec /usr/bin/sandbox-exec -f ${quote(profile)} ${quote(runtime.binary)} --strict-config "$@"\n`, { flag: 'wx', mode: 0o700 })
    const config = join(root, 'sdk.json')
    await writeFile(config, JSON.stringify({ timeMs: 120000, prompt, thread: { model: 'gpt-5.5', workingDirectory: workspace, skipGitRepoCheck: true, sandboxMode: 'read-only', approvalPolicy: 'never', webSearchMode: 'disabled' }, options: { codexPathOverride: launcher, env: { HOME: home, CODEX_HOME: codexHome, PATH: '/usr/bin:/bin', TMPDIR: workspace, POD_RUN_CAP: gateway.capability }, config: { model_provider: 'pod', model_providers: { pod: { name: 'Assigned pod provider', base_url: `http://127.0.0.1:${gateway.port}/v1`, wire_api: 'responses', requires_openai_auth: false, supports_websockets: false, env_key: 'POD_RUN_CAP', request_max_retries: 0, stream_max_retries: 0 } }, features: { ...Object.fromEntries(disabledFeatures.map(name => [name, false])), skip_host_skill_discovery: true }, mcp_servers: { pod: { url: `http://127.0.0.1:${gateway.port}/mcp`, http_headers: { Authorization: `Bearer ${gateway.capability}` }, enabled_tools: ['ape_shell'], required: true, tools: { ape_shell: { approval_mode: 'approve' } } } }, model_catalog_json: runtime.catalog, analytics: { enabled: false }, check_for_update_on_startup: false, project_doc_max_bytes: 0, shell_environment_policy: { inherit: 'none' } } } }), { flag: 'wx', mode: 0o600 })
    const domain = superviseProcess(runtime.helper, runtime.executable, [runtime.sdkHost, config], workspace, runtime.environment)
    const stop = () => domain.cancel(); signal.addEventListener('abort', stop, { once: true }); if (signal.aborted) stop()
    const deadline = setTimeout(stop, 125000)
    domain.channel.setEncoding('utf8')
    let terminal: { threadId: string, response: string } | undefined; let error: Error | undefined; let diagnostics = ''
    domain.stderr.on('data', (bytes) => { diagnostics = (diagnostics + bytes.toString()).slice(-4000) })
    const frames = (async () => {
      try {
        let buffer = ''
        for await (const bytes of domain.channel) {
          buffer += String(bytes)
          if (Buffer.byteLength(buffer) > 1024 * 1024) throw new Error('SDK frame exceeds its limit')
          for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
            const frame = JSON.parse(buffer.slice(0, newline)) as { type: string, event?: unknown, threadId?: string, response?: string, message?: string }; buffer = buffer.slice(newline + 1)
            if (terminal) throw new Error('SDK emitted data after completion')
            if (frame.type === 'event') event(frame.event)
            else if (frame.type === 'complete' && typeof frame.threadId === 'string' && typeof frame.response === 'string') terminal = { threadId: frame.threadId, response: frame.response }
            else if (frame.type === 'error') throw new Error(frame.message ?? 'SDK failed')
            else throw new Error('Invalid SDK frame')
          }
        }
        if (buffer) throw new Error('Truncated SDK frame')
      }
      catch (failure) { error = failure instanceof Error ? failure : new Error('Invalid SDK response'); stop() }
    })()
    try {
      await domain.processId; const code = await domain.completed; await frames; signal.throwIfAborted()
      if (error) throw error
      if (code !== 0 || !terminal) throw new Error(`SDK process did not complete (${code}): ${diagnostics}`)
      return terminal
    }
    finally { clearTimeout(deadline); signal.removeEventListener('abort', stop); stop(); await domain.completed; await frames }
  }
  finally { lifecycle.abort(new Error('Agent call ended')); await gateway.close() }
}
