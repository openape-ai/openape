// Library entrypoint: exposes the agent runtime so other packages (the nest's
// in-process SessionHost) can construct an agent session directly instead of
// spawning the `ape-agent` bin as a child process. The bin entrypoints
// (bridge.ts, service-bridge-main.ts) stay the published CLIs; this adds an
// importable surface alongside them.

export { AgentSession } from './agent-session'
export type { TroopChatFrame } from './agent-session'
export { readConfig } from './bridge-config'
export type { BridgeConfig } from './bridge-config'
export { readAgentIdentity } from './identity'
export type { AgentIdentity } from './identity'
