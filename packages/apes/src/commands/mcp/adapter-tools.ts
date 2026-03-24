import { readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { loadAdapter } from '@openape/shapes'
import type { ShapesOperation } from '@openape/shapes'

export interface AdapterToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  adapterId: string
  operationId: string
}

function operationToInputSchema(op: ShapesOperation): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []

  if (op.positionals) {
    for (const pos of op.positionals) {
      properties[pos] = { type: 'string', description: `Positional argument: ${pos}` }
      required.push(pos)
    }
  }

  if (op.required_options) {
    for (const opt of op.required_options) {
      const name = opt.replace(/^--/, '')
      properties[name] = { type: 'string', description: `Required option: ${opt}` }
      required.push(name)
    }
  }

  return {
    type: 'object',
    properties,
    required: required.length > 0 ? required : undefined,
  }
}

function scanAdapterDir(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter(f => f.endsWith('.toml'))
      .map(f => f.replace('.toml', ''))
  }
  catch {
    return []
  }
}

export function loadAdapterTools(): AdapterToolDef[] {
  const tools: AdapterToolDef[] = []
  const seen = new Set<string>()

  const adapterDirs = [
    join(process.cwd(), '.openape', 'shapes', 'adapters'),
    join(homedir(), '.openape', 'shapes', 'adapters'),
    '/etc/openape/shapes/adapters',
  ]

  for (const dir of adapterDirs) {
    for (const id of scanAdapterDir(dir)) {
      if (seen.has(id))
        continue
      seen.add(id)

      try {
        const loaded = loadAdapter(id)
        for (const op of loaded.adapter.operations) {
          tools.push({
            name: `apes.run.${id}.${op.id}`,
            description: op.display || `${id}: ${op.id}`,
            inputSchema: operationToInputSchema(op),
            adapterId: id,
            operationId: op.id,
          })
        }
      }
      catch {
        // Skip adapters that fail to load
      }
    }
  }

  return tools
}
