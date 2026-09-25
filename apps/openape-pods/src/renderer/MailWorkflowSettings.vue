<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import type { MailWorkflowConfiguration } from '../contracts/mail-workflow'
import type { StoredPod } from '../contracts/control'
import type { PodResource } from '../contracts/resources'
import { t, diagnostic } from './i18n'

export default defineComponent({
  props: { configuration: { type: Object as PropType<MailWorkflowConfiguration>, required: true }, pods: { type: Array as PropType<StoredPod[]>, required: true }, readonly: Boolean },
  emits: ['update'],
  data() { return { draft: JSON.parse(JSON.stringify(this.configuration)) as MailWorkflowConfiguration, partners: this.configuration.protectedPartners.map(partner => partner.kind === 'domain' ? `@${partner.value}` : partner.value).join('\n'), applications: [] as PodResource[], error: '' } },
  async mounted() { await this.loadApplications() },
  methods: {
    t, diagnostic,
    publish() { this.$emit('update', JSON.parse(JSON.stringify(this.draft))) },
    updatePartners() { this.draft.protectedPartners = this.partners.split('\n').map(value => value.trim()).filter(Boolean).map(value => ({ kind: value.startsWith('@') ? 'domain' : 'address', value: value.replace(/^@/, '') })); this.publish() },
    addRule() { this.draft.rules.push({ id: crypto.randomUUID(), enabled: false, sender: '', listId: '', subjectPrefix: '' }); this.publish() },
    removeRule(id: string) { this.draft.rules = this.draft.rules.filter(rule => rule.id !== id); this.publish() },
    async loadApplications() {
      if (!this.draft.filterPodId) return
      try { const result = await window.pods.resources({ type: 'list', podId: this.draft.filterPodId }); this.applications = result.resources.filter(item => item.kind === 'tool' && item.configuration.type === 'program' && item.state === 'ready'); this.error = '' }
      catch (error) { this.error = error instanceof Error ? error.message : String(error) }
    },
  },
})
</script>

<template>
  <fieldset class="mail-workflow-settings" :disabled="readonly" @input="publish" @change="publish">
    <legend>{{ t('Mail filtering integration') }}</legend>
    <p>{{ t('The first run records a quiet baseline. Historical inbox messages are not archived or reported.') }}</p>
    <p class="muted">
      {{ t('Use the batch-aware mail recipes for these two pods. Adding ordinary pods to a graph does not constrain their mailbox reads.') }}
    </p>
    <label>{{ t('Mailbox') }}<input v-model="draft.mailbox" type="email" required></label>
    <label>{{ t('Filter pod') }}<select v-model="draft.filterPodId" required @change="loadApplications"><option value="">{{ t('Choose a pod') }}</option><option v-for="pod in pods" :key="pod.id" :value="pod.id">{{ pod.name }}</option></select></label>
    <label>{{ t('Notification pod') }}<select v-model="draft.notifyPodId" required><option value="">{{ t('Choose a pod') }}</option><option v-for="pod in pods" :key="pod.id" :value="pod.id">{{ pod.name }}</option></select></label>
    <label>{{ t('Assigned mail application') }}<select v-model="draft.applicationId" required><option value="">{{ t('Choose an assigned application') }}</option><option v-for="app in applications" :key="app.id" :value="app.id">{{ app.name }}</option></select></label>
    <p v-if="error" role="alert" class="error-message">
      {{ diagnostic(error) }}
    </p>
    <label>{{ t('Telegram destination') }}<input v-model="draft.telegramChatId" required inputmode="numeric"></label>
    <label>{{ t('Telegram secret alias') }}<input v-model="draft.telegramCredential" required></label>
    <p class="muted">
      {{ t('Assign this secret alias and Telegram HTTP access to both pods. The token stays in the existing secret store.') }}
    </p>
    <label>{{ t('Protected communication partners') }}<textarea v-model="partners" rows="5" @change="updatePartners" /></label>
    <p class="muted">
      {{ t('One exact email address or @domain per line. Matching senders, recipients and known conversations always stay for human review. Subdomains are not inferred.') }}
    </p>
    <fieldset v-for="rule in draft.rules" :key="rule.id" class="mail-rule">
      <legend>{{ t('Archive rule') }}</legend>
      <label>{{ t('Exact sender') }}<input v-model="rule.sender" type="email" required></label><label>{{ t('Exact mailing list identity') }}<input v-model="rule.listId" required></label><label>{{ t('Subject starts with') }}<input v-model="rule.subjectPrefix" required></label><label><input v-model="rule.enabled" type="checkbox">{{ t('Enable this reviewed rule') }}</label><button v-if="!readonly" type="button" class="secondary" @click="removeRule(rule.id)">
        {{ t('Remove rule') }}
      </button>
    </fieldset>
    <button v-if="!readonly" type="button" class="secondary" @click="addRule">
      {{ t('Add archive rule') }}
    </button>
    <p>{{ t('Personal or uncertain mail, attachments, flags, invoices, contracts, security notices, deadlines and action requests are retained.') }}</p>
    <label>{{ t('Mail operation mode') }}<select v-model="draft.mode"><option value="preview">{{ t('Preview only — no moves or Telegram sends') }}</option><option value="archive">{{ t('Archive and notify after separate owner approval') }}</option></select></label>
    <p class="error-message">
      {{ t('Live automatic archiving remains blocked until the mail provider supports verified conditional moves.') }}
    </p>
  </fieldset>
</template>

<style scoped>
.mail-workflow-settings { display:grid; gap:12px; border:1px solid var(--border); border-radius:12px; padding:18px; min-width:0; }
.mail-workflow-settings label { display:grid; gap:7px; }
.mail-workflow-settings input,.mail-workflow-settings select,.mail-workflow-settings textarea { max-width:100%; min-width:0; padding:9px; border:1px solid var(--border); border-radius:8px; background:var(--surface); color:var(--text); }
.mail-workflow-settings input[type=checkbox] { width:auto; justify-self:start; }
.mail-rule { display:grid; gap:10px; padding:16px; border:1px solid var(--border); }
</style>
