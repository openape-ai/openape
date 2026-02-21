<script setup lang="ts">
const { user, loading: authLoading, fetchUser } = useAuth()
const route = useRoute()

const agentName = computed(() => route.query.name as string || '')
const agentKey = computed(() => route.query.key as string || '')
const validParams = computed(() => agentName.value && agentKey.value.startsWith('ssh-ed25519 '))

const owner = ref('')
const approver = ref('')
const enrolling = ref(false)
const declined = ref(false)
const error = ref('')
const result = ref<{ agent_id: string; name: string } | null>(null)

await fetchUser()

watch(user, (u) => {
  if (u?.email) {
    owner.value = u.email
    approver.value = u.email
  }
}, { immediate: true })

async function handleEnroll() {
  enrolling.value = true
  error.value = ''
  try {
    const data = await $fetch<{ agent_id: string; name: string }>('/api/agent/enroll', {
      method: 'POST',
      body: {
        name: agentName.value,
        publicKey: agentKey.value,
        owner: owner.value,
        approver: approver.value,
      },
    })
    result.value = data
  } catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string }; message?: string }
    error.value = e.data?.statusMessage ?? e.message ?? 'Enrollment failed'
  } finally {
    enrolling.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4">
    <UCard class="w-full max-w-lg">
      <template #header>
        <h1 class="text-2xl font-bold text-center">Agent Enrollment</h1>
      </template>

      <!-- Loading -->
      <div v-if="authLoading" class="text-center text-muted">
        Loading...
      </div>

      <!-- Not logged in -->
      <template v-else-if="!user">
        <p class="text-center text-muted mb-4">You need to be logged in as admin to enroll agents.</p>
        <UButton
          :to="`/login?returnTo=${encodeURIComponent(route.fullPath)}`"
          color="primary"
          block
          label="Log in"
        />
      </template>

      <!-- Invalid URL params -->
      <UAlert
        v-else-if="!validParams"
        color="error"
        title="Invalid enrollment URL"
        description="Missing or invalid name/key query parameters."
      />

      <!-- Declined -->
      <UAlert
        v-else-if="declined"
        color="neutral"
        title="Declined"
        description="No action taken. You can close this page."
      />

      <!-- Success -->
      <template v-else-if="result">
        <UAlert color="success" title="Agent enrolled successfully" class="mb-4">
          <template #description>
            <strong>{{ result.name }}</strong> is now active.
          </template>
        </UAlert>

        <div class="space-y-3">
          <UFormField label="Agent ID">
            <UInput :model-value="result.agent_id" readonly class="font-mono" />
          </UFormField>

          <div class="bg-gray-900 rounded-lg p-3 font-mono text-sm break-all select-all">
            clawgate-sudo enroll --set-agent-id {{ result.agent_id }}
          </div>

          <p class="text-sm text-muted text-center">
            Run this command on the agent machine to complete setup.
          </p>
        </div>
      </template>

      <!-- Enrollment form -->
      <template v-else>
        <div class="space-y-4">
          <UFormField label="Agent Name">
            <UInput :model-value="agentName" readonly />
          </UFormField>

          <UFormField label="Public Key">
            <UInput :model-value="agentKey" readonly class="font-mono text-xs" />
          </UFormField>

          <UFormField label="Owner">
            <UInput v-model="owner" placeholder="Responsible for this agent" />
          </UFormField>

          <UFormField label="Approver">
            <UInput v-model="approver" placeholder="Approves grant requests" />
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
              :disabled="enrolling || !owner || !approver"
              block
              class="flex-1"
              @click="handleEnroll"
            >
              Enroll Agent
            </UButton>
            <UButton
              color="neutral"
              variant="outline"
              :disabled="enrolling"
              block
              class="flex-1"
              @click="declined = true"
            >
              Decline
            </UButton>
          </div>
        </div>
      </template>
    </UCard>
  </div>
</template>
