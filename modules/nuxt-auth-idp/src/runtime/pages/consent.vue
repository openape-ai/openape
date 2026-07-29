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
    // The server returns `{ location }` in a JSON body rather than
    // a 302 redirect. With `fetch({ redirect: 'manual' })` browsers
    // turn 3xx responses into opaque-redirect types whose Location
    // header is unreadable — that's the Fetch spec, not a server
    // quirk. JSON sidesteps it; we do the top-level navigation
    // ourselves, which is what we want anyway (the next hop is the
    // SP's redirect_uri, cross-origin).
    const { location } = await $fetch('/api/authorize/consent', {
      method: 'POST',
      body: { csrfToken: data.value.csrfToken, action },
    })
    if (typeof location === 'string' && location) {
      window.location.assign(location)
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
  <IdpHero>
    <div v-if="error && !data" class="rounded-lg border border-error/40 bg-default p-6">
      <h1 class="text-xl font-semibold tracking-tight">
        Konnte Consent-Anfrage nicht laden
      </h1>
      <p class="mt-2 text-sm text-muted">
        {{ error }}
      </p>
      <UButton to="/" color="neutral" variant="outline" class="mt-4">
        Zur Startseite
      </UButton>
    </div>

    <div v-else-if="data" class="rounded-lg border border-default bg-default p-6">
      <UBadge
        :color="data.verified ? 'success' : 'warning'"
        variant="subtle"
        size="sm"
      >
        {{ data.verified ? 'Verifizierter Dienst' : 'Unverifizierter Dienst' }}
      </UBadge>

      <template v-if="data.verified">
        <h1 class="mt-4 text-xl font-semibold tracking-tight">
          {{ data.metadata?.client_name || data.clientId }}
        </h1>
        <p class="font-mono text-sm text-muted">
          {{ data.clientId }}
        </p>
        <p class="mt-4 text-sm">
          Diese Anwendung möchte deine OpenApe-Identität nutzen.
        </p>
        <p class="mt-2 text-sm text-muted">
          Nach der Anmeldung wirst du zu
          <code class="break-all font-mono text-xs text-default">{{ data.redirectUri }}</code>
          weitergeleitet.
        </p>
        <p v-if="data.metadata?.policy_uri || data.metadata?.tos_uri" class="mt-2 text-sm text-muted">
          <a v-if="data.metadata.policy_uri" :href="data.metadata.policy_uri" target="_blank" rel="noopener" class="text-primary hover:underline">Datenschutz</a>
          <span v-if="data.metadata.policy_uri && data.metadata.tos_uri"> · </span>
          <a v-if="data.metadata.tos_uri" :href="data.metadata.tos_uri" target="_blank" rel="noopener" class="text-primary hover:underline">AGB</a>
        </p>
      </template>

      <template v-else>
        <h1 class="mt-4 text-xl font-semibold tracking-tight">
          Anmeldung an einen unverifizierten Dienst
        </h1>
        <p class="mt-3 text-sm">
          Diese Anwendung hat keine Authentifizierungs-Metadaten unter
          <code class="break-all font-mono text-xs text-default">/.well-known/oauth-client-metadata</code>
          veröffentlicht. Wir können nicht bestätigen, wer sie betreibt.
        </p>
        <dl class="mt-4 space-y-2 rounded-lg border border-default bg-elevated p-4 text-sm">
          <div>
            <dt class="text-xs uppercase tracking-wider text-dimmed">
              Domain
            </dt>
            <dd class="break-all font-mono text-xs">
              {{ data.clientId }}
            </dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wider text-dimmed">
              Weiterleitung
            </dt>
            <dd class="break-all font-mono text-xs">
              {{ data.redirectUri }}
            </dd>
          </div>
        </dl>
        <p class="mt-4 text-sm">
          Wenn du diesen Dienst nicht erkennst oder ihm nicht vertraust,
          brich hier ab. Nach dem Anmelden bekommt diese Anwendung
          deine Identität.
        </p>
      </template>

      <UAlert v-if="error" color="error" variant="subtle" class="mt-4" :description="error" />

      <div class="mt-6 flex flex-col gap-2">
        <UButton
          :color="data.verified ? 'primary' : 'warning'"
          size="lg"
          block
          :loading="submitting"
          :disabled="submitting"
          @click="submit('approve')"
        >
          {{ data.verified ? 'Anmelden' : 'Trotzdem anmelden' }}
        </UButton>
        <UButton
          color="neutral"
          variant="outline"
          size="lg"
          block
          :disabled="submitting"
          @click="submit('cancel')"
        >
          Abbrechen
        </UButton>
      </div>
    </div>

    <div v-else class="rounded-lg border border-default bg-default p-6 text-sm text-muted">
      Loading…
    </div>
  </IdpHero>
</template>
