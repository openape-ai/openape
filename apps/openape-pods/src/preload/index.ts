import { parseWorkflowCommand, parseWorkflowView } from '../contracts/workflows'
import { parsePackageSearch, parsePackageOptions } from '../contracts/package-catalog'
import { parseProgramCommand, parseTerminalView, parseConsoleView } from '../contracts/programs'
import { parseLanguage, parseLanguageCommand } from '../contracts/language'
import { parseScriptCommand, parseScriptView } from '../contracts/scripts'
import { parseDataCommand, parseDataView } from '../contracts/data'
import { parseOnboardingCommand, parseOnboardingView } from '../contracts/onboarding'
import { parseMasterCommand, parseMasterView } from '../contracts/master'
import { parseDetailsCommand, parsePodDetails } from '../contracts/details'
import { parseScheduleCommand, parseScheduleView } from '../contracts/scheduling'
import { parseRunCommand, parseRunView } from '../contracts/runs'
import { parseResourceCommand, parseResourceState } from '../contracts/resources'
import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { parseCommand, parseWorkspace } from '../contracts/control'
import { channels, isPodStatus } from '../contracts/ipc'
import type { PodsBridge } from '../contracts/ipc'

const bridge: PodsBridge = {
  async workflows(command) { return parseWorkflowView(await ipcRenderer.invoke(channels.workflows, parseWorkflowCommand(command))) },
  async packages(command) { return parsePackageOptions(await ipcRenderer.invoke(channels.packages, parsePackageSearch(command))) },
  async programs(command) {
    const request = parseProgramCommand(command)
    const response: unknown = await ipcRenderer.invoke(channels.programs, request)
    if (request.type === 'launchStatus') return response === null ? null : parseTerminalView(response)
    if (request.type === 'prepare') return parseConsoleView(response)
    return ['network', 'openShell', 'add', 'replace', 'grant', 'importState'].includes(request.type) ? parseResourceState(response) : parseTerminalView(response)
  },
  async language(command) { return parseLanguage(await ipcRenderer.invoke(channels.language, parseLanguageCommand(command))) },
  async scripts(command) { return parseScriptView(await ipcRenderer.invoke(channels.scripts, parseScriptCommand(command))) },
  async data(command) { return parseDataView(await ipcRenderer.invoke(channels.data, parseDataCommand(command))) },
  async onboarding(command) { return parseOnboardingView(await ipcRenderer.invoke(channels.onboarding, parseOnboardingCommand(command))) },
  async master(command) { return parseMasterView(await ipcRenderer.invoke(channels.master, parseMasterCommand(command))) },
  async details(command) { return parsePodDetails(await ipcRenderer.invoke(channels.details, parseDetailsCommand(command))) },
  async scheduling(command) { return parseScheduleView(await ipcRenderer.invoke(channels.scheduling, parseScheduleCommand(command))) },
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
