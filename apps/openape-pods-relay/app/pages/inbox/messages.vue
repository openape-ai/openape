<script setup lang="ts">
import { computed } from 'vue'
import InboxList from '../../components/InboxList.vue'
import InboxShell from '../../components/InboxShell.vue'
import { useInbox } from '../../inbox/client'
import { t } from '../../inbox/i18n'

const inbox = useInbox()
const route = useRoute()
const archive = computed(() => route.query.archived === '1')
</script>

<template>
  <InboxShell>
    <h1>{{ archive ? t('messagesArchive') : t('tabMessages') }}</h1>
    <InboxList v-if="archive" :items="inbox.archivedMessages.value" :empty="t('messagesArchiveEmpty')" />
    <InboxList v-else :items="inbox.messages.value" :empty="t('messagesEmpty')" />
    <NuxtLink class="more" :to="archive ? '/inbox/messages' : '/inbox/messages?archived=1'">
      {{ archive ? t('messagesShowInbox') : t('messagesShowArchive') }}
    </NuxtLink>
  </InboxShell>
</template>

<style scoped>
.more { display: inline-flex; align-items: center; min-height: 44px; }
</style>
