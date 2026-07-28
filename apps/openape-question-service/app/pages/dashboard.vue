<script setup lang="ts">
// Main authenticated page: ask a question, poll for the answer the bound
// service-agent produces. The POST enqueues; a ~2s poll reads the task state.
import { computed, ref } from 'vue'
import { useOpenApeAuth } from '#imports'

const { user, fetchUser } = useOpenApeAuth()

onMounted(async () => {
  await fetchUser()
  if (!user.value)
    await navigateTo('/')
})

const question = ref('')
const asking = ref(false)
const answer = ref('')
const failed = ref('')
const waited = ref(0)
let poll: ReturnType<typeof setInterval> | null = null
let tick: ReturnType<typeof setInterval> | null = null

// If nothing came back after ~90s, the service-agent probably isn't polling.
const offlineHint = computed(() => asking.value && !answer.value && waited.value > 90)

function stop() {
  if (poll) { clearInterval(poll); poll = null }
  if (tick) { clearInterval(tick); tick = null }
}

async function ask() {
  const q = question.value.trim()
  if (!q || asking.value)
    return
  asking.value = true
  answer.value = ''
  failed.value = ''
  waited.value = 0
  try {
    const { taskId } = await $fetch<{ taskId: string }>('/api/question', { method: 'POST', body: { question: q } })
    tick = setInterval(() => { waited.value += 1 }, 1000)
    poll = setInterval(async () => {
      try {
        const res = await $fetch<{ state: string, answer?: string, error?: string }>(`/api/answer/${taskId}`)
        if (res.state === 'completed') { answer.value = res.answer ?? ''; stop(); asking.value = false }
        else if (res.state === 'failed') { failed.value = res.error ?? 'Agent-Fehler'; stop(); asking.value = false }
      }
      catch { /* transient poll error → keep waiting, next poll corrects */ }
    }, 2000)
  }
  catch (err: unknown) {
    failed.value = (err as { statusMessage?: string, message?: string }).statusMessage
      ?? (err as { message?: string }).message ?? 'Anfrage fehlgeschlagen'
    asking.value = false
  }
}

onBeforeUnmount(stop)
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <div class="max-w-2xl mx-auto px-4 py-10 space-y-6">
      <div>
        <h1 class="text-2xl font-bold">
          Question Service
        </h1>
        <p v-if="user" class="text-sm text-zinc-400">
          Signed in as {{ user.sub }}
        </p>
      </div>

      <UCard>
        <UFormField label="Deine Frage">
          <UTextarea
            v-model="question"
            :rows="4"
            autoresize
            placeholder="Frag irgendwas…"
            class="w-full"
            :disabled="asking"
          />
        </UFormField>
        <div class="mt-3">
          <UButton
            color="primary"
            :loading="asking"
            :disabled="!question.trim() || asking"
            @click="ask"
          >
            Antwort generieren
          </UButton>
        </div>
      </UCard>

      <UCard v-if="asking || answer || failed">
        <div v-if="asking" class="flex items-center gap-2 text-sm text-primary-400">
          <UIcon name="i-lucide-loader-circle" class="animate-spin" />
          <span>Warte auf Service-Agent… ({{ waited }}s)</span>
        </div>
        <p v-if="offlineHint" class="mt-2 text-sm text-amber-400">
          Noch keine Antwort — läuft der Service-Agent (<code>/loop /service-agent …</code>)?
        </p>
        <p v-if="failed" class="text-sm text-red-400">
          {{ failed }}
        </p>
        <div v-if="answer" class="whitespace-pre-wrap leading-relaxed">
          {{ answer }}
        </div>
      </UCard>
    </div>
  </div>
</template>
