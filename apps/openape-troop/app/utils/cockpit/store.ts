import { get, set, del } from 'idb-keyval'
import type { ChatMessage } from './types'

const HISTORY_PREFIX = 'cockpit-history-v1:'
const SELECTED_KEY = 'cockpit-company-v1'

export async function loadCockpitHistory(companyId: string): Promise<ChatMessage[]> {
  return (await get<ChatMessage[]>(HISTORY_PREFIX + companyId)) ?? []
}
export async function saveCockpitHistory(companyId: string, messages: ChatMessage[]): Promise<void> {
  const clean = messages.map(({ streaming: _s, thoughts: _t, ...m }) => m)
  await set(HISTORY_PREFIX + companyId, clean)
}
export async function loadCockpitCompany(): Promise<string | undefined> {
  return await get<string>(SELECTED_KEY)
}
export async function saveCockpitCompany(id: string): Promise<void> {
  await set(SELECTED_KEY, id)
}
export async function clearCockpitHistory(companyId: string): Promise<void> {
  await del(HISTORY_PREFIX + companyId)
}
