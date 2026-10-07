<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import InboxList from '../../components/InboxList.vue'
import InboxShell from '../../components/InboxShell.vue'
import { useInbox } from '../../inbox/client'
import type { InboxItem } from '../../inbox/client'
import { t } from '../../inbox/i18n'

const inbox = useInbox()
// Once the owner touches or scrolls the list, it keeps the cards it showed, in place: new decisions wait behind a
// floating hint and answered ones stay where they were, so nothing moves under a finger. Until then it follows the
// service (also the first sync after opening the app); leaving the tab starts fresh.
const shown = ref<string[]>([])
const frozen = ref(false)
const openIds = computed(() => inbox.openDecisions.value.map(item => item.id))
watch(openIds, (ids) => { if (!frozen.value) shown.value = [...ids] }, { immediate: true })
const visible = computed(() => shown.value.map(id => inbox.state.items[id]).filter((item): item is InboxItem => !!item))
const fresh = computed(() => openIds.value.filter(id => !shown.value.includes(id)).length)
const completed = computed(() => inbox.completedDecisions.value.filter(item => !shown.value.includes(item.id)))
function freeze() { frozen.value = true }
function showFresh() {
  shown.value = [...openIds.value]
  window.scrollTo({ top: 0 })
}
onMounted(() => window.addEventListener('scroll', freeze, { passive: true, once: true }))
onUnmounted(() => window.removeEventListener('scroll', freeze))
async function decide(item: InboxItem, option: string) { await inbox.answer(item, option) }
function undo(item: InboxItem) { inbox.undo(item.id) }
</script>

<template>
  <InboxShell>
    <h1>{{ t('tabDecisions') }}</h1>
    <button v-if="fresh" type="button" class="fresh" @click="showFresh">
      {{ t('newDecisions', { count: fresh }) }}
    </button>
    <InboxList :items="visible" :receipts="inbox.state.receipts" :pending="inbox.state.pending" :online="inbox.state.phase === 'ready'" actions :empty="t('decisionsEmpty')" @pointerdown.capture="freeze" @decide="decide" @undo="undo" />
    <h2>{{ t('decisionsHistory') }}</h2>
    <InboxList :items="completed" :receipts="inbox.state.receipts" :empty="t('decisionsHistoryEmpty')" />
  </InboxShell>
</template>

<style scoped>
.fresh { position: fixed; top: calc(env(safe-area-inset-top) + 8px); left: 50%; transform: translateX(-50%); z-index: 4; border-radius: 999px; box-shadow: 0 2px 10px rgb(0 0 0 / 25%); }
</style>
