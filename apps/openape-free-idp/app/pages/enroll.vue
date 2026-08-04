<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useIdpAuth, useRoute, navigateTo } from '#imports'

const { user, loading: authLoading } = useIdpAuth()
const route = useRoute()

const agentId = computed(() => route.query.id as string || '')
const agentName = computed(() => route.query.name as string || '')
const agentKey = computed(() => route.query.key as string || '')
const validParams = computed(() => agentName.value && agentKey.value.startsWith('ssh-ed25519 '))

const enrolling = ref(false)
const declined = ref(false)
const error = ref('')
const agentCount = ref(0)
const checkingAgents = ref(true)

const config = useRuntimeConfig()
const maxAgents = config.public.maxAgentsPerUser
const limitReached = computed(() => agentCount.value >= maxAgents)

watch(user, async (u) => {
  if (u?.email) {
    checkingAgents.value = true
    try {
      const agents = await apiFetch('/api/my-agents') as unknown[]
      agentCount.value = agents.length
    }
    catch {
      agentCount.value = 0
    }
    finally {
      checkingAgents.value = false
    }
  }
}, { immediate: true })

async function handleEnroll() {
  enrolling.value = true
  error.value = ''
  try {
    await $fetch('/api/enroll', {
      method: 'POST',
      body: {
        id: agentId.value || undefined,
        name: agentName.value,
        publicKey: agentKey.value,
      },
    })
    await navigateTo('/agents?enrolled=true')
  }
  catch (err: unknown) {
    const e = err as { data?: { detail?: string, title?: string }, message?: string }
    error.value = e.data?.detail ?? e.data?.title ?? e.message ?? 'Enrollment failed'
  }
  finally {
    enrolling.value = false
  }
}
</script>

<template>
  <IdpHero>
    <h1 class="mb-6 text-center text-4xl font-extrabold sm:text-5xl">
      Agent Enrollment
    </h1>

    <UCard>
      <div v-if="authLoading || checkingAgents" class="text-center text-muted">
        Loading...
      </div>

      <template v-else-if="!user">
        <p class="mb-4 text-center text-muted">
          Du musst angemeldet sein, um einen Agent zu registrieren.
        </p>
        <UButton
          :to="`/login?returnTo=${encodeURIComponent(route.fullPath)}`"
          color="primary"
          block
          label="Anmelden"
        />
      </template>

      <UAlert
        v-else-if="!validParams"
        color="error"
        title="Ungültige Enrollment-URL"
        description="Fehlende oder ungültige name/key Parameter."
      />

      <UAlert
        v-else-if="limitReached"
        color="warning"
        title="Agent-Limit erreicht"
        :description="`Du hast bereits ${agentCount}/${maxAgents} Agents registriert. Lösche einen bestehenden Agent unter 'Agents verwalten', um einen neuen zu registrieren.`"
      />

      <UAlert
        v-else-if="declined"
        color="neutral"
        title="Abgelehnt"
        description="Keine Aktion durchgeführt. Du kannst diese Seite schließen."
      />

      <template v-else>
        <div class="space-y-4">
          <UFormField label="Agent Name">
            <UInput :model-value="agentName" readonly />
          </UFormField>

          <UFormField label="Public Key">
            <UInput :model-value="agentKey" readonly class="font-mono text-xs" />
          </UFormField>

          <UAlert
            v-if="error"
            color="error"
            :title="error"
            class="mt-2"
          />

          <div class="flex gap-3 pt-2">
            <UButton
              color="primary"
              :loading="enrolling"
              :disabled="enrolling"
              block
              class="flex-1"
              @click="handleEnroll"
            >
              Agent registrieren
            </UButton>
            <UButton
              color="neutral"
              variant="outline"
              :disabled="enrolling"
              block
              class="flex-1"
              @click="declined = true"
            >
              Ablehnen
            </UButton>
          </div>
        </div>
      </template>
    </UCard>
  </IdpHero>
</template>
