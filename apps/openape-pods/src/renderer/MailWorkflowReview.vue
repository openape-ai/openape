<script lang="ts">
import { defineComponent } from 'vue'
import type { MailBatchReview, MailEffectResolution } from '../contracts/mail-workflow'
import { t, diagnostic, label } from './i18n'

export default defineComponent({
  props: { batchId: { type: String, required: true } },
  data() { return { review: null as MailBatchReview | null, busy: false, error: '', key: '', evidence: '', messageId: '', moveReceipt: '' } },
  methods: {
    t, diagnostic, label,
    async refresh() {
      if (this.busy) return
      this.busy = true; this.error = ''
      try { this.review = (await window.pods.workflows({ type: 'mailReview', batchId: this.batchId })).mailReview ?? null }
      catch (error) { this.error = error instanceof Error ? error.message : String(error) }
      finally { this.busy = false }
    },
    async resolve(outcome: MailEffectResolution['outcome']) {
      if (this.busy) return
      this.busy = true; this.error = ''
      try {
        const effect = this.review?.effects.find(effect => effect.key === this.key)
        const resolution: MailEffectResolution = { batchId: this.batchId, key: this.key, evidence: this.evidence, outcome,
          ...(outcome === 'confirmed' && effect?.operation === 'mail.telegram' ? { messageId: Number(this.messageId) } : {}),
          ...(outcome === 'confirmed' && effect?.operation === 'mail.move' ? { move: JSON.parse(this.moveReceipt) as MailEffectResolution['move'] } : {}),
        }
        this.review = (await window.pods.workflows({ type: 'mailResolve', resolution })).mailReview ?? null; this.key = ''; this.evidence = ''
      }
      catch (error) { this.error = error instanceof Error ? error.message : String(error) }
      finally { this.busy = false }
    },
  },
})
</script>

<template>
  <details class="mail-batch-review" @toggle="($event.target as HTMLDetailsElement).open && refresh()">
    <summary>{{ t('Mail batch and delivery receipts') }}</summary>
    <button class="secondary" :disabled="busy" @click="refresh">
      {{ t('Refresh') }}
    </button>
    <p v-if="error" class="error-message" role="alert">
      {{ diagnostic(error) }}
    </p>
    <template v-if="review">
      <p>{{ review.mailbox }} · {{ label(review.phase) }}</p><p v-if="review.baseline">
        {{ t('Quiet baseline: no historical moves or notifications.') }}
      </p>
      <ol>
        <li v-for="item in review.items" :key="item.id">
          <strong>{{ item.sender }} · {{ item.subject }}</strong><p>{{ label(item.disposition) }} · {{ diagnostic(item.reason) }}</p><small v-if="item.receipt">{{ t('Confirmed move receipt') }}: {{ item.receipt.requestId }}</small>
        </li>
      </ol>
      <article v-for="delivery in review.deliveries" :key="delivery.key">
        <span class="badge">{{ label(delivery.state) }}</span><span v-if="delivery.messageId"> · {{ t('Telegram message') }} {{ delivery.messageId }}</span><pre>{{ delivery.body }}</pre><p v-if="delivery.reason">
          {{ diagnostic(delivery.reason) }}
        </p>
      </article>
      <div v-for="effect in review.effects.filter(effect => ['unknown', 'notApplied'].includes(effect.state))" :key="effect.key">
        <p>{{ effect.operation }} · {{ t('Outcome needs review') }}</p><button class="secondary" :disabled="busy" @click="key = effect.key; evidence = ''; messageId = ''; moveReceipt = ''">
          {{ t('Record reconciliation evidence') }}
        </button>
      </div>
      <form v-if="key" class="mail-reconciliation" @submit.prevent="resolve('confirmed')">
        <p>{{ t('Stop the affected run first. A message found in Archive is not proof that this workflow moved it.') }}</p>
        <label>{{ t('Observed evidence') }}<textarea v-model="evidence" required minlength="10" maxlength="4000" /></label>
        <label v-if="review.effects.find(effect => effect.key === key)?.operation === 'mail.telegram'">{{ t('Confirmed Telegram message ID') }}<input v-model="messageId" type="number" min="1"></label>
        <label v-else>{{ t('Provider move receipt (JSON)') }}<textarea v-model="moveReceipt" rows="4" /></label>
        <div class="overview-actions">
          <button class="primary" :disabled="busy || evidence.trim().length < 10">
            {{ t('Confirm with receipt') }}
          </button><button type="button" class="secondary" :disabled="busy || evidence.trim().length < 10" @click="resolve('notApplied')">
            {{ t('Confirmed not applied') }}
          </button>
        </div>
        <p class="muted">
          {{ t('A move confirmed not applied stays in the inbox. A Telegram message confirmed not delivered may be retried once through the workflow.') }}
        </p>
      </form>
    </template>
  </details>
</template>

<style scoped>
.mail-batch-review { margin:16px 0; overflow-wrap:anywhere; }
.mail-batch-review li { padding:10px 0; }
.mail-batch-review pre { white-space:pre-wrap; max-width:100%; padding:12px; border:1px solid var(--border); }
.mail-reconciliation { display:grid; gap:12px; }
.mail-reconciliation label { display:grid; gap:6px; }
.mail-reconciliation textarea,.mail-reconciliation input { max-width:100%; border:1px solid var(--border); padding:10px; color:var(--text); background:var(--surface); }
</style>
