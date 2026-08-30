<script setup lang="ts">
import { apiFetch } from '../utils/api'

definePageMeta({ layout: false })

const form = ref({ name: '', firma: '', email: '', nachricht: '' })
const done = ref(false)
const error = ref('')

async function submit() {
  error.value = ''
  try {
    await apiFetch('/api/anfrage', { method: 'POST', body: form.value })
    done.value = true
  }
  catch (err: unknown) {
    const e = err as { data?: { title?: string }, message?: string }
    error.value = e.data?.title ?? e.message ?? 'Anfrage konnte nicht gesendet werden'
  }
}
</script>

<template>
  <div class="flex min-h-dvh items-center justify-center bg-[var(--crm-bg)] px-4 text-[var(--crm-ink)]">
    <div class="w-full max-w-md rounded-[12px] border border-[var(--crm-line)] bg-[var(--crm-panel)] p-6">
      <h1 class="text-xl font-semibold">
        Anfrage
      </h1>
      <p v-if="done" class="mt-4 text-sm text-[var(--crm-ink-2)]">
        Danke. Wir haben deine Nachricht erhalten.
      </p>
      <form v-else class="mt-4 space-y-3" @submit.prevent="submit">
        <UFormField label="Name" required>
          <UInput v-model="form.name" class="w-full" />
        </UFormField>
        <UFormField label="Firma">
          <UInput v-model="form.firma" class="w-full" />
        </UFormField>
        <UFormField label="E-Mail" required>
          <UInput v-model="form.email" type="email" class="w-full" />
        </UFormField>
        <UFormField label="Nachricht" required>
          <UTextarea v-model="form.nachricht" :rows="5" class="w-full" />
        </UFormField>
        <p v-if="error" class="text-sm text-[var(--crm-rose)]">
          {{ error }}
        </p>
        <UButton type="submit" block :disabled="!form.name.trim() || !form.email.trim() || !form.nachricht.trim()">
          Senden
        </UButton>
      </form>
    </div>
  </div>
</template>
