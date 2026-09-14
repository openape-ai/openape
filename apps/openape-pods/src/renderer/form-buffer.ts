export interface SettingsDraft { name: string, assignment: string, revision: number }
export interface VariableDraft { name: string, value: string, revision: number }
export const settingsDrafts = new Map<string, SettingsDraft>()
export const variableDrafts = new Map<string, VariableDraft>()
