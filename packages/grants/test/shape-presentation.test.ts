import { describe, expect, it } from 'vitest'
import { parseShapeCliVersions, parseShapePresentation, presentationBindings, readCliVersion } from '../src/shape-presentation.js'

const text = (de: string, en = de) => ({ de, en })

const declared = presentationBindings({
  positionals: ['remote', 'refspec', '=literal'],
  value_options: ['onto'],
  flag_options: ['force-with-lease'],
  global_options: ['C=repo', 'git-dir'],
})

const legacy = presentationBindings({ required_options: ['name'] })

const pushPresentation = {
  title: text('{refspec} nach {remote} pushen', 'Push {refspec} to {remote}'),
  statement: text('Schreibt auf den Server', 'Writes to the server'),
  consequence: { allows: text('Erlaubt genau diesen Push', 'Allows exactly this push'), does_not_allow: text('Kein anderer Push', 'No other push') },
  facts: [{ label: text('Repository'), binding: 'repo', format: 'code' }],
  details: [{ label: text('Ziel', 'Target'), binding: 'refspec' }],
  details_note: text('Angaben der Anwendung', 'Supplied by the application'),
}

describe('presentationBindings', () => {
  it('separates always-bound positionals from optional declared options, without literal positionals', () => {
    expect([...declared.always].sort()).toEqual(['refspec', 'remote'])
    expect([...declared.any!].sort()).toEqual(['force-with-lease', 'git-dir', 'onto', 'refspec', 'remote', 'repo'])
  })

  it('leaves optional bindings open under the legacy option rule', () => {
    expect(legacy).toEqual({ always: new Set(['name']), any: null })
  })
})

describe('parseShapePresentation', () => {
  it('accepts a target host requirement over always-bound bindings and refuses other bindings or keys', () => {
    const withTarget = { ...pushPresentation, requires: { target_host: 'git:{remote}' } }
    expect(parseShapePresentation(withTarget, 'Operation push', declared).requires).toEqual({ target_host: 'git:{remote}' })
    expect(() => parseShapePresentation({ ...pushPresentation, requires: { target_host: 'git:{onto}' } }, 'Operation push', declared)).toThrow(/does not always bind/)
    expect(() => parseShapePresentation({ ...pushPresentation, requires: { audience: 'x' } }, 'Operation push', declared)).toThrow(/unknown key/)
  })

  it('accepts a complete presentation and keeps it unchanged', () => {
    expect(parseShapePresentation(pushPresentation, 'Operation push', declared)).toEqual(pushPresentation)
  })

  it('accepts a title-only presentation and any field binding under the legacy rule', () => {
    const value = { title: text('{name}'), details: [{ label: text('Umgebung', 'Environment'), binding: 'environment', format: 'map' }] }
    expect(parseShapePresentation(value, 'Operation run', legacy)).toEqual(value)
    expect(() => parseShapePresentation({ title: text('{environment}') }, 'Operation run', legacy)).toThrow(/does not always bind/)
  })

  it.each([
    ['an unknown presentation key', { ...pushPresentation, risk: 'low' }, /unknown key\(s\): risk/],
    ['an unknown language', { title: { de: 'a', en: 'b', fr: 'c' } }, /title has unknown key\(s\): fr/],
    ['a missing language', { title: { de: 'a' } }, /title\.en must be a non-empty string/],
    ['a text that is no table', { title: 'Push' }, /title must be a table with de and en/],
    ['a presentation that is no table', 'Push', /presentation must be a table/],
    ['an unknown consequence key', { title: text('a'), consequence: { allows: text('a'), maybe: text('b') } }, /consequence has unknown key\(s\): maybe/],
    ['a consequence that is no table', { title: text('a'), consequence: 'a' }, /consequence must be a table/],
    ['a binding the operation never produces', { title: text('{branch}') }, /references \{branch\}, which the operation does not always bind/],
    ['an optional binding in a text', { title: text('a'), consequence: { allows: text('in {repo}') } }, /allows\.de references \{repo\}/],
    ['a placeholder inside a label', { title: text('a'), facts: [{ label: text('{repo}'), binding: 'repo' }] }, /label\.de references \{repo\}/],
    ['an unbalanced brace', { title: text('Push {remote') }, /unbalanced placeholder brace/],
    ['an invalid placeholder name', { title: text('Push {a b}') }, /invalid binding name/],
    ['a bidi override', { title: text('Push‮main') }, /control or format characters/],
    ['a line break', { title: text('Push\nmain') }, /control or format characters/],
    ['an overlong text', { title: text('x'.repeat(1001)) }, /longer than 1000/],
    ['a blank text', { title: text('  ') }, /non-empty string/],
    ['an empty facts list', { title: text('a'), facts: [] }, /facts must list 1–12 entries/],
    ['a fact that is no table', { title: text('a'), facts: ['repo'] }, /facts\[0\] must be a table/],
    ['an unknown fact key', { title: text('a'), facts: [{ label: text('a'), binding: 'repo', hidden: true }] }, /facts\[0\] has unknown key\(s\): hidden/],
    ['a fact without binding', { title: text('a'), facts: [{ label: text('a') }] }, /binding must be a string/],
    ['an unknown fact binding', { title: text('a'), details: [{ label: text('a'), binding: 'branch' }] }, /details\[0\]\.binding references \{branch\}/],
    ['an unknown format', { title: text('a'), facts: [{ label: text('a'), binding: 'repo', format: 'html' }] }, /format must be text, code or map/],
  ])('rejects %s', (_, value, message) => {
    expect(() => parseShapePresentation(value, 'Operation push', declared)).toThrow(message)
  })
})

describe('parseShapeCliVersions', () => {
  const versions = { tested_versions: ['2.54'], version_command: ['--version'], version_pattern: '^git version (\\d+\\.\\d+)' }

  it('returns undefined when no version field is set', () => {
    expect(parseShapeCliVersions({ id: 'x' }, 'Adapter cli')).toBeUndefined()
  })

  it('accepts the three fields together', () => {
    expect(parseShapeCliVersions(versions, 'Adapter cli')).toEqual(versions)
  })

  it.each([
    ['a partial declaration', { tested_versions: ['2.54'] }, /together/],
    ['an empty version list', { ...versions, tested_versions: [] }, /distinct version strings/],
    ['duplicate versions', { ...versions, tested_versions: ['2.54', '2.54'] }, /distinct version strings/],
    ['a version with spaces', { ...versions, tested_versions: ['cli 2.54'] }, /distinct version strings/],
    ['shell syntax in the probe', { ...versions, version_command: ['--version;', 'id'] }, /plain arguments/],
    ['a probe that is no list', { ...versions, version_command: '--version' }, /plain arguments/],
    ['an empty pattern', { ...versions, version_pattern: '' }, /must be a regular expression/],
    ['an invalid pattern', { ...versions, version_pattern: '(' }, /not a valid regular expression/],
    ['a pattern without capture group', { ...versions, version_pattern: '^x version' }, /capture group/],
  ])('rejects %s', (_, value, message) => {
    expect(() => parseShapeCliVersions(value, 'Adapter cli')).toThrow(message)
  })

  it('reads the probed version from the first capture group', () => {
    expect(readCliVersion(versions, 'git version 2.54.0 (Apple Git-157)\n')).toBe('2.54')
    expect(readCliVersion(versions, 'warning: x\ngit version 2.39.5\n')).toBe('2.39')
    expect(readCliVersion(versions, 'hub version 2.14')).toBeNull()
  })
})
