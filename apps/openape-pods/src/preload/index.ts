import { parseRunCommand, parseRunView } from '../contracts/runs'
import { parseResourceCommand, parseResourceState } from '../contracts/resources'
import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { parseCommand, parseWorkspace } from '../contracts/control'
import { channels, isPodStatus } from '../contracts/ipc'
import type { PodsBridge } from '../contracts/ipc'

const bridge: PodsBridge = {
  async runs(command) { return parseRunView(await ipcRenderer.invoke(channels.runs, parseRunCommand(command))) },
  async resources(command) { return parseResourceState(await ipcRenderer.invoke(channels.resources, parseResourceCommand(command))) },
  async workspace(command) { return parseWorkspace(await ipcRenderer.invoke(channels.workspace, parseCommand(command))) },
  async getStatus() {
    const value: unknown = await ipcRenderer.invoke(channels.status)
    if (!isPodStatus(value)) throw new Error('Invalid Pods status response')
    return value
  },
  onStatus(listener) {
    if (typeof listener !== 'function') throw new TypeError('Status listener must be a function')
    const receive = (_event: IpcRendererEvent, value: unknown) => {
      if (!isPodStatus(value)) throw new Error('Invalid Pods status event')
      listener(value)
    }
    ipcRenderer.on(channels.changed, receive)
    return () => ipcRenderer.removeListener(channels.changed, receive)
  },
}
contextBridge.exposeInMainWorld('pods', Object.freeze(bridge))
