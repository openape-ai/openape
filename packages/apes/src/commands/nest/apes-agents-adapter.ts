// Bundled `apes-agents` shapes adapter — written into
// ~/.openape/shapes/adapters/apes-agents.toml by `apes nest install`.
// Inlined as a TS constant (vs. shipping the .toml file) because tsup
// only bundles JS/TS — a sibling .toml gets stripped from dist.

export const APES_AGENTS_ADAPTER_TOML = `schema = "openape-shapes/v1"

# Adapter for the \`apes agents\` subtree — written by \`apes nest install\`.
# A capability-grant with selector \`name=*\` covers any agent name
# (selectorValueMatches treats '*' as a glob), letting the nest spawn
# and destroy without per-agent DDISA prompts.

[cli]
id = "apes-agents"
executable = "apes"
audience = "shapes"
version = "1"

# ══════════════════════════════════════════════════════
# AGENT LIFECYCLE — spawn / destroy / sync
# ══════════════════════════════════════════════════════

[[operation]]
id = "agents.spawn"
command = ["agents", "spawn"]
positionals = ["name"]
display = "Spawn agent {name}"
action = "create"
risk = "high"
resource_chain = ["agents:name={name}"]

[[operation]]
id = "agents.destroy"
command = ["agents", "destroy"]
positionals = ["name"]
display = "Destroy agent {name}"
action = "delete"
risk = "critical"
resource_chain = ["agents:name={name}"]

[[operation]]
id = "agents.sync"
command = ["agents", "sync"]
display = "Sync agent state with troop"
action = "edit"
risk = "low"
resource_chain = ["agents:*"]

[[operation]]
id = "agents.list"
command = ["agents", "list"]
display = "List agents"
action = "list"
risk = "low"
resource_chain = ["agents:*"]

[[operation]]
id = "agents.allow"
command = ["agents", "allow"]
positionals = ["name", "peer_email"]
display = "Allow agent {name} to accept contact requests from {peer_email}"
action = "edit"
risk = "medium"
resource_chain = ["agents:name={name}", "allowlist:email={peer_email}"]
`
