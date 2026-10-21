<script setup lang="ts">
import { computed, ref } from 'vue'
import InboxList from '../../components/InboxList.vue'
import InboxShell from '../../components/InboxShell.vue'
import { useInbox } from '../../inbox/client'
import type { InboxItem } from '../../inbox/client'
import { t } from '../../inbox/i18n'

const inbox = useInbox()
const route = useRoute()
const archive = computed(() => route.query.archived === '1')
const error = ref('')
// A swipe changes only that message, through the same account-wide mark the detail view uses.
async function mark(item: InboxItem, change: { read: true } | { archived: true }) {
  error.value = ''
  try { await inbox.mark(item.id, change) }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
}
</script>

<template>
  <InboxShell>
    <h1>{{ archive ? t('messagesArchive') : t('tabMessages') }}</h1>
    <p v-if="error" class="inbox-error" role="alert">
      {{ error }}
    </p>
    <InboxList v-if="archive" :items="inbox.archivedMessages.value" :empty="t('messagesArchiveEmpty')" />
    <InboxList v-else :items="inbox.messages.value" :empty="t('messagesEmpty')" :online="inbox.state.phase === 'ready'" swipe @mark="mark" />
    <NuxtLink class="more" :to="archive ? '/inbox/messages' : '/inbox/messages?archived=1'">
      {{ archive ? t('messagesShowInbox') : t('messagesShowArchive') }}
    </NuxtLink>
  </InboxShell>
</template>

<style scoped>
.more { display: inline-flex; align-items: center; min-height: 44px; }
</style>
