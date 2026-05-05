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

definePageMeta({ layout: false })

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
  <div class="denied-root">
    <div v-if="error && !data" class="card error-card">
      <h1>Konnte Anmeldestatus nicht laden</h1>
      <p class="muted">
        {{ error }}
      </p>
      <a href="/" class="btn btn-secondary">Zur Startseite</a>
    </div>

    <div v-else-if="data" class="card">
      <header>
        <span class="badge badge-warn">Zugriff verweigert</span>
      </header>

      <h1>{{ heading }}</h1>

      <div class="sp-row">
        <p class="muted">
          Anwendung: <code>{{ data.clientId }}</code>
        </p>
      </div>

      <p>{{ explanation }}</p>

      <p v-if="user && data.reason === 'allowlist-admin-not-approved'" class="muted small">
        Wenn du selbst Domain-Admin bist, kannst du <a href="/admin">die Allowlist hier verwalten</a>.
      </p>

      <p v-if="error" class="error">
        {{ error }}
      </p>

      <div class="actions">
        <button
          class="btn btn-primary"
          :disabled="submitting"
          @click="backToSp"
        >
          Zurück zu {{ data.clientId }}
        </button>
        <a href="/" class="btn btn-secondary">Startseite</a>
      </div>
    </div>

    <div v-else class="card">
      <p class="muted">
        Lade …
      </p>
    </div>
  </div>
</template>

<style scoped>
.denied-root {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: #0b0b10;
  color: #e4e4ea;
  font-family: system-ui, -apple-system, sans-serif;
}
.card {
  width: 100%;
  max-width: 480px;
  background: #15151b;
  border: 1px solid #c97a18;
  background: linear-gradient(180deg, rgba(201,122,24,0.08), #15151b);
  border-radius: 12px;
  padding: 1.75rem;
}
.error-card { border-color: #c83030; background: #15151b; }
.badge {
  display: inline-block;
  padding: 0.25rem 0.625rem;
  border-radius: 999px;
  font-size: 0.75rem;
  letter-spacing: 0.02em;
  margin-bottom: 1rem;
}
.badge-warn {
  background: rgba(201,122,24,0.18);
  color: #f0a83d;
  border: 1px solid rgba(201,122,24,0.4);
}
.sp-row { display: flex; gap: 0.875rem; align-items: center; margin-bottom: 0.5rem; }
h1 { font-size: 1.25rem; margin: 0 0 0.75rem; }
p { line-height: 1.5; margin: 0.5rem 0; }
.muted { color: #9b9ba8; }
.muted a { color: #c0c0cc; }
.small { font-size: 0.875rem; }
code { background: #25252e; padding: 0.125rem 0.375rem; border-radius: 4px; font-size: 0.875em; }
.error { color: #ff7070; font-size: 0.875rem; margin-top: 0.5rem; }
.actions { display: flex; flex-direction: column-reverse; gap: 0.5rem; margin-top: 1.25rem; }
@media (min-width: 480px) { .actions { flex-direction: row; justify-content: flex-end; } }
.btn {
  appearance: none;
  border: 0;
  border-radius: 8px;
  padding: 0.625rem 1rem;
  font-size: 0.9375rem;
  cursor: pointer;
  font-weight: 500;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-primary { background: #4a86ff; color: white; }
.btn-secondary { background: transparent; color: #c0c0cc; border: 1px solid #3a3a48; }
.btn-secondary:hover:not(:disabled) { background: #25252e; }
</style>
