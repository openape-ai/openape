import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import { it } from 'node:test'
import { portCollisions } from './doctor.mjs'

it('doctor identifies actual shared explicit ports and excludes build watchers', () => {
  const collisions = portCollisions([
    { name: 'plans', scripts: { dev: 'nuxt dev --port 3004' } },
    { name: 'tasks', scripts: { dev: 'nuxt dev --port=3004' } },
    { name: 'cli', scripts: { dev: 'tsup --watch' } },
    { name: 'git', scripts: { dev: 'nuxt dev --port 3026' } },
  ])
  assert.deepEqual(collisions, [{ port: 3004, workspaces: ['plans', 'tasks'] }])
})
