<script setup lang="ts">
import { t, diagnostic, label } from './i18n'
import type { MasterCommand, MasterView } from '../contracts/master'

// Owner review of prepared change sets: the in-app chat and the Codex review
// view render the same decisions (issue 1375).
defineProps<{ view: MasterView, busy: boolean }>()
const emit = defineEmits<{ command: [value: MasterCommand], run: [podId: string, runId: string], workflow: [id: string] }>()
function command(value: MasterCommand): void { emit('command', value) }
</script>

<template>
  <section v-if="view?.changes?.length" :aria-label="t('Changes for review')">
    <h3>{{ t('Changes for review') }}</h3>
    <details v-for="change in view.changes" :key="change.id" class="chat-access" :open="change.state === 'pending'">
      <summary>{{ t(change.kind === 'run' ? 'Run once' : 'Saved changes') }} · {{ change.targets.map(target => target.name).join(', ') }} · {{ change.kind === 'run' && change.state === 'applied' ? t('Run requested') : label(change.state) }}</summary>
      <details v-if="change.workflow">
        <summary>{{ change.workflow.before.name }} · {{ t('Workflow changes') }}</summary><div class="change-columns">
          <section><h5>{{ t('Before') }}</h5><pre>{{ JSON.stringify(change.workflow.before, null, 2) }}</pre></section><section><h5>{{ t('Proposed') }}</h5><pre>{{ JSON.stringify(change.workflow.command, null, 2) }}</pre></section>
        </div>
      </details>
      <p v-if="change.error" role="alert" class="error-message">
        <strong v-if="change.errorPodId">{{ change.targets.find(target => target.podId === change.errorPodId)?.name }}: </strong>{{ diagnostic(change.error) }}
      </p>
      <p v-if="change.contextRevision !== view.conversation?.revision" class="muted">
        {{ t('Earlier context: inspect and prepare these changes again before applying.') }}
      </p>
      <article v-for="target in change.targets" :key="target.podId">
        <h4>{{ target.name }}</h4>
        <details v-for="(review, index) in target.review" :key="index" class="change-diff">
          <summary>{{ t(review.action.startsWith('setVariable') ? 'Change variable' : review.action === 'activate' ? 'Use script version' : review.action === 'rollback' ? 'Restore script version' : review.action === 'revise' ? 'Rename Pod' : review.action === 'setGroup' ? 'Change group' : review.action === 'prepareSchedule' ? 'Prepare disabled schedule' : review.action === 'pause' ? 'Pause Pod' : 'Run once') }}{{ review.action.includes(':') ? review.action.slice(review.action.indexOf(':')) : '' }}</summary>
          <div class="change-columns">
            <section><h5>{{ t('Before') }}</h5><pre>{{ review.before || t('none') }}</pre></section><section><h5>{{ t('Proposed') }}</h5><pre>{{ review.after || t('none') }}</pre></section>
          </div>
          <details v-if="review.evidence">
            <summary>{{ t('Validation details') }}</summary><pre>{{ review.evidence }}</pre>
          </details>
        </details>
        <p v-if="change.state === 'applied' && change.kind !== 'run'">
          {{ t(target.changedSinceApply ? 'Applied then; configuration changed later' : 'Applied with a saved receipt') }}
        </p>
        <div v-for="execution in change.execution?.filter(item => item.podId === target.podId)" :key="execution.runId ?? execution.podId" class="run-receipt">
          <strong>{{ label(execution.state) }}</strong><p v-if="execution.error" class="error-message">
            {{ diagnostic(execution.error) }}
          </p><button v-if="execution.runId" class="text-button" @click="emit('run', execution.podId, execution.runId)">
            {{ t('View run trace') }}
          </button><button v-else-if="execution.workflowId" class="text-button" @click="emit('workflow', execution.workflowId!)">
            {{ t('Open workflow') }}
          </button>
        </div>
        <details v-if="change.results.some(result => result.podId === target.podId)">
          <summary>{{ t('Receipt') }}</summary><pre>{{ JSON.stringify(change.results.filter(result => result.podId === target.podId), null, 2) }}</pre>
        </details>
      </article>
      <div v-if="change.state === 'pending' && change.contextRevision === view.conversation?.revision" class="overview-actions">
        <button class="primary" :disabled="busy || !!view.activeConversationId" @click="command({ type: 'applyChanges', id: change.id, revision: change.revision })">
          {{ t(change.kind === 'run' ? 'Run once' : 'Apply changes together') }}
        </button><button class="secondary" :disabled="busy" @click="command({ type: 'discardChanges', id: change.id, revision: change.revision })">
          {{ t('Discard changes') }}
        </button>
      </div>
    </details>
  </section>
</template>

<style scoped>
.change-columns { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.change-columns section { min-width:0; }
.change-diff { margin:10px 0; }
@media(max-width:760px) { .change-columns { grid-template-columns:1fr; } }
.chat-access { margin:24px 0 0; font-size:13px; border:1px solid var(--border); border-radius:12px; padding:14px; }
.chat-access summary { line-height:1.6; }
.chat-access pre { white-space:pre-wrap; overflow-wrap:anywhere; max-height:320px; overflow:auto; }
</style>
