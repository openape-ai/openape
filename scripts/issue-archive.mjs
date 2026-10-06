#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { createArchiveProxy } from './native-issues/archive-proxy.mjs'

const [flag, path, ...extra] = process.argv.slice(2)
if (flag !== '--config' || !path || extra.length) throw new Error('Usage: node scripts/issue-archive.mjs --config REVIEWED_CONFIG.json')
const config = JSON.parse(readFileSync(path, 'utf8'))
if (!['127.0.0.1', '10.0.1.1'].includes(config.listenAddress) || !Number.isSafeInteger(config.listenPort) || config.listenPort < 1024 || config.listenPort > 65535) throw new Error('Explicit private listen address and unprivileged port required')
if (!Array.isArray(config.actors) || config.actors.some(actor => !Number.isSafeInteger(actor.id) || actor.id < 1 || typeof actor.login !== 'string' || !/^[\w.-]+$/.test(actor.login))) throw new Error('Reviewed source actor IDs and logins are required')
if (!Array.isArray(config.comments) || config.comments.some(id => !Number.isSafeInteger(id) || id < 1)) throw new Error('Reviewed source comment IDs are required')
const server = createArchiveProxy({ ...config, ...(config.legacyPageFile ? { legacyPage: readFileSync(config.legacyPageFile, 'utf8') } : {}) })
server.listen(config.listenPort, config.listenAddress, () => console.log(JSON.stringify({ listening: true, repository: config.repository, writes: 'fenced' })))
process.on('SIGTERM', () => { server.close(); server.closeIdleConnections() })
