<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import type { RunEvent } from '../contracts/runs'
import { agentModelSizeLabels, agentThinkingLabels } from '../contracts/agent'
import { agentCalls } from './run-activity'
import { t, label } from './i18n'

export default defineComponent({
  props: { events: { type: Array as PropType<RunEvent[]>, required: true } },
  computed: { calls() { return agentCalls(this.events) } },
  methods: { t, label, size(value: keyof typeof agentModelSizeLabels) { return label(agentModelSizeLabels[value]) }, thinking(value: keyof typeof agentThinkingLabels) { return label(agentThinkingLabels[value]) } },
})
</script>

<template>
  <section v-if="calls.length" class="agent-call-history">
    <h3>{{ t('Agent calls') }}</h3>
    <article v-for="call in calls" :key="call.callId" class="agent-call" :data-state="call.status">
      <p><strong>{{ call.provider === 'claude' ? 'Claude' : 'Codex' }} · {{ label(call.backend === 'proxy' ? 'Proxy' : 'Native') }}</strong> · {{ label(call.status) }}</p>
      <p class="agent-model">
        <span v-if="call.modelSize">{{ size(call.modelSize) }} · </span><code>{{ call.modelId ?? t('Model unresolved') }}</code>
      </p>
      <p v-if="call.backend === 'native'" class="muted">
        {{ t('Account default at call start') }}
      </p>
      <p v-else-if="call.effectiveThinking" class="muted">
        {{ t('Thinking') }}: {{ thinking(call.effectiveThinking) }}<span v-if="call.requestedThinking === null"> · {{ t('Configured default') }}</span>
      </p>
      <p v-if="call.durationMs !== null" class="muted">
        {{ t('Duration: {p0} ms', { p0: call.durationMs }) }}
      </p>
      <p class="muted">
        {{ t('Tokens in / out') }}: {{ call.usage?.input ?? t('Unknown') }} / {{ call.usage?.output ?? t('Unknown') }}
      </p>
      <p v-if="call.error" class="error-message">
        {{ call.error.code }} · {{ call.error.details.phase }}<span v-if="call.error.details.httpStatus"> · HTTP {{ call.error.details.httpStatus }}</span>: {{ call.error.message }}
      </p>
      <p v-if="call.error?.details.cause || call.error?.details.providerCode || call.error?.details.retryAfter" class="muted">
        {{ [call.error.details.cause, call.error.details.providerCode, call.error.details.retryAfter ? `Retry-After: ${call.error.details.retryAfter}` : ''].filter(Boolean).join(' · ') }}
      </p>
    </article>
  </section>
</template>

<style scoped>
.agent-call-history{margin:20px 0}.agent-call{border-top:1px solid var(--border);padding:14px 0;min-width:0;overflow-wrap:anywhere}.agent-call p{margin:5px 0}.agent-model code{white-space:normal;overflow-wrap:anywhere}.agent-call[data-state="failed"],.agent-call[data-state="timeout"]{border-inline-start:3px solid var(--danger);padding-inline-start:12px}
</style>
