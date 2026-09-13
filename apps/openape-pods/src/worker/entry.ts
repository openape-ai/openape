const port = process.parentPort
if (!port) throw new Error('Fixture worker requires its owning Electron process')
port.on('message', (event) => {
  if (event.data !== 'stop') throw new Error('Unknown fixture worker command')
  process.exit(0)
})
port.postMessage('ready')
