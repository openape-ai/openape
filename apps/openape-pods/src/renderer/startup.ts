import type { InjectionKey } from 'vue'
import type { PodStatus } from '../contracts/ipc'
import type { OnboardingView } from '../contracts/onboarding'
import { t } from './i18n'

export type StartupStateId = 'checking' | 'signed-out' | 'browser-pending' | 'sign-in-incomplete' | 'service-unreachable' | 'local-start-failed' | 'unsupported-runtime' | 'session-expired' | 'signed-in'
export type StartupActionId = 'sign-in' | 'change-address' | 'reopen-browser' | 'cancel' | 'retry' | 'restart-local' | 'continue'
/** progress: wait; sign-in: the owner acts; retry: repeating can help; blocked: repeating cannot help; ok: handoff. */
export type StartupTone = 'progress' | 'sign-in' | 'retry' | 'blocked' | 'ok'

export interface StartupAction { id: StartupActionId, label: string }
export interface StartupFact { label: string, value: string, tone: 'ok' | 'bad' | 'muted' }
export interface StartupState {
  id: StartupStateId
  tone: StartupTone
  title: string
  message: string
  /** The technical cause, behind a disclosure. */
  detail?: string
  facts?: StartupFact[]
  account?: string
  code?: string
  /** Shows the DDISA address field, prefilled with this value. */
  email?: string
  /** The first action is the single primary one. */
  actions: StartupAction[]
}

export interface StartupInput {
  status: PodStatus | null
  view: OnboardingView | null
  /** The failure of the last owner action, or of reading the account state. */
  error: string
  /** Where the error came from: an owner sign-in action or the account service itself. */
  errorSource: 'action' | 'service' | null
  /** Startup took longer than the window waits. */
  overdue: boolean
  /** The owner returned to the address field. */
  editing: boolean
  /** The owner acknowledged that this Mac cannot execute Pods. */
  continued: boolean
  /** The last address the owner entered. */
  email: string
}

/** The workspace's account button reports each account read here, so the gate needs no second poll. */
export const accountReportKey: InjectionKey<(view: OnboardingView) => void> = Symbol('account-report')

/** Startup gives up waiting after this long and offers to check again. */
export const startupLimitMs = 60_000

const cancelled = 'Sign-in cancelled by the owner'
const expired = 'Sign-in expired; start again'
/** Network causes that a new attempt can fix; the full message stays in the details. */
export function unreachable(error: string): boolean {
  return /fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|UND_ERR_|timed out|TimeoutError|Could not look up the DDISA identity provider/i.test(error)
}

function checking(): StartupState {
  return { id: 'checking', tone: 'progress', title: t('Starting Pods'), message: t('Checking the local service and your sign-in. This usually takes a few seconds.'), actions: [] }
}
function localFailed(message: string, detail: string, action: StartupAction): StartupState {
  return { id: 'local-start-failed', tone: 'retry', title: t('The local Pods service did not start'), message, detail, actions: [action] }
}
function signInAgain(account: string): StartupAction[] {
  return [{ id: 'sign-in', label: t('Sign in again') }, ...(account ? [{ id: 'change-address' as const, label: t('Use another address') }] : [])]
}

