<script setup lang="ts">
import type { BrokerConnection } from '@openape/core'
import { onMounted, ref } from 'vue'

useSeoMeta({ title: 'Agent providers' })
const connections = ref<BrokerConnection[]>([])
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const issuer = ref('https://pods.openape.ai')
const domain = ref('pods.openape.ai')
const revoking = ref('')
async function load() {
  connections.value = await $fetch<BrokerConnection[]>('/api/broker-connections')
}
onMounted(async () => {
  try { await load() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'Could not load agent providers' }
  finally { loading.value = false }
})
async function change(action: 'connect' | 'revoke', id?: string) {
  busy.value = true
  error.value = ''
  try {
    if (action === 'connect') await $fetch('/api/broker-connections', { method: 'POST', body: { broker_issuer: issuer.value, agent_domain: domain.value } })
    else await $fetch(`/api/broker-connections/${encodeURIComponent(id!)}`, { method: 'DELETE' })
    revoking.value = ''
    await load()
  }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'Could not update agent provider' }
  finally { busy.value = false }
}
</script>

<template>
  <IdpPage title="Agent providers" subtitle="Keep your decisions here while agents use their own identity provider." back-to="/account" back-label="Account & security">
    <div class="space-y-6">
      <p>Connected providers may submit permission requests from their agents to your account. Only you can approve actions. Each request appears in your grants.</p>
      <p v-if="error" role="alert" class="text-error">
        {{ error }}
      </p>
      <p v-if="loading" role="status">
        Loading agent providers…
      </p>
      <p v-else-if="!connections.length">
        No agent provider is connected.
      </p>
      <article v-for="connection in connections" :key="connection.id" class="rounded-lg border border-default p-4 space-y-3">
        <h2 class="font-semibold break-all">
          {{ connection.agent_domain }}
        </h2>
        <p>{{ connection.status === 'active' ? 'Allowed to submit requests' : 'Revoked' }}</p>
        <details>
          <summary>Connection details</summary><p class="break-all">
            {{ connection.broker_issuer }}
          </p><p>{{ connection.owner.subject }}</p>
        </details>
        <UButton v-if="connection.status === 'active' && revoking !== connection.id" color="error" variant="soft" :disabled="busy" @click="revoking = connection.id">
          Revoke provider
        </UButton>
        <div v-if="revoking === connection.id" class="space-y-3">
          <p>Revocation blocks new requests and further use of all grants from this connection, including recurring permissions. Agent identities and history remain available.</p>
          <UButton color="error" :disabled="busy" @click="change('revoke', connection.id)">
            Confirm revocation
          </UButton>
          <UButton variant="ghost" :disabled="busy" @click="revoking = ''">
            Cancel
          </UButton>
        </div>
      </article>
      <form class="rounded-lg border border-default p-4 space-y-4" @submit.prevent="change('connect')">
        <h2 class="font-semibold">
          Connect an agent provider
        </h2>
        <p>Allow the exact provider and identity domain below to assign agents to your account and submit requests. This does not approve any action.</p>
        <label class="block">Provider address<input v-model="issuer" type="url" required class="block w-full rounded border border-default bg-default p-2"></label>
        <label class="block">Agent identity domain<input v-model="domain" required class="block w-full rounded border border-default bg-default p-2"></label>
        <UButton type="submit" :disabled="busy || loading">
          Allow requests from this provider
        </UButton>
      </form>
    </div>
  </IdpPage>
</template>
