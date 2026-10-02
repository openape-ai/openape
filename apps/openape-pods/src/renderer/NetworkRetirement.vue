<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import type { StoredPod } from '../contracts/control'
import type { NetworkSummary, NetworkView } from '../contracts/networks'
import type { ArchivePreview, LegacyItemsPage } from '../contracts/network-retirement'
import { diagnostic, t } from './i18n'

export default defineComponent({
  props: { pods: { type: Array as PropType<StoredPod[]>, default: () => [] }, network: { type: Object as PropType<NetworkSummary>, required: true } },
  emits: ['changed'],
  data() { return { review: null as ArchivePreview | null, items: null as LegacyItemsPage | null, confirmed: false, busy: false, error: '', notice: '', closed: false, request: 0 } },
  watch: {
    'network.revision': function () { this.networkChanged() },
    'network.state': function () { this.networkChanged() },
  },
  beforeUnmount() { this.closed = true; this.request++ },
  methods: {
    t, diagnostic,
    networkChanged() {
      this.notice = this.review && this.network.state !== 'archived' ? t('The network changed. Review archival again.') : ''
      this.invalidate(); this.items = null
    },
    invalidate() { this.request++; this.review = null; this.confirmed = false },
    async load(kind: 'archivePreview' | 'legacyItems', after: number | null = null) {
      if (this.busy) return
      const request = ++this.request
      this.busy = true; this.error = ''; this.notice = ''; if (kind === 'archivePreview') this.confirmed = false
      try {
        const common = { id: this.network.id, revision: this.network.revision }
        const response = await window.pods.networks(kind === 'archivePreview' ? { type: kind, ...common } : { type: kind, ...common, after })
        if (this.closed || request !== this.request) return
        if (kind === 'archivePreview') this.review = response.archiveReview!
        else this.items = response.legacyItems!
        this.$emit('changed', response)
        await this.focus(kind === 'archivePreview' ? 'reviewHeading' : 'itemsHeading')
      }
      catch (error) { if (!this.closed && request === this.request) { this.error = error instanceof Error ? error.message : String(error); await this.focusError() } }
      finally { this.busy = false }
    },
    async archive() {
      if (!this.review || this.review.issues.length || !this.confirmed || this.busy || this.network.state !== 'paused') return
      this.busy = true; this.error = ''
      try {
        const response: NetworkView = await window.pods.networks({ type: 'archiveNetwork', id: this.network.id, revision: this.network.revision, expectedFingerprint: this.review.fingerprint })
        if (!this.closed) { this.invalidate(); this.$emit('changed', response); await this.focus('heading') }
      }
      catch (error) { if (!this.closed) { this.error = error instanceof Error ? error.message : String(error); this.invalidate(); await this.focusError() } }
      finally { this.busy = false }
    },
    async focus(name: 'heading' | 'reviewHeading' | 'itemsHeading') { await this.$nextTick(); if (!this.closed) (this.$refs[name] as HTMLElement)?.focus() },
    async focusError() { await this.$nextTick(); (this.$refs.error as HTMLElement)?.focus() },
  },
})
</script>

