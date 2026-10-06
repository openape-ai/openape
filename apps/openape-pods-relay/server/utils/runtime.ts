import { useRuntimeConfig } from 'nitropack/runtime'
import { RuntimeHub } from './hub'
import { Notifier } from './notifications'
import { relay } from './service'

let instance: RuntimeHub | undefined
let notifierInstance: Notifier | undefined
export function notifier(): Notifier {
  if (!notifierInstance) {
    const config = useRuntimeConfig()
    notifierInstance = new Notifier(relay(), { enabled: !!config.relayApnsEnabled, keyId: String(config.relayApnsKeyId), teamId: String(config.relayAppleTeam), key: String(config.relayApnsKey), bundle: String(config.relayAppleBundle), host: String(config.relayApnsHost), sandboxHost: String(config.relayApnsSandboxHost) })
  }
  return notifierInstance
}
export function hub(): RuntimeHub { instance ??= new RuntimeHub(relay(), notifier()); return instance }
