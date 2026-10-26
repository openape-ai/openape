<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import InboxDecision from '../../../components/InboxDecision.vue'
import InboxShell from '../../../components/InboxShell.vue'
import InboxTags from '../../../components/InboxTags.vue'
import { isItemId, useInbox } from '../../../inbox/client'
import { needsRepair, repairTitle } from '../../../inbox/repair'
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
// A message's links and the reference link of a decision Pods settles itself; an IdP or Secrets handoff stays with the decision.
const safeLinks = computed(() => (item.value?.kind === 'message' || item.value?.decision?.authority === 'pods' ? item.value.links : []).flatMap((link) => {
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
async function decide(option: string, input?: string) { if (item.value) await inbox.answer(item.value, option, input) }
function undo() { if (item.value) inbox.undo(item.value.id) }
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
    <article v-if="item" :class="{ 'message-detail': item.kind === 'message' }">
      <small v-if="item.kind !== 'message'" class="inbox-muted">{{ item.kind === 'decision' ? t('itemDecision') : t('itemMessage') }}<template v-if="item.pod?.name"> · {{ t('itemPod', { name: item.pod.name }) }}</template> · {{ formatTime(item.created) }}</small>
      <InboxTags v-if="item.kind !== 'message'" :tags="item.pod?.tags" />
      <p v-if="item.kind === 'message'" class="message-meta inbox-muted">
        {{ item.pod?.name }} · {{ formatTime(item.created) }}
      </p>
      <h1>{{ needsRepair(item) ? repairTitle(item) : item.title }}</h1>
      <p v-if="!needsRepair(item)" class="inbox-body">
        {{ item.body }}
      </p>
      <div v-if="item.kind === 'message' && safeLinks.length === 1" class="primary-link">
        <a :href="safeLinks[0]!.url" target="_blank" rel="noopener noreferrer">{{ safeLinks[0]!.title }} <span aria-hidden="true">↗</span></a>
        <small class="inbox-muted">{{ safeLinks[0]!.host }}</small>
      </div>
      <template v-else-if="safeLinks.length">
        <h2>{{ t('itemLinks') }}</h2>
        <ul class="links">
          <li v-for="link in safeLinks" :key="link.url">
            <a :href="link.url" target="_blank" rel="noopener noreferrer">{{ link.title }}</a>
            <small class="inbox-muted">{{ link.host }}</small>
          </li>
        </ul>
      </template>
      <InboxDecision v-if="item.kind === 'decision'" :item="item" :preselect="typeof route.query.option === 'string' ? route.query.option : undefined" :receipt="state.receipts[item.id]" :online="online" :checking="!!state.checking[item.id]" :pending="state.pending[item.id]" @decide="decide" @check="check" @undo="undo" />
      <div v-else class="message-management">
        <InboxTags :tags="item.pod?.tags" />
        <div class="actions">
          <button type="button" class="secondary" :disabled="!online" @click="change({ archived: !item.archived })">
            {{ item.archived ? t('itemUnarchive') : t('itemArchive') }}
          </button>
          <button type="button" class="secondary" :disabled="!online || !item.read" @click="change({ read: false })">
            {{ t('itemMarkUnread') }}
          </button>
        </div>
      </div>
    </article>
  </InboxShell>
</template>

<style scoped>
.back { display: inline-flex; align-items: center; min-height: 44px; text-decoration: none; }
.links { padding-left: 1.2em; display: grid; gap: 8px; }
.links small { display: block; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
.message-detail { padding-top: 12px; }
.message-detail h1 { font-size: 1.45em; line-height: 1.2; margin: 6px 0 20px; }
.message-meta { font-size: .8em; margin: 0 0 8px; }
.message-detail .inbox-body { font-size: 1.05em; line-height: 1.55; margin-bottom: 24px; }
.primary-link { display: grid; gap: 8px; justify-items: start; margin: 24px 0 32px; }
.primary-link a { display: inline-flex; align-items: center; justify-content: space-between; gap: 20px; box-sizing: border-box; min-height: 48px; padding: 12px 20px; border-radius: 10px; background: var(--accent); color: var(--bg); font-weight: 600; text-decoration: none; }
.primary-link small { font-size: .75em; }
.message-management { border-top: 1px solid var(--line); padding-top: 20px; margin-top: 32px; }
.message-management .actions { font-size: .85em; }
</style>
