// Which CLIs should the worker verify? Every command name the owner's team
// declares in cockpit_agents.tools — patterns like "gmail-cli *" or
// "o365-cli mail *" boil down to their first token. The worker resolves each
// via `command -v` in its real environment and reports back (issue #984:
// gmail-cli lived in ~/bin, the launchd worker PATH didn't — locally fine,
// worker exit 127, and nobody saw it until a task failed).
export function cliNamesFromToolPatterns(patterns: string[]): string[] {
  const names = new Set<string>()
  for (const pattern of patterns) {
    const first = pattern.trim().split(/\s+/)[0] ?? ''
    // '*' (all tools) and shell-ish tokens carry no checkable command name.
    if (!first || first === '*' || !/^[\w@./-]{1,64}$/.test(first)) continue
    names.add(first)
  }
  return [...names].sort()
}
