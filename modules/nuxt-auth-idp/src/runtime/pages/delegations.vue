<script setup>
import { onMounted, ref } from 'vue'
import { navigateTo, useHead, useIdpAuth } from '#imports'

// /delegations — owner-facing management of standing cross-SP delegations
// ("apps acting on your behalf"). Each is a delegation grant where a Receiver
// SP (e.g. org.openape.ai) may act for you at a Provider (e.g. troop.openape.ai)
// — created when you approve the cross-SP consent. Lists the active ones and
// lets you revoke. Same-origin (session cookie) — no CORS.

useHead({ title: 'Delegations — OpenApe' })

const { user, loading: authLoading, fetchUser } = useIdpAuth()

const loading = ref(true)
const error = ref('')
const delegations = ref([])

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await $fetch('/api/grants?section=active')
    const all = Array.isArray(res?.data) ? res.data : []
    delegations.value = all.filter(g => g.type === 'delegation' && g.request?.delegate)
  }
  catch (e) {
    error.value = e?.data?.statusMessage ?? e?.message ?? 'Failed to load delegations'
  }
  finally {
    loading.value = false
  }
}

onMounted(async () => {
  await fetchUser()
  if (!user.value) {
    await navigateTo('/login')
    return
  }
  await load()
})

function scopesOf(g) {
  const s = g.request?.scopes
  return Array.isArray(s) && s.length ? s : null
}
function fmtDate(ts) {
  if (!ts) return ''
  try {
    return new Date(ts * 1000).toLocaleString()
  }
  catch {
    return ''
  }
}

const revokeId = ref(null)
const revoking = ref(false)
async function confirmRevoke() {
  const id = revokeId.value
  if (!id) return
  revoking.value = true
  error.value = ''
  try {
    await $fetch(`/api/grants/${id}/revoke`, { method: 'POST' })
    revokeId.value = null
    await load()
  }
  catch (e) {
    error.value = e?.data?.statusMessage ?? 'Failed to revoke'
  }
  finally {
    revoking.value = false
  }
}
</script>

<template>
  <div class="min-h-dvh bg-zinc-950 text-zinc-100">
    <header class="border-b border-default px-4 sm:px-6 py-3 flex items-center gap-3 sticky top-0 bg-zinc-950/95 backdrop-blur z-10">
      <h1 class="font-semibold flex-1">
        Apps acting on your behalf
      </h1>
      <UButton color="primary" variant="soft" size="sm" icon="i-lucide-refresh-cw" :loading="loading" @click="load">
        Refresh
      </UButton>
      <UButton to="/account" color="neutral" variant="soft" size="sm">
        Account
      </UButton>
    </header>

    <main class="px-4 sm:px-6 py-6 max-w-2xl mx-auto space-y-4">
      <p class="text-sm text-muted">
        These services may act on your behalf at another service — e.g. spawn agents on your troop.
        Each is a standing delegation you approved. Revoke any you no longer want; the next time that
        service tries to use it, it's refused.
      </p>

      <div v-if="loading || authLoading" class="text-sm text-muted">
        Loading…
      </div>
      <UAlert v-else-if="error" color="error" :title="error" />
      <UCard v-else-if="!delegations.length">
        <p class="text-sm text-muted">
          No active delegations. When you let an app act for you at another service, it shows up here.
        </p>
      </UCard>

      <ul v-else class="space-y-3">
        <li v-for="g in delegations" :key="g.id">
          <UCard>
            <div class="space-y-2">
              <p class="text-sm">
                <span class="font-mono text-emerald-400">{{ g.request.delegate }}</span>
                may act for you at
                <span class="font-mono text-emerald-400">{{ g.request.audience }}</span>
              </p>

              <div class="text-xs text-muted space-y-1">
                <div>
                  Permissions:
                  <template v-if="scopesOf(g)">
                    <span v-for="s in scopesOf(g)" :key="s" class="font-mono text-zinc-300 mr-2">{{ s }}</span>
                  </template>
                  <span v-else class="text-amber-400">full access</span>
                </div>
                <div>Approval: {{ g.request.grant_type }} · granted {{ fmtDate(g.created_at) }}</div>
              </div>

              <div v-if="revokeId !== g.id" class="pt-1">
                <UButton color="error" variant="soft" size="sm" icon="i-lucide-shield-off" @click="revokeId = g.id">
                  Revoke
                </UButton>
              </div>
              <div v-else class="pt-1 space-y-2">
                <p class="text-xs text-amber-400">
                  Revoke this delegation? Anything that service has in flight (e.g. a spawn) will fail.
                </p>
                <div class="flex gap-2">
                  <UButton color="error" size="sm" :loading="revoking" @click="confirmRevoke">
                    Confirm revoke
                  </UButton>
                  <UButton variant="ghost" size="sm" :disabled="revoking" @click="revokeId = null">
                    Cancel
                  </UButton>
                </div>
              </div>
            </div>
          </UCard>
        </li>
      </ul>
    </main>
  </div>
</template>
