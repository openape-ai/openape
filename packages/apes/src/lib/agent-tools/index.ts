// Built-in tool registry shipped with the apes binary. Each tool is
// (a) an OpenAI tool-spec object (used as-is in the LiteLLM call's
// `tools[]` parameter) and (b) an `execute` function called when the
// model emits a `tool_calls` entry. Adding a new tool means
// implementing it here AND adding an entry to
// apps/openape-troop/server/tool-catalog.json so the SP validates
// task specs against the same allowlist.
//
// The registry is keyed by string name (`time.now`, `http.get`, …).
// `taskTools(spec.tools)` resolves a task's tool list to the slice of
// the registry it can use. Unknown names abort the run before any
// LLM call so the model can't invent a tool we haven't shipped.

import { fileTools } from './file'
import { httpTools } from './http'
import { mailTools } from './mail'
import { tasksTools } from './tasks'
import { timeTools } from './time'

export interface ToolDefinition {
  name: string
  description: string
  // OpenAI tool-spec shape: { type: 'object', properties: …, required: … }.
  // We don't constrain it further — the LLM's job to fill it in.
  parameters: Record<string, unknown>
  execute: (args: unknown) => Promise<unknown>
}

const ALL_TOOLS: ToolDefinition[] = [
  ...timeTools,
  ...httpTools,
  ...fileTools,
  ...tasksTools,
  ...mailTools,
]

export const TOOLS: Record<string, ToolDefinition> = Object.fromEntries(
  ALL_TOOLS.map(t => [t.name, t]),
)

/**
 * Resolve a task spec's tool name list to ToolDefinitions. Throws on
 * unknown names — callers must surface that as a run-failure with a
 * clear "unknown tool: foo" final_message so the owner can see what
 * went wrong in the SP UI.
 */
export function taskTools(names: string[]): ToolDefinition[] {
  const out: ToolDefinition[] = []
  const missing: string[] = []
  for (const name of names) {
    const tool = TOOLS[name]
    if (!tool) missing.push(name)
    else out.push(tool)
  }
  if (missing.length > 0) {
    throw new Error(`unknown tool(s): ${missing.join(', ')}`)
  }
  return out
}

/**
 * Format the registry slice as the OpenAI `tools` param. Strips the
 * `execute` function — only the spec part goes to the LLM.
 */
export function asOpenAiTools(tools: ToolDefinition[]): { type: 'function', function: Omit<ToolDefinition, 'execute'> }[] {
  return tools.map(t => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }))
}
