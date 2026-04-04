<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useIdpAuth } from '../composables/useIdpAuth'

const props = defineProps<{
  agentId?: string
  agentEmail?: string
  agentName?: string
  agentKey?: string
}>()

const emit = defineEmits<{
  enrolled: [result: { agentId: string }]
}>()

const { user, loading: authLoading, fetchUser } = useIdpAuth()

const validParams = computed(() =>
  props.agentEmail && props.agentName && props.agentKey?.startsWith('ssh-ed25519 '),
)

const owner = ref('')
const approver = ref('')
const enrolling = ref(false)
const declined = ref(false)
const error = ref('')
const loginUrl = computed(() => {
  const returnTo = typeof globalThis.window !== 'undefined' ? globalThis.window.location.href : '/'
  return `/login?returnTo=${encodeURIComponent(returnTo)}`
})

onMounted(() => fetchUser())

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
    const res = await fetch('/api/agent/enroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        id: props.agentId || undefined,
        email: props.agentEmail,
        name: props.agentName,
        publicKey: props.agentKey,
        owner: owner.value,
        approver: approver.value,
      }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.title || 'Enrollment failed')
    }
    const data = await res.json()
    emit('enrolled', { agentId: data.agent_id })
  }
  catch (err) {
    error.value = err instanceof Error ? err.message : 'Enrollment failed'
  }
  finally {
    enrolling.value = false
  }
}
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold text-center mb-6">
      Agent Enrollment
    </h1>

    <div v-if="authLoading" class="text-center text-gray-500">
      Loading...
    </div>

    <template v-else-if="!user">
      <p class="text-center text-gray-500 mb-4">
        You need to be logged in as admin to enroll agents.
      </p>
      <a
        :href="loginUrl"
        class="block w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white text-center hover:bg-blue-700"
      >
        Log in
      </a>
    </template>

    <div
      v-else-if="!validParams"
      class="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 text-sm text-red-700 dark:text-red-400"
    >
      <h3 class="font-semibold">
        Invalid enrollment URL
      </h3>
      <p>Missing or invalid email/name/key query parameters.</p>
    </div>

    <div
      v-else-if="declined"
      class="rounded-md bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-3 text-sm text-gray-600 dark:text-gray-400"
    >
      <h3 class="font-semibold">
        Declined
      </h3>
      <p>No action taken. You can close this page.</p>
    </div>

    <template v-else>
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium mb-1">Agent Email</label>
          <input
            :value="agentEmail"
            readonly
            class="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 px-3 py-2 text-sm font-mono"
          >
        </div>

        <div>
          <label class="block text-sm font-medium mb-1">Agent Name</label>
          <input
            :value="agentName"
            readonly
            class="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 px-3 py-2 text-sm"
          >
        </div>

        <div>
          <label class="block text-sm font-medium mb-1">Public Key</label>
          <input
            :value="agentKey"
            readonly
            class="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 px-3 py-2 text-sm font-mono"
          >
        </div>

        <div>
          <label class="block text-sm font-medium mb-1">Owner</label>
          <input
            v-model="owner"
            placeholder="Responsible for this agent"
            class="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
        </div>

        <div>
          <label class="block text-sm font-medium mb-1">Approver</label>
          <input
            v-model="approver"
            placeholder="Approves grant requests"
            class="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
        </div>

        <div
          v-if="error"
          class="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 text-sm text-red-700 dark:text-red-400"
        >
          {{ error }}
        </div>

        <div class="flex gap-3 pt-2">
          <button
            :disabled="enrolling || !owner || !approver"
            class="flex-1 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            @click="handleEnroll"
          >
            {{ enrolling ? 'Enrolling...' : 'Enroll Agent' }}
          </button>
          <button
            :disabled="enrolling"
            class="flex-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-2 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
            @click="declined = true"
          >
            Decline
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
