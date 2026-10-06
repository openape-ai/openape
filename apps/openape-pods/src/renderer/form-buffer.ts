export interface SettingsDraft { name: string, revision: number, newGroup?: string }
export interface VariableDraft { name: string, value: string, revision: number }
export const settingsDrafts = new Map<string, SettingsDraft>()
export const variableDrafts = new Map<string, VariableDraft>()

export const descriptionDrafts = new Map<string, { text: string, revision: number, saved: string }>()
export const scheduleDrafts = new Map<string, { kind: string, minutes: number, time: string, timezone: string, enabled: boolean, saved: string }>()
