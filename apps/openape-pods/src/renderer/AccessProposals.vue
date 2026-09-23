<script setup lang="ts">
import ChatSetupReview from './ChatSetupReview.vue'
import { t, label } from './i18n'
import type { MasterCommand, MasterView } from '../contracts/master'

// Pending access proposals for the owner's existing forms, shown in the chat
// and in the Codex review view (issue 1375).
defineProps<{ view: MasterView, busy: boolean }>()
const emit = defineEmits<{ command: [value: MasterCommand], updated: [], settings: [podId: string, alias?: string], resources: [podId: string] }>()
function command(value: MasterCommand): void { emit('command', value) }
function setupUpdated(): void { emit('updated') }
</script>

<template>
  <section v-if="view?.proposals.length" :aria-label="t('Access proposals')">
    <h3>{{ t("Resource access for your review") }}</h3><details v-for="proposal in view.proposals" :key="proposal.id" class="chat-access" :open="proposal.state === 'pending'">
      <summary>{{ proposal.body.description }}<span v-if="proposal.state !== 'pending'" class="muted"> · {{ label(proposal.state) }}</span></summary><dl class="proposal-scope">
        <dt>{{ t("Service") }}</dt><dd>{{ proposal.body.provider === 'credential' ? t('Secrets') : proposal.body.provider === 'directory' ? t('Directory permissions') : proposal.body.provider === 'reference' ? t('Files and folders') : proposal.body.provider === 'variable' ? t('Variables') : proposal.body.provider === 'http' ? t('HTTP destinations') : t('Executable applications') }}</dd>
        <template v-if="proposal.body.alias">
          <dt>{{ t(proposal.body.provider === 'variable' ? 'Variable name' : 'Secret name') }}</dt><dd>{{ proposal.body.alias }}</dd>
        </template>
        <template v-if="proposal.body.application">
          <dt>{{ t('Application') }}</dt><dd>{{ proposal.body.application }}</dd>
        </template>
        <template v-if="proposal.body.command">
          <dt>{{ t('Program arguments') }}</dt><dd>{{ proposal.body.command }}</dd>
        </template>
        <template v-if="proposal.body.origin">
          <dt>{{ t('HTTPS origin') }}</dt><dd>{{ proposal.body.origin }}</dd>
        </template>
        <template v-if="proposal.body.account">
          <dt>{{ t("Account") }}</dt><dd>{{ proposal.body.account }}</dd>
        </template>
        <template v-if="proposal.body.folders">
          <dt>{{ t("Folders") }}</dt><dd>{{ (proposal.body.folders as string[]).join(', ') }}</dd>
        </template>
        <template v-if="proposal.body.attachments !== undefined">
          <dt>{{ t("Attachments") }}</dt><dd>{{ proposal.body.attachments ? t("Include readable attachments") : t("Do not read attachments") }}</dd>
        </template>
      </dl>
      <p v-if="proposal.body.instructions" class="master-text">
        {{ proposal.body.instructions }}
      </p>
      <p v-else-if="proposal.body.provider === 'credential' && proposal.body.alias === 'telegram_bot_token'" class="master-text">
        {{ t('In Telegram, open @BotFather. Use /newbot to create a bot or /mybots to select an existing bot and its API token. Save the token only in Variables and secrets, never in this chat. Then open your bot and send /start.') }}
      </p>
      <div v-if="proposal.state === 'pending'" class="overview-actions">
        <ChatSetupReview v-if="['http', 'directory', 'reference', 'application', 'variable'].includes(proposal.body.provider)" :proposal="proposal" @updated="setupUpdated" />
        <button v-else class="secondary" @click="proposal.body.provider === 'credential' ? emit('settings', proposal.podId, proposal.body.alias) : emit('resources', proposal.podId)">
          {{ proposal.body.provider === 'credential' ? t('Variables and secrets') : t('Review resources') }}
        </button><button class="text-button" :disabled="busy" @click="command({ type: 'decline', id: proposal.id, podId: proposal.podId })">
          {{ t("Decline") }}
        </button>
      </div>
    </details>
  </section>
</template>

<style scoped>
.chat-access { margin:24px 0 0; font-size:13px; border:1px solid var(--border); border-radius:12px; padding:14px; }
.chat-access summary { line-height:1.6; }
.chat-access pre { white-space:pre-wrap; overflow-wrap:anywhere; max-height:320px; overflow:auto; }
.master-text { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; font-size:15px; line-height:1.75; }
@media(max-width:760px) { .master-text { font-size:14px; } }
</style>
