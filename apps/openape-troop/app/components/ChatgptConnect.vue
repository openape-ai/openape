<script setup lang="ts">
import { onUnmounted, ref } from 'vue'

// "Sign in with ChatGPT" device flow for one agent. Owner clicks Connect →
// we start the flow (initiate), show the user_code + verification link, and
// poll until ChatGPT confirms. On success the sealed auth.json is pushed to
// the agent (server side) and the agent appears connected.
const props = defineProps<{ agentName: string }>()
const emit = defineEmits<{ connected: [] }>()

type State = 'idle' | 'pending' | 'connected' | 'error'
const state = ref<State>('idle')
const userCode = ref('')
const verificationUri = ref('')
const accountId = ref('')
const error = ref('')
let timer: ReturnType<typeof setTimeout> | null = null

async function connect() {
  error.value = ''
  state.value = 'pending'
  try {
    const res = await ($fetch as any)(`/api/agents/${props.agentName}/oauth/chatgpt/initiate`, { method: 'POST' })
    userCode.value = res.user_code
    verificationUri.value = res.verification_uri
    schedule((res.interval ?? 5) * 1000)
  }
  catch (e: any) {
    state.value = 'error'
    error.value = e?.data?.statusMessage || e?.message || 'failed to start'
  }
}

function schedule(ms: number) {
  timer = setTimeout(poll, ms)
}

async function poll() {
  try {
    const res = await ($fetch as any)(`/api/agents/${props.agentName}/oauth/chatgpt/poll`, { method: 'POST' })
    if (res.status === 'connected') {
      state.value = 'connected'
      accountId.value = res.account_id
      emit('connected')
    }
    else if (res.status === 'denied') {
      state.value = 'error'
      error.value = res.error || 'denied'
    }
    else {
      schedule(res.status === 'slow_down' ? 8000 : 5000)
    }
  }
  catch (e: any) {
    state.value = 'error'
    error.value = e?.data?.statusMessage || e?.message || 'poll failed'
  }
}

onUnmounted(() => {
  if (timer) clearTimeout(timer)
})
</script>

<template>
  <div class="px-4 py-3 border-b border-(--ui-border)">
    <div v-if="state === 'connected'" class="flex items-center gap-2 text-sm">
      <UIcon name="i-lucide-circle-check" class="text-success size-4" />
      <span>{{ $t('agentDetail.chatgpt.connected', { account: accountId }) }}</span>
    </div>
    <div v-else-if="state === 'pending'" class="space-y-2">
      <p class="text-sm">
        {{ $t('agentDetail.chatgpt.enterCode') }}
        <a :href="verificationUri" target="_blank" rel="noopener" class="text-primary underline">{{ verificationUri }}</a>
      </p>
      <div class="font-mono text-xl tracking-widest">
        {{ userCode }}
      </div>
      <p class="text-xs text-muted flex items-center gap-1">
        <UIcon name="i-lucide-loader-circle" class="size-3 animate-spin" />
        {{ $t('agentDetail.chatgpt.waiting') }}
      </p>
    </div>
    <div v-else class="flex flex-wrap items-center gap-2">
      <UButton color="primary" variant="subtle" icon="i-lucide-sparkles" @click="connect">
        {{ $t('agentDetail.chatgpt.connectButton') }}
      </UButton>
      <span class="text-xs text-muted">{{ $t('agentDetail.chatgpt.hint') }}</span>
    </div>
    <UAlert v-if="state === 'error'" color="error" :title="error" class="mt-2" />
  </div>
</template>
