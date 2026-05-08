import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, normalize, resolve } from 'node:path'
import type { ToolDefinition } from './index'

const MAX_BYTES = 1024 * 1024

// All file ops are jailed inside the agent's $HOME. Path traversal
// (`..`) is blocked by resolving the requested path against the home
// dir and asserting the resolved path is still inside it.
function jailPath(input: unknown): string {
  if (typeof input !== 'string' || input === '') {
    throw new Error('path must be a non-empty string')
  }
  const home = homedir()
  // Treat input as relative to home unless it starts with $HOME.
  const candidate = input.startsWith('~/')
    ? resolve(home, input.slice(2))
    : input.startsWith('/')
      ? normalize(input)
      : resolve(home, input)
  if (candidate !== home && !candidate.startsWith(`${home}/`)) {
    throw new Error(`path "${input}" resolves outside the agent's home`)
  }
  return candidate
}

export const fileTools: ToolDefinition[] = [
  {
    name: 'file.read',
    description: 'Read a UTF-8 file from the agent\'s home directory ($HOME). Capped at 1MB. Path traversal blocked.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to $HOME (or absolute under $HOME). `..` segments are rejected.' },
      },
      required: ['path'],
    },
    execute: async (args: unknown) => {
      const a = args as { path: string }
      const p = jailPath(a.path)
      const content = readFileSync(p, 'utf8')
      if (Buffer.byteLength(content, 'utf8') > MAX_BYTES) {
        return { path: p, truncated: true, content: content.slice(0, MAX_BYTES) }
      }
      return { path: p, truncated: false, content }
    },
  },
  {
    name: 'file.write',
    description: 'Write a UTF-8 file under the agent\'s home directory. Creates parent dirs as needed. 1MB max.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to $HOME (or absolute under $HOME).' },
        content: { type: 'string', description: 'File body. Existing files are overwritten.' },
      },
      required: ['path', 'content'],
    },
    execute: async (args: unknown) => {
      const a = args as { path: string, content: string }
      if (typeof a.content !== 'string') throw new Error('content must be a string')
      if (Buffer.byteLength(a.content, 'utf8') > MAX_BYTES) {
        throw new Error(`content exceeds ${MAX_BYTES} byte cap`)
      }
      const p = jailPath(a.path)
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, a.content, { encoding: 'utf8' })
      return { path: p, bytes: Buffer.byteLength(a.content, 'utf8') }
    },
  },
]

export const _internal = { jailPath }
