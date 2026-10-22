<script setup lang="ts">
import { onMounted, ref } from 'vue'
import VaultPanel from '../components/VaultPanel.vue'

const { user, fetchUser } = useOpenApeAuth()
const checkingSession = ref(true)
onMounted(async () => {
  try { await fetchUser() }
  finally { checkingSession.value = false }
})
</script>

<template>
  <p v-if="checkingSession" role="status" class="p-6">
    Checking your session…
  </p>
  <OpenApeAuth v-else-if="!user" post-login-redirect="/vault" />
  <ClientOnly v-else><VaultPanel /></ClientOnly>
</template>
