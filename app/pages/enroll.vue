<script setup lang="ts">
const { user, loading: authLoading, fetchUser } = useIdpAuth()
const route = useRoute()

const agentId = computed(() => route.query.id as string || '')
const agentName = computed(() => route.query.name as string || '')
const agentKey = computed(() => route.query.key as string || '')
const validParams = computed(() => agentName.value && agentKey.value.startsWith('ssh-ed25519 '))

const enrolling = ref(false)
const declined = ref(false)
const error = ref('')
const hasAgent = ref(false)
const checkingAgent = ref(true)

onMounted(async () => {
  await fetchUser()
})

watch(user, async (u) => {
  if (u?.email) {
    checkingAgent.value = true
    try {
      const existing = await $fetch('/api/my-agent')
      hasAgent.value = !!existing
    }
    catch {
      hasAgent.value = false
    }
    finally {
      checkingAgent.value = false
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
    await navigateTo('/agent?enrolled=true')
  }
  catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string }, message?: string }
    error.value = e.data?.statusMessage ?? e.message ?? 'Enrollment failed'
  }
  finally {
    enrolling.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4 bg-gray-950">
    <UCard class="w-full max-w-lg bg-gray-900 border border-gray-800">
      <template #header>
        <h1 class="text-2xl font-bold text-center text-white">
          Agent Enrollment
        </h1>
      </template>

      <div v-if="authLoading || checkingAgent" class="text-center text-gray-400">
        Loading...
      </div>

      <template v-else-if="!user">
        <p class="text-center text-gray-400 mb-4">
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
        v-else-if="hasAgent"
        color="warning"
        title="Agent-Limit erreicht"
        description="Du hast bereits einen Agent registriert. Lösche ihn zuerst unter 'Agent verwalten', um einen neuen zu registrieren."
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
  </div>
</template>
