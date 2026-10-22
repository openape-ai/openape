import type { EngineCommand } from './vault-engine'
import { createVaultEngine } from './vault-engine'

const engine = createVaultEngine()
globalThis.onmessage = async (event: MessageEvent<{ id: number, command: EngineCommand }>) => {
  try { globalThis.postMessage({ id: event.data.id, result: await engine(event.data.command) }) }
  catch { globalThis.postMessage({ id: event.data.id, error: 'Cannot open vault. Check passkey or recovery code.' }) }
}