<template>
  <section class="network-retirement">
    <h2 ref="heading" tabindex="-1">
      {{ t('Preserved history and archival') }}
    </h2>
    <p role="status">
      {{ busy ? t('Loading workspace…') : notice }}
    </p>
    <p v-if="network.state === 'archived'" role="status">
      {{ t('This network is archived. History and Pod identities remain available; execution cannot resume.') }}
    </p>
    <div class="network-actions">
      <button class="secondary" :disabled="busy" @click="load('legacyItems')">
        {{ t('Inspect retained legacy items') }}
      </button><button v-if="network.state !== 'archived'" class="secondary" :disabled="busy || network.state !== 'paused'" :aria-describedby="network.state === 'active' ? 'archive-pause' : undefined" @click="load('archivePreview')">
        {{ t('Review archival') }}
      </button>
    </div>
    <p v-if="network.state === 'active'" id="archive-pause">
      {{ t('Pause the network before reviewing archival') }}
    </p>
    <p v-if="error" ref="error" tabindex="-1" role="alert" class="error-message">
      {{ diagnostic(error) }}
    </p>
    <section v-if="review">
      <h3 ref="reviewHeading" tabindex="-1">
        {{ t('Terminal archival review') }}
      </h3>
      <p>{{ t('Archival is terminal. It preserves identities, scripts, rights, history and effect receipts. Existing Pods remain bound to this historical network; use fresh instances for another composition.') }}</p>
      <p>{{ t('Existing retention rules still apply to diagnostic traces; protected receipts remain.') }}</p>
      <p>{{ t('Members preserved: {members} · Legacy deliveries retained: {items}', { members: review.members, items: review.retainedDeliveries }) }}</p>
      <p v-if="review.issues.length">
        {{ t('Archival is blocked until these items are resolved:') }}
      </p>
      <ul v-if="review.issues.length">
        <li v-for="issue in review.issues" :key="issue">
          {{ diagnostic(issue) }}
        </li>
      </ul>
      <div v-else class="network-actions">
        <label><input v-model="confirmed" type="checkbox" :disabled="busy">{{ t('Permanently archive this settled network without replay. This cannot be undone.') }}</label><button class="secondary" :disabled="busy || !confirmed" @click="archive">
          {{ t('Archive network') }}
        </button>
      </div>
      <button class="text-button" :disabled="busy" @click="invalidate(); error = ''; focus('heading')">
        {{ t('Cancel') }}
      </button>
    </section>
    <section v-if="items" class="legacy-items">
      <h3 ref="itemsHeading" tabindex="-1">
        {{ t('Retained legacy items') }}
      </h3><p>{{ t('These items remain in the disabled ancestor. Inspection never imports, deletes or replays them.') }}</p>
      <p v-if="!items.workflowId">
        {{ t('This network was not converted from a legacy graph.') }}
      </p>
      <p v-else-if="!items.items.length">
        {{ t('No retained legacy deliveries on this page.') }}
      </p>
      <article v-for="item in items.items" :key="`${item.itemId}:${item.podId}`">
        <h4>{{ item.key }}</h4><p>{{ item.itemId }} · {{ pods.find(pod => pod.id === item.podId)?.name ?? item.podId }} · {{ diagnostic(item.state) }}</p><p>{{ t('Original payload digest') }}: <code>{{ item.originalHash }}</code></p><p v-if="item.currentHash">
          {{ t('Current payload digest') }}: <code>{{ item.currentHash }}</code>
        </p><p v-if="item.originalHash === item.currentHash">
          {{ t('Matches the conversion receipt.') }}
        </p><p v-if="item.originalHash !== item.currentHash" class="error-message">
          {{ t('The retained item is missing or differs from its conversion receipt. Reconcile it before any manual follow-up.') }}
        </p><pre>{{ item.payload ?? t('Missing retained payload') }}</pre><p v-if="item.truncated" role="status">
          {{ t('Payload preview is truncated; the original remains stored locally.') }}
        </p>
      </article>
      <button v-if="items.after !== null" class="secondary" :disabled="busy" @click="load('legacyItems', items.after)">
        {{ t('Next page') }}
      </button><button class="text-button" :disabled="busy" @click="items = null; error = ''; focus('heading')">
        {{ t('Close') }}
      </button>
    </section>
  </section>
</template>

<style>
.network-retirement{display:flex;flex-direction:column;gap:12px;margin-top:24px;padding:16px;border:1px solid var(--border);border-radius:12px;min-width:0}.network-retirement label{display:flex;gap:8px;align-items:start}.network-retirement input[type=checkbox]{width:auto;flex-shrink:0}.network-retirement p{line-height:1.5;overflow-wrap:anywhere}.network-retirement .legacy-items h4{overflow-wrap:anywhere}.network-retirement .legacy-items article{border-top:1px solid var(--border);padding:12px 0}.network-retirement .legacy-items pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto}
</style>
