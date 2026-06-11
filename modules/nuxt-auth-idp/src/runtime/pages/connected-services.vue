<script setup>
import { onMounted, ref } from 'vue'
import { navigateTo, useHead } from '#imports'
import { useIdpAuth } from '../composables/useIdpAuth'

// /connected-services — apps you approved at sign-in (DDISA allowlist-user
// consents). Revoke = next sign-in to that service shows the consent again.
// Split out of the old /account page.

useHead({ title: 'Connected Services — OpenApe' })

const { user, loading: authLoading, fetchUser } = useIdpAuth()
const consents = ref([])
const consentsLoading = ref(false)
const error = ref('')
const success = ref('')

onMounted(async () => {
  await fetchUser()
  if (!user.value) {
    await navigateTo('/login')
    return
  }
  await loadConsents()
})
async function loadConsents() {
  consentsLoading.value = true
  try {
    consents.value = await $fetch('/api/account/consents')
  }
  catch {
    consents.value = []
  }
  finally {
    consentsLoading.value = false
  }
}
async function handleRevokeConsent(clientId, clientName) {
  const label = clientName || clientId
  if (!confirm(`Zugriff für ${label} entfernen? Du wirst beim nächsten Login wieder gefragt.`))
    return
  error.value = ''
  try {
    await $fetch(`/api/account/consents/${encodeURIComponent(clientId)}`, { method: 'DELETE' })
    success.value = `Zugriff für ${label} widerrufen`
    await loadConsents()
  }
  catch (err) {
    error.value = err?.data?.title ?? 'Failed to revoke access'
  }
}
function formatDate(ts) {
  return new Date(ts).toLocaleDateString()
}
</script>

<template>
  <div class="min-h-screen py-8 px-4">
    <div class="max-w-2xl mx-auto">
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-2xl font-bold">
            Connected Services
          </h1>
          <p v-if="user" class="text-sm text-muted">
            {{ user.email }}
          </p>
        </div>
        <UButton to="/account" color="neutral" variant="soft" size="sm">
          Back
        </UButton>
      </div>

      <div v-if="authLoading" class="text-center text-muted mt-10">
        Loading...
      </div>

      <template v-else>
        <UAlert v-if="error" color="error" :title="error" class="mb-4" />
        <UAlert v-if="success" color="success" :title="success" class="mb-4" />

        <UCard :ui="{ body: 'p-0' }">
          <template #header>
            <h2 class="text-lg font-semibold">
              Connected Services
            </h2>
            <p class="text-sm text-muted mt-1">
              Anwendungen, die du bei der Anmeldung an id.openape.ai genehmigt hast.
              Widerrufen heißt: nächste Anmeldung an diesem Dienst zeigt wieder den Consent-Screen.
            </p>
          </template>

          <div v-if="consentsLoading" class="p-6 text-center text-muted">
            Loading...
          </div>
          <div v-else-if="consents.length === 0" class="p-6 text-center text-muted">
            Keine Dienste genehmigt. (Setze <code>mode=allowlist-user</code> in deiner DDISA-DNS, um Consent-Screens zu aktivieren.)
          </div>
          <table v-else class="w-full">
            <thead class="border-b border-(--ui-border)">
              <tr>
                <th class="text-left px-4 py-3 text-xs font-medium text-muted uppercase">
                  Service
                </th>
                <th class="text-left px-4 py-3 text-xs font-medium text-muted uppercase">
                  Genehmigt
                </th>
                <th class="text-right px-4 py-3 text-xs font-medium text-muted uppercase">
                  Aktion
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-(--ui-border)">
              <tr v-for="c in consents" :key="c.clientId" class="odd:bg-(--ui-bg-elevated)/40 even:bg-(--ui-bg) hover:bg-(--ui-bg-elevated)">
                <td class="px-4 py-3 text-sm">
                  <div class="flex items-center gap-2">
                    <div class="min-w-0">
                      <div class="font-medium truncate flex items-center gap-1.5">
                        <a v-if="c.clientUri" :href="c.clientUri" target="_blank" rel="noopener" class="hover:underline">{{ c.clientName || c.clientId }}</a>
                        <span v-else>{{ c.clientName || c.clientId }}</span>
                        <UBadge v-if="!c.verified" color="warning" variant="subtle" size="xs">
                          unverifiziert
                        </UBadge>
                      </div>
                      <div v-if="c.clientName" class="text-xs text-muted truncate">
                        {{ c.clientId }}
                      </div>
                    </div>
                  </div>
                </td>
                <td class="px-4 py-3 text-xs text-muted whitespace-nowrap">
                  {{ formatDate(c.grantedAt * 1000) }}
                </td>
                <td class="px-4 py-3 text-right">
                  <UButton variant="ghost" size="xs" color="error" @click="handleRevokeConsent(c.clientId, c.clientName)">
                    Widerrufen
                  </UButton>
                </td>
              </tr>
            </tbody>
          </table>
        </UCard>
      </template>
    </div>
  </div>
</template>
