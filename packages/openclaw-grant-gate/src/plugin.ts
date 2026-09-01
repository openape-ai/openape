import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry'
import {  readGateConfig } from './config.js'
import type { GateConfig } from './config.js'
import { decideExec } from './wrap.js'

/**
 * OpenClaw entry point. Deliberately thin: every decision lives in pure
 * modules that are unit-tested, because this file's imports cannot be resolved
 * outside a host with OpenClaw installed.
 *
 * Config is read from `api.pluginConfig` at registration, not from
 * `event.context.pluginConfig`. The plugin-hooks documentation promises the
 * latter, but `runBeforeToolCall` in OpenClaw 2026.8.1 never injects it —
 * `pluginConfig` appears only on the legacy internal-hooks path, so reading it
 * off the event yields `undefined` and every call fails closed with an
 * unhelpful "hook failed".
 */
export default definePluginEntry({
  id: 'openape-grant-gate',
  name: 'OpenApe Grant Gate',
  description: 'Routes every agent exec through the DDISA grant flow',
  register(api) {
    let config: GateConfig | undefined
    let configError: string | undefined
    try {
      config = readGateConfig(api.pluginConfig)
    }
    catch (err) {
      // A broken identity map must not take the gate offline silently, and it
      // must not let commands through either: keep the hook registered so it
      // can refuse every call and say why.
      configError = err instanceof Error ? err.message : String(err)
      api.logger?.error?.(`openape-grant-gate: disabled by config error — ${configError}`)
    }

    api.on(
      'before_tool_call',
      (event, ctx) => {
        if (event.toolName !== 'exec') return
        if (config === undefined) {
          return { block: true, blockReason: `openape-grant-gate: misconfigured, exec blocked. ${configError}` }
        }

        const decision = decideExec({ agentId: ctx?.agentId, command: event.params?.command, config })
        if (decision.kind === 'block') return { block: true, blockReason: decision.reason }
        if (decision.kind === 'rewrite') return { params: { ...event.params, command: decision.command } }
      },
      { matcher: ['exec'], priority: 100 },
    )
  },
})
