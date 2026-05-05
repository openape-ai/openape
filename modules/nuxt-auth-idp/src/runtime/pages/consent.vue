<script setup>
import { onMounted, ref } from 'vue'
import { navigateTo, useIdpAuth } from '#imports'

// DDISA core.md §2.3 `allowlist-user` consent screen. Rendered when
// the user's DDISA TXT record sets `mode=allowlist-user` and they
// haven't yet consented to the requesting SP. See issue #301.
//
// Two visual variants:
//   - SP published metadata at /.well-known/oauth-client-metadata
//     → "verified" tone, name + logo + links from the metadata
//   - SP did NOT publish metadata
//     → "unverified" tone with explicit warning. Primary action is
//       still labelled but visually de-emphasised vs. cancel.

definePageMeta({ layout: false })

const { user, fetchUser } = useIdpAuth()
const data = ref(null)
const error = ref('')
const submitting = ref(false)

onMounted(async () => {
  await fetchUser()
  if (!user.value) {
    // Shouldn't happen — /authorize redirects to /login first — but
    // be defensive: drop them at /login if their session vanished.
    await navigateTo('/login')
    return
  }
  try {
    data.value = await $fetch('/api/authorize/consent')
  }
  catch (err) {
    error.value = err?.data?.title || err?.message || 'Failed to load consent details.'
  }
})

async function submit(action) {
  if (!data.value || submitting.value) return
  submitting.value = true
  error.value = ''
  try {
    const res = await $fetch.raw('/api/authorize/consent', {
      method: 'POST',
      body: { csrfToken: data.value.csrfToken, action },
      redirect: 'manual',
    })
    // The handler responds with 302 — fetch.raw exposes the Location
    // header so we can do the navigation client-side. (Browser-fetch
    // would follow it transparently but blocks cross-origin reads of
    // the resulting body, which is fine — we navigate anyway.)
    const target = res.headers.get('location')
    if (target) {
      window.location.assign(target)
    }
    else {
      error.value = 'Server did not return a redirect target.'
      submitting.value = false
    }
  }
  catch (err) {
    error.value = err?.data?.title || err?.message || 'Consent submission failed.'
    submitting.value = false
  }
}
</script>

<template>
  <div class="consent-root">
    <div v-if="error && !data" class="card error-card">
      <h1>Konnte Consent-Anfrage nicht laden</h1>
      <p class="muted">
        {{ error }}
      </p>
      <a href="/" class="btn btn-secondary">Zur Startseite</a>
    </div>

    <div v-else-if="data" class="card" :class="data.verified ? 'verified' : 'unverified'">
      <header>
        <span class="badge" :class="data.verified ? 'badge-verified' : 'badge-warn'">
          {{ data.verified ? 'Verifizierter Dienst' : 'Unverifizierter Dienst' }}
        </span>
      </header>

      <template v-if="data.verified">
        <div class="sp-row">
          <div>
            <h1>{{ data.metadata?.client_name || data.clientId }}</h1>
            <p class="muted">
              {{ data.clientId }}
            </p>
          </div>
        </div>
        <p>Diese Anwendung möchte deine OpenApe-Identität nutzen.</p>
        <p class="muted small">
          Nach der Anmeldung wirst du zu <code>{{ data.redirectUri }}</code> weitergeleitet.
        </p>
        <p v-if="data.metadata?.policy_uri || data.metadata?.tos_uri" class="muted small">
          <a v-if="data.metadata.policy_uri" :href="data.metadata.policy_uri" target="_blank" rel="noopener">Datenschutz</a>
          <span v-if="data.metadata.policy_uri && data.metadata.tos_uri"> · </span>
          <a v-if="data.metadata.tos_uri" :href="data.metadata.tos_uri" target="_blank" rel="noopener">AGB</a>
        </p>
      </template>

      <template v-else>
        <h1>Anmeldung an einen unverifizierten Dienst</h1>
        <p>
          Diese Anwendung hat keine Authentifizierungs-Metadaten unter
          <code>/.well-known/oauth-client-metadata</code> veröffentlicht.
          Wir können nicht bestätigen, wer sie betreibt.
        </p>
        <dl class="kv">
          <dt>Domain</dt>
          <dd><code>{{ data.clientId }}</code></dd>
          <dt>Weiterleitung</dt>
          <dd><code>{{ data.redirectUri }}</code></dd>
        </dl>
        <p>
          Wenn du diesen Dienst nicht erkennst oder ihm nicht vertraust,
          brich hier ab. Nach dem Anmelden bekommt diese Anwendung
          deine Identität.
        </p>
      </template>

      <p v-if="error" class="error">
        {{ error }}
      </p>

      <div class="actions">
        <button
          v-if="data.verified"
          class="btn btn-primary"
          :disabled="submitting"
          @click="submit('approve')"
        >
          Anmelden
        </button>
        <button
          v-else
          class="btn btn-warning"
          :disabled="submitting"
          @click="submit('approve')"
        >
          Trotzdem anmelden
        </button>
        <button
          class="btn btn-secondary"
          :disabled="submitting"
          @click="submit('cancel')"
        >
          Abbrechen
        </button>
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
.consent-root {
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
  border: 1px solid #2a2a35;
  border-radius: 12px;
  padding: 1.75rem;
}
.card.unverified {
  border-color: #c97a18;
  background: linear-gradient(180deg, rgba(201,122,24,0.08), #15151b);
}
.card.verified {
  border-color: #2a2a35;
}
.error-card { border-color: #c83030; }
.badge {
  display: inline-block;
  padding: 0.25rem 0.625rem;
  border-radius: 999px;
  font-size: 0.75rem;
  letter-spacing: 0.02em;
  margin-bottom: 1rem;
}
.badge-verified {
  background: rgba(60,180,60,0.15);
  color: #6ec96e;
  border: 1px solid rgba(60,180,60,0.3);
}
.badge-warn {
  background: rgba(201,122,24,0.18);
  color: #f0a83d;
  border: 1px solid rgba(201,122,24,0.4);
}
.sp-row { display: flex; gap: 0.875rem; align-items: center; margin-bottom: 0.5rem; }
.logo { width: 48px; height: 48px; border-radius: 8px; background: #fff; object-fit: contain; padding: 4px; }
h1 { font-size: 1.25rem; margin: 0 0 0.25rem; }
p { line-height: 1.5; margin: 0.5rem 0; }
.muted { color: #9b9ba8; }
.small { font-size: 0.875rem; }
.kv { display: grid; grid-template-columns: max-content 1fr; gap: 0.25rem 1rem; margin: 0.875rem 0; }
.kv dt { color: #9b9ba8; font-size: 0.875rem; }
.kv dd { margin: 0; }
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
}
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-primary { background: #4a86ff; color: white; }
.btn-warning { background: #c97a18; color: white; }
.btn-secondary { background: transparent; color: #c0c0cc; border: 1px solid #3a3a48; }
.btn-secondary:hover:not(:disabled) { background: #25252e; }
</style>
