<script setup lang="ts">
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

interface PublicRun {
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
  tests: PublicTest[]
}

const route = useRoute()
const { data: run, error } = await useFetch<PublicRun>(`/api/public/runs/${route.params.slug}`)

useSeoMeta({
  title: () => run.value ? `${run.value.title} — OpenApe Testrun` : 'OpenApe Testrun',
  description: () => run.value
    ? `${run.value.status.toUpperCase()}: ${run.value.passed} passed, ${run.value.failed} failed`
    : 'Test run report',
  robots: 'noindex',
})

const STATUS_COLOR = { passed: 'success', failed: 'error', skipped: 'neutral' } as const
const STATUS_ICON = { passed: 'i-lucide-check', failed: 'i-lucide-x', skipped: 'i-lucide-minus' } as const

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

function fmtDuration(start: number | null, finish: number | null): string | null {
  if (!start || !finish || finish < start) return null
  const seconds = finish - start
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <div v-if="error" class="min-h-dvh flex flex-col items-center justify-center px-4 text-center">
      <div class="text-5xl mb-4" aria-hidden="true">
        🔍
      </div>
      <h1 class="text-2xl font-bold">
        Report not found
      </h1>
      <p class="mt-2 text-zinc-400">
        This test run does not exist or has been deleted.
      </p>
    </div>

    <template v-else-if="run">
      <header class="border-b border-zinc-800/80 bg-zinc-900/40">
        <div class="max-w-3xl mx-auto px-4 py-8">
          <p class="text-xs uppercase tracking-widest text-zinc-500 mb-3">
            Test run report<span v-if="run.project"> · {{ run.project }}</span>
          </p>
          <div class="flex flex-wrap items-center gap-4">
            <h1 class="text-3xl sm:text-4xl font-bold tracking-tight">
              {{ run.title }}
            </h1>
            <UBadge :color="STATUS_COLOR[run.status]" variant="solid" size="lg" class="uppercase font-bold">
              <UIcon :name="STATUS_ICON[run.status]" class="mr-1" />
              {{ run.status }}
            </UBadge>
          </div>
          <div class="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm text-zinc-400">
            <span class="text-emerald-400">{{ run.passed }} passed</span>
            <span :class="run.failed ? 'text-red-400' : ''">{{ run.failed }} failed</span>
            <span v-if="run.skipped">{{ run.skipped }} skipped</span>
            <span v-if="fmtDuration(run.started_at, run.finished_at)">⏱ {{ fmtDuration(run.started_at, run.finished_at) }}</span>
            <span>{{ fmtDate(run.created_at) }}</span>
            <span>by {{ run.created_by }}<template v-if="run.created_by_act === 'agent'"> 🤖</template></span>
          </div>
          <!-- eslint-disable-next-line vue/no-v-html — server-rendered from escaped markdown -->
          <div v-if="run.summary_html" class="prose-report mt-5 text-zinc-300" v-html="run.summary_html" />
        </div>
      </header>

      <main class="max-w-3xl mx-auto px-4 py-8 space-y-10">
        <section v-for="test in run.tests" :key="test.id">
          <div class="flex items-start gap-3">
            <span
              class="mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm"
              :class="{
                'bg-emerald-500/15 text-emerald-400': test.status === 'passed',
                'bg-red-500/15 text-red-400': test.status === 'failed',
                'bg-zinc-500/15 text-zinc-400': test.status === 'skipped',
              }"
            >
              <UIcon :name="STATUS_ICON[test.status]" />
            </span>
            <div class="min-w-0">
              <h2 class="text-xl font-semibold">
                {{ test.title }}
              </h2>
              <!-- eslint-disable-next-line vue/no-v-html -->
              <div v-if="test.description_html" class="prose-report mt-1 text-zinc-400 text-sm" v-html="test.description_html" />
            </div>
          </div>

          <div
            v-if="test.error_html"
            class="mt-4 rounded-lg border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-200 prose-report"
            v-html="test.error_html"
          />

          <ol v-if="test.steps.length" class="mt-5 space-y-6">
            <li v-for="(step, si) in test.steps" :key="si">
              <div class="flex items-baseline gap-2">
                <span class="text-xs font-mono text-zinc-600">{{ String(si + 1).padStart(2, '0') }}</span>
                <h3 class="font-medium">
                  {{ step.title }}
                </h3>
                <UIcon
                  v-if="step.status === 'failed'"
                  name="i-lucide-x"
                  class="text-red-400 translate-y-0.5"
                />
              </div>
              <!-- eslint-disable-next-line vue/no-v-html -->
              <p v-if="step.caption_html" class="prose-report mt-1 text-sm text-zinc-400 ml-7" v-html="step.caption_html" />
              <figure v-if="step.shot" class="shot mt-3 ml-7">
                <div class="shot-bar">
                  <span class="shot-dot" /><span class="shot-dot" /><span class="shot-dot" />
                  <span class="shot-label">{{ step.title }}</span>
                </div>
                <img :src="step.shot" :alt="step.title" loading="lazy">
              </figure>
            </li>
          </ol>
        </section>
      </main>

      <footer class="py-8 text-center text-xs text-zinc-600 border-t border-zinc-900">
        Shared via
        <a href="https://testrun.openape.ai" class="text-zinc-400 hover:text-primary-500 transition-colors">testrun.openape.ai</a>
        — powered by
        <a href="https://openape.ai" target="_blank" rel="noopener" class="text-zinc-400 hover:text-primary-500 transition-colors">OpenApe</a>
      </footer>
    </template>
  </div>
</template>

<style scoped>
.shot {
  width: fit-content;
  max-width: 100%;
  border: 1px solid #27272a;
  border-radius: 12px;
  overflow: hidden;
  background: #18181b;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.45);
}
.shot-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid #27272a;
  background: #111113;
}
.shot-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #3f3f46;
}
.shot-label {
  margin-left: 8px;
  font-size: 0.75rem;
  color: #71717a;
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
  color: #e4e4e7;
}
.prose-report :deep(a) {
  color: var(--ui-primary, #34d399);
}
.prose-report :deep(code) {
  background: #18181b;
  border: 1px solid #27272a;
  border-radius: 4px;
  padding: 0.1em 0.4em;
  font-size: 0.875em;
  color: #d4d4d8;
}
.prose-report :deep(ul),
.prose-report :deep(ol) {
  padding-left: 1.25rem;
  margin: 0.4rem 0;
}
.prose-report :deep(pre) {
  background: #18181b;
  border: 1px solid #27272a;
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
