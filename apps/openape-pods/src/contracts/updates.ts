export interface UpdateCommand { type: 'status' | 'check' | 'install' }
export interface UpdateView {
  state: 'disabled' | 'idle' | 'checking' | 'available' | 'downloading' | 'preparing' | 'installing' | 'error'
  currentVersion: string
  version: string | null
  progress: number
  error: string | null
  backup: string | null
}
export function parseUpdateCommand(value: unknown): UpdateCommand {
  if (!value || typeof value !== 'object' || Object.keys(value).length !== 1 || !('type' in value) || !['status', 'check', 'install'].includes(String(value.type))) throw new Error('Invalid update command')
  return value as UpdateCommand
}
export function parseUpdateView(value: unknown): UpdateView {
  if (!value || typeof value !== 'object') throw new Error('Invalid update state')
  const view = value as UpdateView
  if (!['disabled', 'idle', 'checking', 'available', 'downloading', 'preparing', 'installing', 'error'].includes(view.state) || typeof view.currentVersion !== 'string' || (view.version !== null && typeof view.version !== 'string') || !Number.isFinite(view.progress) || view.progress < 0 || view.progress > 100 || (view.error !== null && typeof view.error !== 'string') || (view.backup !== null && typeof view.backup !== 'string')) throw new Error('Invalid update state')
  return view
}
