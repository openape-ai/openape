import { createArchiveProxy } from './archive-proxy.mjs'

const server = createArchiveProxy({ upstream: 'http://127.0.0.1:13856', repository: 'pilot/pilot', actors: [{ id: 1, login: 'pilot' }] })
server.listen(13857, '127.0.0.1', () => process.stdout.write('ready\n'))
process.on('SIGTERM', () => server.close(() => process.exit(0)))
