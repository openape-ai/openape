import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BASH_VIA_APE_SHELL_HOOK_SOURCE } from '../src/lib/agent-bootstrap'

/**
 * Behavioral tests for the Claude Code PreToolUse Bash hook. The hook is
 * what makes spawned agents safe — every `bash -c <cmd>` claude tries to
 * run gets rewritten to `ape-shell -c <cmd>` so it goes through the grant
 * flow instead of executing freely. The drift test next door
 * (agents-bash-hook-source.test.ts) only proves the source file matches
 * the inlined string. This file proves the source actually does what we
 * claim it does: read tool_input.command from stdin, emit a hookSpecific
 * Output that swaps the command for the wrapped form.
 *
 * We materialize the hook to a tempdir, pipe synthetic JSON to it via
 * spawnSync, and assert the JSON it writes back matches the hookSpecific
 * Output schema Claude expects.
 */
describe('bash-via-ape-shell hook: behavior', () => {
  let scriptPath: string
  let tmp: string

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'apes-bash-hook-'))
    scriptPath = join(tmp, 'bash-via-ape-shell.sh')
    writeFileSync(scriptPath, BASH_VIA_APE_SHELL_HOOK_SOURCE, { mode: 0o755 })
    chmodSync(scriptPath, 0o755)
  })

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  function runHook(input: unknown): { code: number, stdout: string, stderr: string } {
    const res = spawnSync('bash', [scriptPath], {
      input: JSON.stringify(input),
      encoding: 'utf-8',
    })
    return { code: res.status ?? -1, stdout: res.stdout, stderr: res.stderr }
  }

  it('rewrites a plain command to `ape-shell -c <quoted>`', () => {
    const { code, stdout } = runHook({ tool_input: { command: 'ls /etc' } })
    expect(code).toBe(0)
    const out = JSON.parse(stdout)
    expect(out.hookSpecificOutput.hookEventName).toBe('PreToolUse')
    expect(out.hookSpecificOutput.updatedToolInput.command).toBe(`ape-shell -c 'ls /etc'`)
  })

  it('quotes commands containing single quotes safely', () => {
    const { code, stdout } = runHook({ tool_input: { command: `echo 'hi from claude'` } })
    expect(code).toBe(0)
    const out = JSON.parse(stdout)
    // shlex.quote escapes ' by closing the quote, inserting \', reopening
    expect(out.hookSpecificOutput.updatedToolInput.command).toBe(
      `ape-shell -c 'echo '"'"'hi from claude'"'"''`,
    )
  })

  it('preserves compound commands as a single wrapped string', () => {
    const { code, stdout } = runHook({ tool_input: { command: 'cd /tmp && ls && echo done' } })
    expect(code).toBe(0)
    const out = JSON.parse(stdout)
    expect(out.hookSpecificOutput.updatedToolInput.command).toBe(
      `ape-shell -c 'cd /tmp && ls && echo done'`,
    )
  })

  it('handles commands with backslashes and special chars', () => {
    const { code, stdout } = runHook({ tool_input: { command: `grep -E '\\d+' /tmp/x` } })
    expect(code).toBe(0)
    const out = JSON.parse(stdout)
    // Whole original goes inside the outer single-quoted ape-shell -c arg;
    // shlex handles the embedded quotes by escaping, never unwrapping.
    const wrapped = out.hookSpecificOutput.updatedToolInput.command as string
    expect(wrapped.startsWith(`ape-shell -c '`)).toBe(true)
    expect(wrapped.endsWith(`'`)).toBe(true)
  })

  it('handles a 10 KB command without truncating', () => {
    const long = `echo ${'x'.repeat(10_000)}`
    const { code, stdout } = runHook({ tool_input: { command: long } })
    expect(code).toBe(0)
    const out = JSON.parse(stdout)
    const wrapped = out.hookSpecificOutput.updatedToolInput.command as string
    expect(wrapped).toContain('x'.repeat(10_000))
    expect(wrapped.startsWith(`ape-shell -c 'echo `)).toBe(true)
  })

  it('emits valid JSON even for empty command (claude shouldn\'t send this, but be defensive)', () => {
    const { code, stdout } = runHook({ tool_input: { command: '' } })
    expect(code).toBe(0)
    const out = JSON.parse(stdout)
    expect(out.hookSpecificOutput.updatedToolInput.command).toBe(`ape-shell -c ''`)
  })

  it('settings.json registers the hook for the Bash tool with PreToolUse', async () => {
    const { CLAUDE_SETTINGS_JSON } = await import('../src/lib/agent-bootstrap')
    const parsed = JSON.parse(CLAUDE_SETTINGS_JSON)
    expect(parsed.hooks.PreToolUse).toBeDefined()
    const bashHook = parsed.hooks.PreToolUse.find((h: { matcher: string }) => h.matcher === 'Bash')
    expect(bashHook).toBeDefined()
    expect(bashHook.hooks[0].type).toBe('command')
    expect(bashHook.hooks[0].command).toBe('$HOME/.claude/hooks/bash-via-ape-shell.sh')
  })
})
