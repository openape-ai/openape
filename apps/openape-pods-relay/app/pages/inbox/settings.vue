<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import InboxShell from '../../components/InboxShell.vue'
import InboxPushSetting from '../../components/InboxPushSetting.vue'
import { useInbox } from '../../inbox/client'
import { disablePush, enablePush, pushState } from '../../inbox/push'
import type { PushState } from '../../inbox/push'
import type { InboxDevice } from '../../inbox/client'
import { chooseLanguage, formatTime, languageChoice, t } from '../../inbox/i18n'
import type { Language } from '../../inbox/i18n'

const inbox = useInbox()
const { state } = inbox
const online = computed(() => state.phase === 'ready')
const devices = ref<InboxDevice[]>([])
const error = ref('')
const busy = ref(false)
const version = useRuntimeConfig().app.buildId
const push = ref<PushState>('unavailable')
const pushBusy = ref(false)
const installed = ref(false)
const language = computed({ get: () => languageChoice.value ?? 'auto', set: (value: Language | 'auto') => chooseLanguage(value === 'auto' ? null : value) })

// Browsers show only coarse agent strings; the last-use time tells devices apart.
function deviceName(device: InboxDevice): string {
  const agent = device.agent
  const platform = /iPhone/.test(agent) ? 'iPhone' : /iPad/.test(agent) ? 'iPad' : /Android/.test(agent) ? 'Android' : /Macintosh/.test(agent) ? 'Mac' : /Windows/.test(agent) ? 'Windows' : '—'
  const browser = /Firefox\//.test(agent) ? 'Firefox' : /Edg\//.test(agent) ? 'Edge' : /Chrome\//.test(agent) ? 'Chrome' : /Safari\//.test(agent) ? 'Safari' : ''
  return [platform, browser].filter(Boolean).join(' · ')
}

async function loadDevices() {
  if (!online.value) return
  try { devices.value = (await inbox.devices()).devices; error.value = '' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
}
async function revoke(device: InboxDevice) {
  busy.value = true
  try { await inbox.revoke(device.id); await loadDevices() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { busy.value = false }
}
// enablePush asks for permission first, still inside the tap that Safari requires.
async function togglePush() {
  if (pushBusy.value || !state.session) return
  pushBusy.value = true; error.value = ''
  try { push.value = push.value === 'on' ? await disablePush(inbox) : await enablePush(inbox, state.session.vapidPublicKey) }
  catch (cause) { error.value = t('settingsPushFailed', { error: cause instanceof Error ? cause.message : String(cause) }) }
  finally { pushBusy.value = false; await loadDevices() }
}
async function logout() {
  busy.value = true; error.value = ''
  try { await inbox.logout() }
  catch { error.value = t('settingsLogoutFailed') }
  finally { busy.value = false }
}

watch(online, loadDevices)
onMounted(async () => {
  push.value = await pushState().catch(() => 'unavailable' as const)
  installed.value = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
  await loadDevices()
})
</script>

<template>
  <InboxShell>
    <h1>{{ t('tabSettings') }}</h1>
    <p v-if="error" class="inbox-error" role="alert">
      {{ error }}
    </p>
    <dl class="facts">
      <dt>{{ t('settingsAccount') }}</dt>
      <dd>{{ state.session?.subject ?? state.account }}</dd>
      <template v-if="state.session">
        <dt>{{ t('settingsIssuer') }}</dt>
        <dd>{{ state.session.issuer }}</dd>
      </template>
      <dt>{{ t('settingsInstalled') }}</dt>
      <dd>{{ installed ? t('settingsInstalledYes') : t('settingsInstalledNo') }}</dd>
      <dt>{{ t('settingsPush') }}</dt>
      <dd><InboxPushSetting :state="push" :busy="pushBusy" :online="online" @toggle="togglePush" /></dd>
      <dt>{{ t('settingsVersion') }}</dt>
      <dd>{{ version }}</dd>
    </dl>

    <label class="field" for="inbox-language">{{ t('settingsLanguage') }}</label>
    <select id="inbox-language" v-model="language">
      <option value="auto">
        {{ t('settingsLanguageAuto') }}
      </option>
      <option value="de">
        Deutsch
      </option>
      <option value="en">
        English
      </option>
    </select>

    <template v-if="online">
      <h2>{{ t('settingsDevices') }}</h2>
      <ul class="devices">
        <li v-for="device in devices" :key="device.id" class="inbox-card">
          <strong>{{ deviceName(device) }}<template v-if="device.id === state.session?.device"> · {{ t('settingsThisDevice') }}</template></strong>
          <small>{{ t('settingsLastSeen', { time: formatTime(device.seen) }) }}</small>
          <button type="button" class="secondary" :disabled="busy" :aria-label="t('settingsRevokeLabel', { device: deviceName(device) })" @click="revoke(device)">
            {{ t('settingsRevoke') }}
          </button>
        </li>
      </ul>
      <button type="button" class="logout" :disabled="busy" @click="logout">
        {{ t('settingsLogout') }}
      </button>
    </template>
    <p class="inbox-muted">
      {{ t('settingsTrust') }}
    </p>
  </InboxShell>
</template>

<style scoped>
.facts { margin: 0; }
.facts dt { color: var(--muted); font-size: .85em; margin-top: 10px; }
.facts dd { margin: 0; }
.field { display: block; color: var(--muted); margin: 16px 0 4px; }
.devices { list-style: none; margin: 0; padding: 0; }
.devices li { display: grid; gap: 6px; }
.logout { width: 100%; margin-top: 16px; }
</style>
