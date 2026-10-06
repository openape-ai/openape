import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import { it } from 'node:test'
import { portCollisions, requiredStackServices } from './doctor.mjs'

it('doctor identifies actual shared explicit ports and excludes build watchers', () => {
  const collisions = portCollisions([
    { name: 'plans', scripts: { dev: 'nuxt dev --port 3004' } },
    { name: 'tasks', scripts: { dev: 'nuxt dev --port=3004' } },
    { name: 'cli', scripts: { dev: 'tsup --watch' } },
    { name: 'git', scripts: { dev: 'nuxt dev --port 3026' } },
  ])
  assert.deepEqual(collisions, [{ port: 3004, workspaces: ['plans', 'tasks'] }])
})

it('doctor derives required services from the actual stack and includes the selected app', () => {
  const services = { dns: {}, proxy: {}, idp: {}, tasks: { build: { args: { APP_FILTER: '@openape-tasks/app' } } }, docs: { build: { args: { APP_FILTER: 'docs' } } }, driver: { profiles: ['demo'] } }
  assert.deepEqual(requiredStackServices(services).required, ['dns', 'proxy', 'idp', 'tasks', 'docs'])
  assert.deepEqual(requiredStackServices(services, '@openape-tasks/app'), { required: ['dns', 'proxy', 'idp', 'tasks'], appService: 'tasks' })
  assert.deepEqual(requiredStackServices(services, 'docs').required, ['dns', 'proxy', 'docs'])
  assert.equal(requiredStackServices(services, '@openape-git/app').appService, null)
})
