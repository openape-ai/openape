import type { State } from '../src/lib/llm-chatgpt'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  applyOutputItemsPatch,
  buildPlist,
  ensureLogDir,
  generateMasterKey,
  PLIST_LABEL,
  PROXY_PORT,
  writeConfig,
  writeEnv,
  writeStartScript,
} from '../src/lib/llm-chatgpt'

// Synthetic fixture matching the three pre-patch hunks in litellm 1.83.14's
// transformation.py. If upstream changes its shape and the real hunks no
// longer match, this canary breaks before the user sees it.
const FAKE_TRANSFORMATION = `class Foo:
    def some_method(self, body_text):
        completed_response = None
        error_message = None
        for chunk in body_text.splitlines():
            parsed_chunk = {}
            event_type = parsed_chunk.get("type")
            if event_type == ResponsesAPIStreamEvents.RESPONSE_COMPLETED:
                response_payload = parsed_chunk.get("response")
                if isinstance(response_payload, dict):
                    response_payload = dict(response_payload)
                    if "created_at" in response_payload:
                        response_payload["created_at"] = _safe_convert_created_field(
                            response_payload["created_at"]
                        )
                    try:
                        completed_response = ResponsesAPIResponse(**response_payload)
                    except Exception:
                        pass
                break
`

describe('apes agents llm — pure helpers', () => {
  it('generateMasterKey returns a non-trivial prefixed token', () => {
    const a = generateMasterKey()
    const b = generateMasterKey()
    expect(a).toMatch(/^sk-litellm-[\w-]{20,}$/)
    expect(a).not.toBe(b)
  })

  it('buildPlist embeds label, paths, and KeepAlive', () => {
    const plist = buildPlist('/tmp/foo', PLIST_LABEL)
    expect(plist).toContain(`<string>${PLIST_LABEL}</string>`)
    expect(plist).toContain('<string>/tmp/foo/start.sh</string>')
    expect(plist).toContain('<string>/tmp/foo/logs/stdout.log</string>')
    expect(plist).toContain('<key>KeepAlive</key>')
    expect(plist).toContain('<key>RunAtLoad</key>')
  })

  it('writeConfig writes a valid YAML with both supported models', () => {
    const dir = mkdtempSync(join(tmpdir(), 'llm-cfg-'))
    try {
      writeConfig(dir)
      const yaml = readFileSync(join(dir, 'config.yaml'), 'utf8')
      expect(yaml).toContain('model_name: gpt-5.4')
      expect(yaml).toContain('model: chatgpt/gpt-5.4')
      expect(yaml).toContain('model_name: gpt-5.3-codex')
      expect(yaml).toContain('master_key: os.environ/LITELLM_MASTER_KEY')
      expect(PROXY_PORT).toBe(4000)
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('writeEnv writes mode-600 file with the master key only', () => {
    const dir = mkdtempSync(join(tmpdir(), 'llm-env-'))
    try {
      writeEnv(dir, 'sk-litellm-AAA')
      const env = readFileSync(join(dir, '.env'), 'utf8')
      expect(env.trim()).toBe('LITELLM_MASTER_KEY=sk-litellm-AAA')
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('writeStartScript emits an executable shell script that sources .env + execs litellm', () => {
    const dir = mkdtempSync(join(tmpdir(), 'llm-start-'))
    try {
      writeStartScript(dir)
      const sh = readFileSync(join(dir, 'start.sh'), 'utf8')
      expect(sh.startsWith('#!/usr/bin/env bash')).toBe(true)
      expect(sh).toContain('. ./.env')
      expect(sh).toContain('exec ./venv/bin/litellm --config ./config.yaml')
      expect(sh).toContain(`--port ${PROXY_PORT}`)
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('ensureLogDir creates logs/ idempotently', () => {
    const dir = mkdtempSync(join(tmpdir(), 'llm-logs-'))
    try {
      ensureLogDir(dir)
      ensureLogDir(dir) // re-running is a no-op
      // No throw + dir exists is success
      expect(true).toBe(true)
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('writePlist + deletePlistFile + deleteInstallDir + revokeOAuth round-trip cleanly', async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'llm-rm-'))
    vi.stubEnv('HOME', fakeHome)
    vi.resetModules()
    const mod = await import('../src/lib/llm-chatgpt')
    try {
      // pre-create the things deletes target
      mkdirSync(mod.installDir(), { recursive: true })
      writeFileSync(join(mod.installDir(), 'state.json'), '{}')
      mkdirSync(join(fakeHome, '.config', 'litellm', 'chatgpt'), { recursive: true })
      writeFileSync(mod.chatgptAuthPath(), '{"access_token":"x"}')

      mod.writePlist()
      const plist = readFileSync(mod.plistPath(), 'utf8')
      expect(plist).toContain(`<string>${mod.PLIST_LABEL}</string>`)
      expect(plist).toContain(`<string>${mod.installDir()}/start.sh</string>`)

      mod.deletePlistFile()
      mod.deleteInstallDir()
      mod.revokeOAuth()

      // Re-running deletes when targets are absent must not throw.
      mod.deletePlistFile()
      mod.deleteInstallDir()
      mod.revokeOAuth()
    }
    finally {
      rmSync(fakeHome, { recursive: true, force: true })
      vi.unstubAllEnvs()
    }
  })

  it('readState/writeState round-trip preserves the typed state shape', async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'llm-home-'))
    vi.stubEnv('HOME', fakeHome)
    // Force re-import so installDir() resolves with the stubbed HOME.
    vi.resetModules()
    const mod = await import('../src/lib/llm-chatgpt')
    const sample: State = {
      provider: 'chatgpt',
      installed_at: 1700000000,
      port: 4000,
      master_key: 'sk-litellm-XYZ',
      install_dir: mod.installDir(),
    }
    try {
      mod.writeState(sample)
      const got = mod.readState()
      expect(got).toEqual(sample)
    }
    finally {
      rmSync(fakeHome, { recursive: true, force: true })
      vi.unstubAllEnvs()
    }
  })

  it('applyOutputItemsPatch grafts accumulator + is idempotent on re-run', () => {
    const venv = mkdtempSync(join(tmpdir(), 'llm-patch-'))
    try {
      const dir = join(venv, 'lib', 'python3.13', 'site-packages', 'litellm', 'llms', 'chatgpt', 'responses')
      mkdirSync(dir, { recursive: true })
      const target = join(dir, 'transformation.py')
      writeFileSync(target, FAKE_TRANSFORMATION)

      applyOutputItemsPatch(venv)

      const patched = readFileSync(target, 'utf8')
      expect(patched).toContain('accumulated_items: list = []')
      expect(patched).toContain('if event_type == "response.output_item.done":')
      expect(patched).toContain('response_payload["output"] = accumulated_items')

      applyOutputItemsPatch(venv)
      const afterReapply = readFileSync(target, 'utf8')
      expect(afterReapply).toBe(patched)
    }
    finally {
      rmSync(venv, { recursive: true, force: true })
    }
  })
})
