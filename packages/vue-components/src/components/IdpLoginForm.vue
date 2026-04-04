<script setup lang="ts">
import { ref } from 'vue'
import { useKeyLogin } from '../composables/useKeyLogin'

const props = defineProps<{
  baseUrl?: string
  returnTo?: string
  loginHint?: string
}>()

const emit = defineEmits<{
  success: []
  error: [message: string]
}>()

const email = ref(props.loginHint || '')
const keyMode = ref(false)
const privateKeyPem = ref('')
const { loginWithKey, loading, error } = useKeyLogin(props.baseUrl)

async function handleKeyLogin() {
  const ok = await loginWithKey(email.value, privateKeyPem.value)
  if (ok) {
    if (props.returnTo) {
      window.location.href = props.returnTo
    }
    else {
      emit('success')
    }
  }
  else {
    emit('error', error.value)
  }
}

function handleFileSelect(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file) {
    const reader = new FileReader()
    reader.onload = () => { privateKeyPem.value = reader.result as string }
    reader.readAsText(file)
  }
}
</script>

<template>
  <div class="space-y-4">
    <UFormField label="Email">
      <UInput v-model="email" type="email" placeholder="user@example.com" />
    </UFormField>

    <!-- Normal mode: Passkey (placeholder for now) -->
    <div v-if="!keyMode" class="space-y-3">
      <UButton
        color="primary"
        block
        disabled
        label="Sign in with Passkey (coming soon)"
      />
    </div>

    <!-- Key mode: ed25519 private key -->
    <div v-if="keyMode" class="space-y-3">
      <UFormField label="Private Key">
        <UTextarea
          v-model="privateKeyPem"
          placeholder="Paste your ed25519 private key or select file..."
          :rows="4"
          class="font-mono text-xs"
        />
      </UFormField>
      <input
        type="file"
        accept=".pem,.key,id_ed25519"
        class="text-sm"
        @change="handleFileSelect"
      >
      <UButton
        color="primary"
        block
        :loading="loading"
        :disabled="!email || !privateKeyPem || loading"
        label="Sign in with Key"
        @click="handleKeyLogin"
      />
    </div>

    <UAlert v-if="error" color="error" :title="error" />

    <!-- Pro mode toggle: subtle key icon in bottom-right -->
    <div class="flex justify-end">
      <button
        class="text-xs opacity-30 hover:opacity-100 transition-opacity px-1"
        :title="keyMode ? 'Switch to Passkey' : 'Switch to Key Login'"
        @click="keyMode = !keyMode"
      >
        {{ keyMode ? 'passkey' : 'key' }}
      </button>
    </div>
  </div>
</template>
