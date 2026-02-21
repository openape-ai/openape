<script setup lang="ts">
const { user, loading: authLoading, fetchUser } = useAuth()
const route = useRoute()
const agentId = route.params.id as string

await fetchUser()

interface Agent {
  id: string
  name: string
  owner: string
  approver: string
  publicKey: string
  isActive: boolean
  createdAt: number
}

const agent = ref<Agent | null>(null)
const loading = ref(true)
const error = ref('')
const approving = ref(false)
const approved = ref(false)
const owner = ref('')
const approver = ref('')

onMounted(async () => {
  try {
    const data = await $fetch<Agent>(`/api/admin/agents/${agentId}`)
    agent.value = data
  } catch (e: any) {
    error.value = e?.data?.statusMessage || 'Agent not found'
  } finally {
    loading.value = false
  }
})

watch(user, (u) => {
  if (u?.email) {
    owner.value = u.email
    approver.value = u.email
  }
}, { immediate: true })

async function approveAgent() {
  approving.value = true
  error.value = ''
  try {
    await $fetch(`/api/agent/${agentId}/approve`, {
      method: 'POST',
      body: { owner: owner.value, approver: approver.value },
    })
    approved.value = true
  } catch (e: any) {
    error.value = e?.data?.statusMessage || 'Failed to approve agent'
  } finally {
    approving.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-gray-950 text-white">
    <div class="max-w-xl mx-auto px-4 py-16">
      <div class="text-center mb-8">
        <h1 class="text-3xl font-bold">🦍 Agent Enrollment</h1>
        <p class="text-gray-400 mt-2">Review and approve agent registration</p>
      </div>

      <!-- Loading -->
      <div v-if="loading || authLoading" class="text-center text-gray-400">
        Loading...
      </div>

      <!-- Not logged in -->
      <div v-else-if="!user" class="bg-gray-900 rounded-xl border border-gray-800 p-6 text-center">
        <p class="text-gray-400 mb-4">You need to be logged in as admin to approve agents.</p>
        <NuxtLink :to="`/login?returnTo=/enroll/${agentId}`" class="inline-block px-4 py-2 bg-orange-600 hover:bg-orange-500 rounded-lg font-medium transition">
          Log in
        </NuxtLink>
      </div>

      <!-- Error -->
      <div v-else-if="error && !agent" class="bg-red-900/20 border border-red-800 rounded-xl p-6 text-center">
        <p class="text-red-400">{{ error }}</p>
      </div>

      <!-- Already approved -->
      <div v-else-if="approved" class="bg-gray-900 rounded-xl border border-green-800 p-6 text-center">
        <div class="text-4xl mb-4">✅</div>
        <h2 class="text-xl font-bold text-green-400 mb-2">Agent Approved</h2>
        <p class="text-gray-400 mb-4">
          <strong class="text-white">{{ agent?.name }}</strong> is now active.
        </p>
        <div class="bg-gray-800 rounded-lg p-4 font-mono text-sm text-left">
          <div class="text-gray-400">Agent ID (set this on the machine):</div>
          <div class="text-orange-400 mt-1 break-all select-all">{{ agentId }}</div>
        </div>
        <p class="text-gray-500 text-sm mt-4">
          Run: <code class="text-gray-300">clawgate-sudo enroll --set-agent-id {{ agentId }}</code>
        </p>
      </div>

      <!-- Already active -->
      <div v-else-if="agent?.isActive" class="bg-gray-900 rounded-xl border border-gray-800 p-6 text-center">
        <div class="text-4xl mb-4">✓</div>
        <h2 class="text-xl font-bold mb-2">Agent Already Active</h2>
        <p class="text-gray-400">
          <strong class="text-white">{{ agent.name }}</strong> is already registered and active.
        </p>
      </div>

      <!-- Pending approval -->
      <div v-else-if="agent" class="space-y-6">
        <div class="bg-gray-900 rounded-xl border border-orange-800/50 p-6">
          <div class="flex items-center gap-3 mb-4">
            <span class="text-2xl">🤖</span>
            <div>
              <h2 class="text-xl font-bold">{{ agent.name }}</h2>
              <span class="text-xs px-2 py-0.5 rounded-full bg-orange-900/50 text-orange-400">Pending Approval</span>
            </div>
          </div>

          <div class="space-y-3 text-sm">
            <div>
              <div class="text-gray-500">Agent ID</div>
              <div class="font-mono text-gray-300 break-all">{{ agent.id }}</div>
            </div>
            <div>
              <div class="text-gray-500">Public Key</div>
              <div class="font-mono text-gray-300 text-xs break-all bg-gray-800 rounded p-2">{{ agent.publicKey }}</div>
            </div>
            <div>
              <div class="text-gray-500">Registered</div>
              <div class="text-gray-300">{{ new Date(agent.createdAt).toLocaleString() }}</div>
            </div>
          </div>
        </div>

        <div class="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-4">
          <h3 class="font-semibold">Assign Ownership</h3>
          <div>
            <label class="block text-sm text-gray-400 mb-1">Owner (responsible for this agent)</label>
            <input v-model="owner" type="text" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:border-orange-500 focus:outline-none" />
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-1">Approver (who approves grant requests)</label>
            <input v-model="approver" type="text" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:border-orange-500 focus:outline-none" />
          </div>
        </div>

        <div v-if="error" class="bg-red-900/20 border border-red-800 rounded-lg p-3 text-red-400 text-sm">
          {{ error }}
        </div>

        <button
          @click="approveAgent"
          :disabled="approving || !owner || !approver"
          class="w-full py-3 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-semibold text-lg transition"
        >
          {{ approving ? 'Approving...' : '🦍 Approve Agent' }}
        </button>
      </div>
    </div>
  </div>
</template>