/** The one status the window shows before the workspace opens; it derives everything from actual state. */
export function startupState(input: StartupInput): StartupState {
  const worker = input.status?.worker
  if (!input.status && input.errorSource === 'service') return localFailed(t('Pods cannot read the state of its local service. Check again; if this repeats, the details below name the cause.'), input.error, { id: 'retry', label: t('Check again') })
  if (!input.status || !worker || worker.state === 'starting' || (worker.state === 'ready' && !input.view && input.errorSource !== 'service')) {
    if (!input.overdue) return checking()
    return localFailed(t('Pods is not ready after {seconds} seconds. Check again; if this repeats, the details name the step that is waiting.', { seconds: startupLimitMs / 1000 }), t('Local service state: {state}', { state: worker?.state ?? 'unknown' }), { id: 'retry', label: t('Check again') })
  }
  if (worker.state !== 'ready') return localFailed(t('The background service of Pods stopped during startup. Restart it; if the error repeats, the details below name the cause.'), [worker.error ?? t('No cause was reported'), input.errorSource === 'service' ? input.error : ''].filter(Boolean).join('\n'), { id: 'restart-local', label: t('Restart service') })
  if (input.errorSource === 'service' || !input.view) return localFailed(t('Pods cannot read your account state. Restart the service; if the error repeats, the details below name the cause.'), input.error, { id: 'restart-local', label: t('Restart service') })
  const owner = input.view.connections.find(item => item.provider === 'openape')
  const account = owner?.account || input.email
  if (input.editing || !owner || owner.state === 'revoked') {
    if (input.error && !input.editing) return failed(input.error, account)
    return { id: 'signed-out', tone: 'sign-in', title: t('Sign in to Pods'), message: t('Sign in with your DDISA address. You confirm it in your browser.'), email: account, actions: [{ id: 'sign-in', label: t('Sign in with DDISA') }] }
  }
  if (owner.state === 'connecting') {
    const actions: StartupAction[] = [...(owner.login ? [{ id: 'reopen-browser' as const, label: t('Open browser again') }] : []), { id: 'cancel', label: t('Cancel sign-in') }]
    // A failed browser or cancel step stays visible; the sign-in itself still waits and both actions remain available.
    if (input.error) return { id: 'browser-pending', tone: 'retry', title: t('Confirm the sign-in in your browser'), message: t('The last sign-in step failed. The details below name the cause; open the browser again or cancel the sign-in.'), account: owner.account, ...(owner.login?.code ? { code: owner.login.code } : {}), detail: input.error, actions }
    return { id: 'browser-pending', tone: 'sign-in', title: t('Confirm the sign-in in your browser'), message: owner.login ? t('Your browser opened the DDISA sign-in. Confirm it there; Pods continues automatically afterwards.') : t('Pods is preparing the DDISA sign-in.'), account: owner.account, ...(owner.login?.code ? { code: owner.login.code } : {}), actions }
  }
  if (input.error) return failed(input.error, account)
  if (owner.state === 'failed') return failed(owner.error ?? t('No cause was reported'), account)
  if (owner.state === 'expired') return { id: 'session-expired', tone: 'sign-in', title: t('Session expired'), message: t('Your DDISA session has expired. Sign in again to open the workspace.'), account: owner.account, ...(owner.error ? { detail: owner.error } : {}), actions: signInAgain(owner.account) }
  const execution = input.status.execution
  if (!execution.supported && !input.continued) {
    return {
      id: 'unsupported-runtime',
      tone: 'blocked',
      title: execution.compatibility === 'incompatible' ? t('Pods cannot run automations on this Mac') : t('Pods cannot run automations on this macOS version yet'),
      message: execution.compatibility === 'incompatible' ? t('Pods runs automations only on Apple silicon Macs. On this computer no Pod starts, neither scheduled nor manually. Sign-in, settings and diagnosis remain available.') : t('Pods runs automations only on verified macOS versions. On this Mac no Pod starts, neither scheduled nor manually. Sign-in, settings, diagnosis and updates remain available; only a Pods version verified for this macOS can run automations here.'),
      facts: [
        { label: t('Execution on this Mac'), value: t('Blocked'), tone: 'bad' },
        { label: t('Found'), value: `${execution.system ? `macOS ${execution.system} · ` : ''}Darwin ${execution.kernel} (${execution.architecture})`, tone: 'muted' },
        { label: t('Verified'), value: execution.verified.join(', '), tone: 'muted' },
        { label: t('DDISA sign-in'), value: t('Signed in'), tone: 'ok' },
      ],
      account: owner.account,
      detail: execution.reason ?? '',
      actions: [{ id: 'continue', label: t('Continue without automations') }],
    }
  }
  return { id: 'signed-in', tone: 'ok', title: t('Signed in'), message: t('Opening the workspace…'), account: owner.account, actions: [] }
}

function failed(error: string, account: string): StartupState {
  if (unreachable(error)) return { id: 'service-unreachable', tone: 'retry', title: t('Sign-in service unreachable'), message: t('Pods cannot reach the DDISA sign-in service right now. Check the internet connection and try again.'), detail: error, ...(account ? { account } : {}), actions: [{ id: 'sign-in', label: t('Try again') }, ...(account ? [{ id: 'change-address' as const, label: t('Use another address') }] : [])] }
  const incomplete = error === cancelled || error === expired
  return { id: 'sign-in-incomplete', tone: 'retry', title: t('Sign-in not completed'), message: incomplete ? t('The sign-in in the browser was cancelled or expired. Start the sign-in again.') : t('The sign-in could not be completed. The details below name the cause.'), detail: error, ...(account ? { account } : {}), actions: signInAgain(account) }
}
