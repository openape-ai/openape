<script setup lang="ts">
import InboxList from '../../components/InboxList.vue'
import InboxShell from '../../components/InboxShell.vue'
import { useInbox } from '../../inbox/client'
import type { InboxItem } from '../../inbox/client'
import { t } from '../../inbox/i18n'

const inbox = useInbox()
async function decide(item: InboxItem, option: string) { await inbox.decide(item, option) }
</script>

<template>
  <InboxShell>
    <h1>{{ t('tabDecisions') }}</h1>
    <InboxList :items="inbox.openDecisions.value" :receipts="inbox.state.receipts" :online="inbox.state.phase === 'ready'" :empty="t('decisionsEmpty')" @decide="decide" />
    <h2>{{ t('decisionsHistory') }}</h2>
    <InboxList :items="inbox.completedDecisions.value" :receipts="inbox.state.receipts" :empty="t('decisionsHistoryEmpty')" />
  </InboxShell>
</template>
