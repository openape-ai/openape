<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import InboxDecision from '../../../components/InboxDecision.vue'
import InboxShell from '../../../components/InboxShell.vue'
import { isItemId, useInbox } from '../../../inbox/client'
import { formatTime, t } from '../../../inbox/i18n'

const inbox = useInbox()
const { state } = inbox
const route = useRoute()
const id = computed(() => String(route.params.id))
const item = computed(() => state.items[id.value] ?? null)
const online = computed(() => state.phase === 'ready')
const missing = ref<'invalid' | 'missing' | 'offline' | null>(null)
const error = ref('')
function https(value: string): URL | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url : null
  }
  catch { return null }
}
const safeLinks = computed(() => (item.value?.kind === 'message' ? item.value.links : []).flatMap((link) => {
  const url = https(link.url)
  return url ? [{ title: link.title, url: url.href, host: url.host }] : []
}))
let readMarked: string | null = null

// A pushed or shared link may point at anything; only a well-formed ID of this account opens, nothing else is executed.
watch([id, () => state.phase], async () => {
  error.value = ''
  if (!isItemId(id.value)) { missing.value = 'invalid'; return }
  if (state.phase === 'loading' || state.phase === 'signedOut') return
  try {
    const found = await inbox.load(id.value)
    missing.value = found ? null : state.phase === 'ready' ? 'missing' : 'offline'
  }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
}, { immediate: true })

// Opening a message marks it read for the whole account; deciding is always an explicit tap.
watch([item, online], async () => {
  try {
    if (item.value?.kind === 'message' && !item.value.read && online.value && readMarked !== item.value.id) {
      readMarked = item.value.id
      await inbox.mark(item.value.id, { read: true })
    }
    const receipt = item.value ? state.receipts[item.value.id] : undefined
    if (online.value && item.value && receipt && ['accepted', 'started'].includes(receipt.state)) await inbox.check(item.value.id)
  }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
}, { immediate: true })

async function change(patch: { read?: boolean, archived?: boolean }) {
  if (!item.value) return
  error.value = ''
  try { await inbox.mark(item.value.id, patch) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
}
async function decide(option: string, input?: string) { if (item.value) await inbox.decide(item.value, option, input) }
async function check() { if (item.value) await inbox.check(item.value.id) }
</script>

<template>
  <InboxShell>
    <NuxtLink :to="item?.kind === 'message' ? '/inbox/messages' : '/inbox/'" class="back">
      ‹ {{ t('back') }}
    </NuxtLink>
    <p v-if="missing" class="inbox-note" role="status">
      {{ missing === 'invalid' ? t('itemInvalid') : missing === 'offline' ? t('itemOfflineMissing') : t('itemMissing') }}
    </p>
    <p v-if="error" class="inbox-error" role="alert">
      {{ error }}
    </p>
    <article v-if="item">
      <small class="inbox-muted">{{ item.kind === 'decision' ? t('itemDecision') : t('itemMessage') }}<template v-if="item.pod?.name"> · {{ t('itemPod', { name: item.pod.name }) }}</template> · {{ formatTime(item.created) }}</small>
      <h1>{{ item.title }}</h1>
      <p class="inbox-body">
        {{ item.body }}
      </p>
      <template v-if="safeLinks.length">
        <h2>{{ t('itemLinks') }}</h2>
        <ul class="links">
          <li v-for="link in safeLinks" :key="link.url">
            <a :href="link.url" target="_blank" rel="noopener noreferrer">{{ link.title }}</a>
            <small class="inbox-muted">{{ link.host }}</small>
          </li>
        </ul>
      </template>
      <InboxDecision v-if="item.kind === 'decision'" :item="item" :receipt="state.receipts[item.id]" :online="online" :checking="!!state.checking[item.id]" @decide="decide" @check="check" />
      <div v-else class="actions">
        <button type="button" class="secondary" :disabled="!online" @click="change({ archived: !item.archived })">
          {{ item.archived ? t('itemUnarchive') : t('itemArchive') }}
        </button>
        <button type="button" class="secondary" :disabled="!online || !item.read" @click="change({ read: false })">
          {{ t('itemMarkUnread') }}
        </button>
      </div>
    </article>
  </InboxShell>
</template>

<style scoped>
.back { display: inline-flex; align-items: center; min-height: 44px; text-decoration: none; }
.links { padding-left: 1.2em; display: grid; gap: 8px; }
.links small { display: block; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
</style>
