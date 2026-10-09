<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { McpSessionView } from '../../contracts/mcp-session'
import type { ConnectionView } from '../../contracts/onboarding'
import type { RuntimeApprovalView } from '../../contracts/runtime-approval'
import { diagnostic, t, time } from '../i18n'
import LanguageSwitcher from '../LanguageSwitcher.vue'
import type { SecretsView } from '../../contracts/secrets'

/**
 * Settings as a gear menu: the accounts, the execution switch, the MCP session, language, backups and
 * the link to the grants at the identity provider. Rights are decided at the identity provider;
 * this menu only shows status and switches that the desktop already offers. The browser shows
 * status and sign-out and points to the desktop for everything native.
 */
const props = defineProps<{ browser?: boolean, subject?: string, consumer?: SecretsView['consumer'], sharing?: boolean }>()
const emit = defineEmits<{ close: [], logout: [], revoke: [], advanced: [], import: [] }>()
const native = !props.browser && typeof window !== 'undefined' && !!window.pods
const owner = ref<ConnectionView | null>(null)
const jev = ref<ConnectionView | null>(null)
const codex = ref<'connected' | 'disconnected' | 'foreign' | 'edited' | null>(null)
const approval = ref<RuntimeApprovalView | null>(null)
const mcp = ref<McpSessionView | null>(null)
const busy = ref(false)
const error = ref('')
const grants = 'https://id.openape.ai/grants'
let closed = false
async function load() {
  if (!native) return
  try {
    const [onboarding, connection, runtime, access] = await Promise.all([window.pods.onboarding({ type: 'list' }), window.pods.codex({ type: 'status' }), window.pods.runtimeApproval({ type: 'get' }), window.pods.mcpSession({ type: 'get' })])
    if (closed) return
    owner.value = onboarding.connections.find(item => item.id === onboarding.owner) ?? null
    jev.value = onboarding.connections.find(item => item.provider === 'typesafe') ?? null
    codex.value = connection.state; approval.value = runtime; mcp.value = access; error.value = ''
  }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
}
async function act(action: () => Promise<void>) {
  busy.value = true; error.value = ''
  try { await action() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { busy.value = false; await load() }
}
const setApproval = (event: Event) => act(async () => { approval.value = await window.pods.runtimeApproval({ type: 'set', enabled: (event.target as HTMLInputElement).checked }) })
const endMcp = () => act(async () => { mcp.value = await window.pods.mcpSession({ type: 'end' }) })
const backup = () => act(async () => { await window.pods.data({ type: 'backup' }) })
const manageGrants = () => act(async () => { await window.pods.runtimeApproval({ type: 'manage' }) })
onMounted(load)
onBeforeUnmount(() => { closed = true })
defineExpose({ load })
</script>

<template>
  <div class="app-settings-menu" role="dialog" :aria-label="t('Settings')">
    <div class="dhead">
      <b>{{ t('Settings') }}</b><button class="x" type="button" :aria-label="t('Close')" @click="emit('close')">
        ×
      </button>
    </div>
    <div class="eyebrow">
      {{ t('Accounts') }}
    </div>
    <div class="acct" data-account="ddisa">
      <span>{{ t('DDISA account') }}</span><span class="pill" :class="subject || owner?.state === 'ready' ? 'ok' : 'off'">{{ subject || owner?.state === 'ready' ? t('signed in') : t('not signed in') }}</span><span class="meta">{{ subject || owner?.account || '–' }} · {{ t('decides every right') }}<button v-if="browser" class="secondary small" type="button" @click="emit('logout')">{{ t('Sign out') }}</button></span>
    </div>
    <div class="acct" data-account="codex">
      <span>{{ 'Codex / GPT' }}</span><span class="pill" :class="codex === 'connected' ? 'ok' : 'off'">{{ browser ? t('on the desktop') : codex === 'connected' ? t('connected') : t('not connected') }}</span><span class="meta">{{ t('creates automations, writes scripts') }}</span>
    </div>
    <div class="acct" data-account="jev">
      <span>{{ 'TypeSafe Jev' }}</span><span class="pill" :class="jev?.state === 'ready' ? 'ok' : 'off'">{{ browser ? t('on the desktop') : jev?.state === 'ready' ? t('connected') : t('not connected') }}</span><span class="meta">{{ t('decisions in scripts') }}</span>
    </div>
    <div class="acct" data-consumer>
      <span>{{ 'OpenApe Secrets' }}</span><span class="pill" :class="consumer ? 'ok' : 'off'">{{ browser ? t('on the desktop') : consumer ? t('this Mac is registered') : t('not registered') }}</span><span class="meta">{{ t('receives sealed secrets, collected once') }}<template v-if="consumer && !browser"> · {{ consumer.id }}<button class="secondary small" type="button" :disabled="busy" @click="emit('revoke')">{{ t('Revoke') }}</button></template></span>
    </div>
    <div class="eyebrow">
      {{ t('Execution') }}
    </div>
    <label class="sw"><input type="checkbox" data-switch="approval" :checked="!!approval?.enabled" :disabled="browser || busy || !approval" @change="setApproval"> {{ t('Always let the scripts of all my Pods run on this Mac') }} <span class="meta">({{ t('runtime grants at the IdP, revocable at any time') }})</span></label>
    <div class="acct" data-mcp>
      <span>{{ t('MCP session') }}</span><span class="pill" :class="mcp?.expiresAt ? 'ok' : 'off'">{{ browser ? t('on the desktop') : mcp?.expiresAt ? t('Codex signed in until {time}', { time: time(mcp.expiresAt) }) : t('Codex not signed in') }}</span><span class="meta">{{ t('one hour after your DDISA sign-in and confirmation') }}<button v-if="!browser && (mcp?.expiresAt || mcp?.pending)" class="secondary small" type="button" :disabled="busy" @click="endMcp">{{ t('End session') }}</button></span>
    </div>
    <p v-if="browser" class="meta">
      {{ t('Manage execution on the desktop.') }}
    </p>
    <div class="eyebrow">
      {{ t('Other') }}
    </div>
    <div class="acct">
      <span>{{ t('Language') }}</span><LanguageSwitcher :browser="browser" />
    </div>
    <div class="acct">
      <span>{{ t('Data & backups') }}</span><button v-if="!browser" class="secondary small" type="button" :disabled="busy" @click="backup">
        {{ t('Export backup…') }}
      </button><span v-else class="meta">{{ t('Manage backups and local storage on the desktop.') }}</span>
    </div>
    <div v-if="sharing" class="acct" data-sharing>
      <span>{{ t('Portable Pods') }}</span><button class="secondary small" type="button" :disabled="busy" @click="emit('import')">
        {{ t('Import…') }}
      </button>
    </div>
    <div class="acct" data-advanced>
      <span>{{ t('More settings') }}</span><button v-if="!browser" class="secondary small" type="button" :disabled="busy" @click="emit('advanced')">
        {{ t('Open desktop settings…') }}
      </button><span v-else class="meta">{{ t('on the desktop') }}</span><span class="meta">{{ t('sign-in flows, Jev key, Codex connection, data and backups') }}</span>
    </div>
    <div class="acct">
      <span>{{ t('Rights') }}</span><a v-if="browser" :href="grants" target="_blank" rel="noopener">{{ t('Manage existing grants at the IdP') }}</a><button v-else class="secondary small" type="button" :disabled="busy || !approval?.owner" @click="manageGrants">
        {{ t('Manage existing grants at the IdP') }}
      </button>
    </div>
    <p v-if="error" class="error-message" role="alert">
      {{ diagnostic(error) }}
    </p>
  </div>
</template>

<style>
.app-settings-menu{position:fixed;right:16px;top:56px;width:min(380px,calc(100vw - 32px));z-index:9;background:var(--surface);border:1px solid var(--border);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.18);padding:14px 16px;display:grid;gap:8px;font-size:14px}
.app-settings-menu .dhead{display:flex;justify-content:space-between;align-items:center}.app-settings-menu .x{font-size:18px;line-height:1;padding:2px 6px}
.app-settings-menu .eyebrow{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:600;margin-top:6px}
.app-settings-menu .acct{display:grid;grid-template-columns:auto auto;gap:2px 10px;align-items:center}.app-settings-menu .acct .meta{grid-column:1/-1}
.app-settings-menu .meta{font-size:12px;color:var(--muted)}.app-settings-menu .sw{display:block;font-size:13px}
.app-settings-menu .pill{display:inline-block;font-size:12px;font-weight:600;padding:1px 8px;border-radius:10px;justify-self:start}.app-settings-menu .pill.ok{background:var(--ok-soft);color:var(--ok)}.app-settings-menu .pill.off{background:var(--tint);color:var(--muted)}
.app-settings-menu .secondary.small{padding:2px 8px;font-size:12px;margin-left:8px}.app-settings-menu a{color:var(--accent)}
</style>
