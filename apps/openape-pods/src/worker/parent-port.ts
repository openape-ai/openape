import { EventEmitter } from 'node:events'

interface RuntimePort {
  postMessage: (value: unknown) => void
  on: (event: 'message', receive: (event: { data: unknown }) => void) => unknown
}

export function runtimeParentPort(): RuntimePort {
  if (process.parentPort) return process.parentPort
  if (!process.send) throw new Error('Pods worker requires its owning runtime process')
  const port = new EventEmitter()
  process.on('message', data => port.emit('message', { data }))
  let stopping = false
  const stop = () => { if (!stopping) { stopping = true; port.emit('message', { data: 'stop' }) } }
  process.on('disconnect', stop)
  process.on('SIGTERM', stop)
  process.on('SIGINT', () => {})
  return Object.assign(port, {
    postMessage: (value: unknown) => {
      if (process.connected) process.send!(value)
    },
  })
}
