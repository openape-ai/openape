import { RuntimeHub } from './hub'
import { relay } from './service'

let instance: RuntimeHub | undefined
export function hub(): RuntimeHub { instance ??= new RuntimeHub(relay()); return instance }
