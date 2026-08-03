import { get, set } from 'idb-keyval'

const SELECTED_KEY = 'cockpit-company-v1'

export async function loadCockpitCompany(): Promise<string | undefined> {
  return await get<string>(SELECTED_KEY)
}
export async function saveCockpitCompany(id: string): Promise<void> {
  await set(SELECTED_KEY, id)
}
