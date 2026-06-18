import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildInvocation,
  buildOpenclawConfig,
  buildWorkspaceFiles,
  invokeOpenclaw,
  openclawPaths,
  parseReply,
  prepareOpenclawHome,
} from '../src/lib/openclaw-adapter'

const agent = { name: 'test-ceo', email: 'test-ceo-mac+p+h+eco@id.openape.ai', home: '/home/test-ceo' }
const rt = { apiBase: 'https://llms.openape.ai/v1', apiKey: 'sk-key', model: 'gpt-5.5', systemPrompt: 'You are the CEO.' }

describe('buildOpenclawConfig', () => {
  it('points the openape provider at the gateway and selects openape/<model>', () => {
    const cfg = buildOpenclawConfig(agent, rt) as any
    expect(cfg.models.providers.openape.baseUrl).toBe('https://llms.openape.ai/v1')
    expect(cfg.models.providers.openape.apiKey).toBe('sk-key')
    // openclaw schema: provider.models are {id, api} objects, not bare strings.
    expect(cfg.models.providers.openape.models[0]).toEqual({ id: 'gpt-5.5', name: 'gpt-5.5', api: 'openai-completions' })
    expect(cfg.agents.list[0].model).toBe('openape/gpt-5.5')
    expect(cfg.agents.list[0].tools.allow).toContain('exec')
    // reasoningDefault off — avoids the gateway tools+reasoning→/responses 404.
    expect(cfg.agents.defaults.reasoningDefault).toBe('off')
    expect(cfg.agents.defaults.skipBootstrap).toBe(true)
  })
})

describe('buildWorkspaceFiles', () => {
  it('uses the persona as SOUL and names the CLIs as tools in AGENTS', () => {
    const files = buildWorkspaceFiles(agent, rt)
    expect(files['SOUL.md']).toContain('You are the CEO.')
    expect(files['AGENTS.md']).toContain(agent.email)
    expect(files['AGENTS.md']).toContain('ape-tasks')
    expect(files['IDENTITY.md']).toContain('test-ceo')
  })
})

describe('buildInvocation', () => {
  it('runs one local turn with a per-thread session key and home-scoped config', () => {
    const { args, env } = buildInvocation(agent, rt, 'hello', 'room1:thread1')
    expect(args).toContain('--local')
    expect(args).toContain('--json')
    expect(args).toEqual(expect.arrayContaining(['--message', 'hello']))
    expect(args).toEqual(expect.arrayContaining(['--session-key', 'agent:test-ceo:room1:thread1']))
    expect(args).toEqual(expect.arrayContaining(['--model', 'openape/gpt-5.5']))
    expect(env.OPENCLAW_CONFIG_PATH).toBe(openclawPaths(agent.home).configPath)
    expect(env.HOME).toBe('/home/test-ceo')
  })
})

describe('parseReply', () => {
  it('extracts the assistant text from openclaw --json output', () => {
    // openclaw 2026.6.x shape: { payloads: [{ text }], meta }
    expect(parseReply('{"payloads":[{"text":"PROOF-OK: reply.","mediaUrl":null}],"meta":{}}')).toBe('PROOF-OK: reply.')
    // older/other shapes still handled
    expect(parseReply('{"reply":"hi there"}')).toBe('hi there')
    expect(parseReply('noise\n{"text":"  spaced  "}\nmore')).toBe('spaced')
  })
  it('falls back to raw stdout when not JSON', () => {
    expect(parseReply('plain text reply')).toBe('plain text reply')
  })
})

describe('invokeOpenclaw', () => {
  it('runs via the injected runAs and returns the parsed reply', async () => {
    let captured: { args: string[], env: Record<string, string> } | undefined
    const reply = await invokeOpenclaw(agent, rt, 'hello there', 'room1:thread1', {
      runAs: async (args, env) => {
        captured = { args, env }
        return { stdout: '{"payloads":[{"text":"hi from openclaw"}],"meta":{}}' }
      },
    })
    expect(reply).toBe('hi from openclaw')
    expect(captured!.args).toEqual(expect.arrayContaining(['--message', 'hello there']))
    expect(captured!.args).toEqual(expect.arrayContaining(['--session-key', 'agent:test-ceo:room1:thread1']))
    expect(captured!.env.OPENCLAW_CONFIG_PATH).toBe(openclawPaths(agent.home).configPath)
  })
})

describe('prepareOpenclawHome', () => {
  it('writes config + workspace bootstrap files into the home', () => {
    const home = mkdtempSync(join(tmpdir(), 'ocl-'))
    const a = { ...agent, home }
    prepareOpenclawHome(a, rt)
    const { configPath, workspace } = openclawPaths(home)
    const cfg = JSON.parse(readFileSync(configPath, 'utf8'))
    expect(cfg.agents.list[0].id).toBe('test-ceo')
    expect(readFileSync(join(workspace, 'SOUL.md'), 'utf8')).toContain('You are the CEO.')
    expect(readFileSync(join(workspace, 'AGENTS.md'), 'utf8')).toContain('ape-troop')
  })
})
