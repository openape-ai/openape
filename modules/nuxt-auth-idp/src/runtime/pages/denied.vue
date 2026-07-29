<script setup>
import { computed, onMounted, ref } from 'vue'
import { useIdpAuth } from '#imports'

// Friendly deny page for the human authorize flow. The OAuth spec
// (RFC 6749 §4.1.2.1) requires the IdP to eventually redirect back
// to the SP's redirect_uri with `error=access_denied`, but doing
// that silently strands the user with a URL fragment they won't
// read. We instead route them here with the reason in session,
// show context-sensitive copy, and only complete the spec redirect
// on the explicit "back to SP" button click. Bearer flows skip
// this page entirely — they get the spec-direct redirect.

const { user, fetchUser } = useIdpAuth()
const data = ref(null)
const error = ref('')
const submitting = ref(false)

onMounted(async () => {
  await fetchUser()
  try {
    data.value = await $fetch('/api/authorize/denied')
  }
  catch (err) {
    error.value = err?.data?.title || err?.message || 'Konnte Deny-Status nicht laden'
  }
})

const heading = computed(() => {
  if (data.value?.reason === 'mode-deny') return 'Anmeldung über diesen IdP nicht möglich'
  return 'Anmeldung nicht freigegeben'
})

const explanation = computed(() => {
  if (!data.value) return ''
  if (data.value.reason === 'mode-deny') {
    return 'Der Domain-Owner hat diesen IdP für deine Email-Domain explizit gesperrt (mode=deny). Wende dich an deinen Domain-Admin.'
  }
  // allowlist-admin-not-approved
  return `Der Domain-Admin hat ${data.value.clientId} noch nicht zur Liste der erlaubten Anwendungen hinzugefügt. Bitte den Admin, ${data.value.clientId} freizugeben.`
})

async function backToSp() {
  if (!data.value || submitting.value) return
  submitting.value = true
  error.value = ''
  try {
    const { location } = await $fetch('/api/authorize/denied', { method: 'POST' })
    if (typeof location === 'string' && location) {
      window.location.assign(location)
    }
    else {
      error.value = 'Konnte keinen Redirect-Pfad ermitteln.'
      submitting.value = false
    }
  }
  catch (err) {
    error.value = err?.data?.title || err?.message || 'Redirect fehlgeschlagen'
    submitting.value = false
  }
}
</script>

<template>
  <IdpHero>
    <div v-if="error && !data" class="rounded-lg border border-error/40 bg-default p-6">
      <h1 class="text-xl font-semibold tracking-tight">
        Konnte Anmeldestatus nicht laden
      </h1>
      <p class="mt-2 text-sm text-muted">
        {{ error }}
      </p>
      <UButton to="/" color="neutral" variant="outline" class="mt-4">
        Zur Startseite
      </UButton>
    </div>

    <div v-else-if="data" class="rounded-lg border border-default bg-default p-6">
      <UBadge color="warning" variant="subtle" size="sm">
        Zugriff verweigert
      </UBadge>

      <h1 class="mt-4 text-xl font-semibold tracking-tight">
        {{ heading }}
      </h1>

      <p class="mt-1 text-sm text-muted">
        Anwendung: <code class="break-all font-mono text-xs text-default">{{ data.clientId }}</code>
      </p>

      <p class="mt-4 text-sm">
        {{ explanation }}
      </p>

      <p v-if="user && data.reason === 'allowlist-admin-not-approved'" class="mt-2 text-sm text-muted">
        Wenn du selbst Domain-Admin bist, kannst du
        <NuxtLink to="/admin" class="text-primary hover:underline">
          die Allowlist hier verwalten
        </NuxtLink>.
      </p>

      <UAlert v-if="error" color="error" variant="subtle" class="mt-4" :description="error" />

      <div class="mt-6 flex flex-col gap-2">
        <UButton
          color="primary"
          size="lg"
          block
          :loading="submitting"
          :disabled="submitting"
          @click="backToSp"
        >
          Zurück zu {{ data.clientId }}
        </UButton>
        <UButton to="/" color="neutral" variant="outline" size="lg" block>
          Startseite
        </UButton>
      </div>
    </div>

    <div v-else class="rounded-lg border border-default bg-default p-6 text-sm text-muted">
      Loading…
    </div>
  </IdpHero>
</template>
