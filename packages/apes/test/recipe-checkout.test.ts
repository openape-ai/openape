import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureRecipeCheckout } from '../src/lib/recipe-checkout'

let base: string
let recipeDir: string
let calls: Array<{ file: string, args: string[] }>

function fakeExec(file: string, args?: readonly string[]): Buffer {
  const argv = [...(args ?? [])]
  calls.push({ file, args: argv })
  // Faithfully model `git clone <url> <dir>`: the target dir is the last
  // arg and the real command creates it. Without this the marker write
  // would have no parent dir.
  const target = argv.at(-1)
  if (file === 'git' && argv[0] === 'clone' && target) mkdirSync(target, { recursive: true })
  return Buffer.from('')
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'apes-recipe-'))
  recipeDir = join(base, 'recipe')
  calls = []
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

describe('ensureRecipeCheckout', () => {
  it('clones with --depth 1 --branch <ref> and writes the marker on a fresh dir', () => {
    ensureRecipeCheckout('openape-ai/service-agent@v0.1.0', recipeDir, fakeExec)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.file).toBe('git')
    expect(calls[0]!.args).toEqual([
      'clone',
      '--depth',
      '1',
      '--branch',
      'v0.1.0',
      'https://github.com/openape-ai/service-agent',
      recipeDir,
    ])
    expect(readFileSync(join(recipeDir, '.recipe-ref'), 'utf8')).toBe('openape-ai/service-agent@v0.1.0')
  })

  it('strips a leading github.com/ from the slug', () => {
    ensureRecipeCheckout('github.com/openape-ai/service-agent@v0.1.0', recipeDir, fakeExec)
    expect(calls[0]!.args).toContain('https://github.com/openape-ai/service-agent')
  })

  it('is a no-op when the marker already equals the recipeRef', () => {
    // Pre-create the recipe dir with a matching marker.
    mkdirSync(recipeDir, { recursive: true })
    writeFileSync(join(recipeDir, '.recipe-ref'), 'openape-ai/service-agent@v0.1.0')

    ensureRecipeCheckout('openape-ai/service-agent@v0.1.0', recipeDir, fakeExec)

    expect(calls).toHaveLength(0)
  })

  it('re-clones when the marker is for a different ref', () => {
    mkdirSync(recipeDir, { recursive: true })
    writeFileSync(join(recipeDir, '.recipe-ref'), 'openape-ai/service-agent@v0.0.9')

    ensureRecipeCheckout('openape-ai/service-agent@v0.1.0', recipeDir, fakeExec)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.args).toContain('--branch')
    expect(calls[0]!.args).toContain('v0.1.0')
    expect(readFileSync(join(recipeDir, '.recipe-ref'), 'utf8')).toBe('openape-ai/service-agent@v0.1.0')
  })

  it('splits on the LAST @ so refs containing @ survive', () => {
    ensureRecipeCheckout('owner/name@sha-with@in-ref', recipeDir, fakeExec)
    expect(calls[0]!.args).toEqual([
      'clone',
      '--depth',
      '1',
      '--branch',
      'in-ref',
      'https://github.com/owner/name@sha-with',
      recipeDir,
    ])
  })

  it('does not clone or throw on a malformed ref (no @)', () => {
    expect(() => ensureRecipeCheckout('openape-ai/service-agent', recipeDir, fakeExec)).not.toThrow()
    expect(calls).toHaveLength(0)
  })

  it('does not clone or throw when the slug is empty', () => {
    expect(() => ensureRecipeCheckout('@v0.1.0', recipeDir, fakeExec)).not.toThrow()
    expect(calls).toHaveLength(0)
  })

  it('does not clone or throw when the ref is empty', () => {
    expect(() => ensureRecipeCheckout('owner/name@', recipeDir, fakeExec)).not.toThrow()
    expect(calls).toHaveLength(0)
  })

  it('never throws when the clone command fails (broken recipe must not crash sync)', () => {
    const throwingExec = (): Buffer => {
      throw new Error('fatal: repository not found')
    }
    expect(() => ensureRecipeCheckout('openape-ai/missing@v9', recipeDir, throwingExec)).not.toThrow()
    // No marker written on failure → next sync retries.
    expect(existsSync(join(recipeDir, '.recipe-ref'))).toBe(false)
  })
})
