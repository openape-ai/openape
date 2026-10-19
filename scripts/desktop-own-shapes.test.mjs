// The seed marks exactly the Pods desktop operations as virtual (issue 1473) —
// run with:  node --test scripts/desktop-own-shapes.test.mjs

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import { it } from 'node:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { desktopOwnShapeIds, markDesktopOwnShapes, selectShapesForSeed } from './desktop-own-shapes.mjs'

const shape = cliId => ({ cli_id: cliId, executable: cliId, operations: [] })
const registry = ['git', 'gh', 'o365-cli', 'pod-http', 'pod-runtime', 'pod-ssh'].map(shape)

it('lists the Pods desktop operations and nothing else', () => {
  assert.deepEqual([...desktopOwnShapeIds()].sort(), ['pod-http', 'pod-runtime', 'pod-ssh'])
})

it('marks exactly the desktop-own shapes virtual', () => {
  const marked = markDesktopOwnShapes(registry)
  assert.deepEqual(marked.filter(item => item.virtual === true).map(item => item.cli_id).sort(), ['pod-http', 'pod-runtime', 'pod-ssh'])
  assert.deepEqual(marked.filter(item => item.virtual !== true).map(item => item.cli_id), ['git', 'gh', 'o365-cli'])
})

it('fails instead of leaving a desktop-own operation unmarked', () => {
  assert.throws(() => markDesktopOwnShapes(registry.filter(item => item.cli_id !== 'pod-ssh')), /pod-ssh/)
  const directory = mkdtempSync(join(tmpdir(), 'desktop-own-'))
  try {
    for (const content of ['{"cli_ids":[]}', '{"cli_ids":["pod-runtime",""]}', '{}']) {
      const file = join(directory, 'list.json')
      writeFileSync(file, content)
      assert.throws(() => desktopOwnShapeIds(pathToFileURL(file)), /cli_ids/)
    }
  }
  finally { rmSync(directory, { recursive: true, force: true }) }
})

it('selects only explicitly named adapters after validating the complete registry', () => {
  const marked = markDesktopOwnShapes(registry)
  assert.equal(selectShapesForSeed(marked, undefined), marked)
  assert.deepEqual(selectShapesForSeed(marked, 'o365-cli').map(item => item.cli_id), ['o365-cli'])
  assert.deepEqual(selectShapesForSeed(marked, 'pod-ssh,git').map(item => item.cli_id), ['git', 'pod-ssh'])
  assert.equal(selectShapesForSeed(marked, 'pod-ssh')[0].virtual, true)
  assert.throws(() => selectShapesForSeed(markDesktopOwnShapes(registry.filter(item => item.cli_id !== 'pod-ssh')), 'git'), /pod-ssh/)
})

it('refuses empty, duplicate, unknown and malformed seed selections', () => {
  for (const ids of ['', ',', 'git,', ',git', 'git,git', 'git,missing', ' git', 'git, pod-ssh', 'Git'])
    assert.throws(() => selectShapesForSeed(registry, ids), /SHAPES_CLI_IDS/)
})
