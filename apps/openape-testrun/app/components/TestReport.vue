<script setup lang="ts">
import AppIcon from './AppIcon.vue'

interface PublicStep {
  title: string
  status?: 'passed' | 'failed' | 'skipped'
  caption_html: string
  shot: string | null
}

interface PublicTest {
  id: string
  title: string
  status: 'passed' | 'failed' | 'skipped'
  description_html: string
  error_html: string
  steps: PublicStep[]
}

interface RunVersion {
  version: number
  status: 'passed' | 'failed' | 'skipped'
  created_at: number
}

export interface PublicRun {
  title: string
  project: string | null
  status: 'passed' | 'failed' | 'skipped'
  passed: number
  failed: number
  skipped: number
  summary_html: string
  started_at: number | null
  finished_at: number | null
  created_by: string
  created_by_act: 'human' | 'agent'
  created_at: number
  version: number
  latest_version: number
  versions: RunVersion[]
  tests: PublicTest[]
}

const props = defineProps<{ run: PublicRun }>()

function fmtDuration(start: number | null, finish: number | null): string | null {
  if (!start || !finish || finish < start) return null
  const seconds = finish - start
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}
const duration = fmtDuration(props.run.started_at, props.run.finished_at)
const shots = props.run.tests.reduce((count, test) => count + test.steps.filter(step => step.shot).length, 0)
</script>

<template>
  <div class="test-report">
    <div class="sum">
      <strong v-if="run.failed" class="state bad">{{ run.failed }} failed</strong>
      <strong v-else-if="run.status === 'skipped'" class="state neutral">Skipped</strong>
      <strong v-else class="state ok">All {{ run.passed }} checks passed</strong>
      <span class="muted">{{ run.passed }} passed, {{ run.failed }} failed<template v-if="run.skipped">, {{ run.skipped }} skipped</template>, {{ shots === 1 ? '1 screenshot' : `${shots} screenshots` }}<template v-if="duration">, {{ duration }}</template><template v-if="run.project"> · {{ run.project }}</template></span>
    </div>
    <p class="hint lead">
      Earlier Test Run upload. Reports shows it directly, so no publisher code runs.
    </p>
    <!-- eslint-disable-next-line vue/no-v-html -- server-rendered from escaped markdown -->
    <div v-if="run.summary_html" class="prose-report summary" v-html="run.summary_html" />
    <section v-for="test in run.tests" :key="test.id" class="test">
      <div class="test-head">
        <span class="mark" :class="test.status" :title="test.status"><AppIcon v-if="test.status !== 'skipped'" :name="test.status === 'passed' ? 'check' : 'x'" small /><template v-else>–</template></span>
        <div class="test-text">
          <h2>{{ test.title }}</h2>
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div v-if="test.description_html" class="prose-report muted" v-html="test.description_html" />
        </div>
      </div>
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div v-if="test.error_html" class="error prose-report" v-html="test.error_html" />
      <ol v-if="test.steps.length" class="steps">
        <li v-for="(step, si) in test.steps" :key="si">
          <div class="step-head">
            <span class="num">{{ String(si + 1).padStart(2, '0') }}</span>
            <h3>{{ step.title }}</h3>
            <span v-if="step.status === 'failed'" class="state bad">Failed</span>
          </div>
          <!-- eslint-disable-next-line vue/no-v-html -->
          <p v-if="step.caption_html" class="prose-report caption" v-html="step.caption_html" />
          <figure v-if="step.shot" class="shot">
            <div class="shot-bar">
              <span class="shot-dot" /><span class="shot-dot" /><span class="shot-dot" />
              <span class="shot-label">{{ step.title }}</span>
            </div>
            <img :src="step.shot" :alt="step.title" loading="lazy">
          </figure>
        </li>
      </ol>
    </section>
  </div>
</template>

<style scoped>
.test-report { padding: 28px clamp(18px, 4vw, 48px) 48px; max-width: 960px; color: var(--ink); }
.sum { display: flex; gap: 6px 18px; flex-wrap: wrap; align-items: baseline; margin-bottom: 6px; }
.sum strong { font-size: 22px; }
.lead { margin: 0 0 18px; }
.summary { margin-bottom: 24px; color: var(--ink-2); }
.test { margin-top: 32px; }
.test-head { display: flex; gap: 12px; align-items: flex-start; }
.test-text { min-width: 0; }
.mark { margin-top: 3px; width: 24px; height: 24px; flex: none; border-radius: 50%; display: inline-grid; place-items: center; font-size: 14px; }
.mark.passed { color: var(--ok); background: color-mix(in srgb, var(--ok) 14%, transparent); }
.mark.failed { color: var(--bad); background: color-mix(in srgb, var(--bad) 14%, transparent); }
.mark.skipped { color: var(--muted); background: var(--paper-2); }
h2 { font-size: 19px; font-weight: 650; margin: 0; overflow-wrap: anywhere; }
h3 { font-size: 15px; font-weight: 600; margin: 0; }
.error { margin-top: 14px; border: 1px solid var(--bad); border-radius: var(--radius-m); padding: 10px 14px; font-size: 14px; color: var(--bad); }
.steps { margin: 18px 0 0; padding: 0; list-style: none; display: grid; gap: 24px; }
.step-head { display: flex; align-items: baseline; gap: 8px; }
.num { font: 12px var(--mono); color: var(--muted); }
.caption { margin: 4px 0 0 28px; font-size: 14px; color: var(--muted); }
.shot { margin: 12px 0 0 28px; }
@media (max-width: 760px) { .caption, .shot { margin-left: 0; } }
.shot {
  width: fit-content;
  max-width: 100%;
  /* Width and color stay separate so the frame keeps its border box even without the tokens. */
  border: 1px solid;
  border-color: var(--rule-strong);
  border-radius: 12px;
  overflow: hidden;
  background: var(--paper-2);
  box-shadow: 0 8px 24px rgba(15, 20, 25, 0.10);
}
.shot-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--rule);
  background: var(--mat);
}
.shot-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--rule-strong);
}
.shot-label {
  margin-left: 8px;
  font-size: 0.75rem;
  color: var(--muted);
}
.shot img {
  display: block;
  max-width: 100%;
  height: auto;
}

.prose-report :deep(p) {
  margin: 0.4rem 0;
}
.prose-report :deep(strong) {
  color: var(--ink);
}
.prose-report :deep(a) {
  color: var(--accent);
}
.prose-report :deep(code) {
  background: var(--paper-2);
  border: 1px solid var(--rule);
  border-radius: 4px;
  padding: 0.1em 0.4em;
  font: 0.875em var(--mono);
  color: var(--ink-2);
}
.prose-report :deep(ul),
.prose-report :deep(ol) {
  padding-left: 1.25rem;
  margin: 0.4rem 0;
}
.prose-report :deep(pre) {
  background: var(--paper-2);
  border: 1px solid var(--rule);
  border-radius: 8px;
  padding: 0.75rem 1rem;
  overflow-x: auto;
  margin: 0.6rem 0;
}
.prose-report :deep(pre code) {
  border: none;
  background: transparent;
  padding: 0;
}
</style>
