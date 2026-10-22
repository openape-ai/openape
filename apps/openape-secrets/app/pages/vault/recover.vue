<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useOpenApeAuth } from '#imports'
import { flowError, recoverVault } from '~/utils/vault-client'

const { user, fetchUser } = useOpenApeAuth()
const ready = ref(false)
const code = ref('')
const busy = ref(false)
const error = ref('')
const done = ref(false)

async function recover() {
  busy.value = true
  error.value = ''
  try {
    await recoverVault(code.value)
    code.value = ''
    done.value = true
  }
  catch (err) {
    error.value = flowError(err)
  }
  finally {
    busy.value = false
  }
}

onMounted(async () => {
  await fetchUser()
  ready.value = true
})
</script>

<template>
  <div class="min-h-dvh bg-default text-default">
    <VaultHeader :email="user?.sub" />

    <main class="mx-auto flex max-w-2xl flex-col gap-6 px-4 pb-16 pt-8 sm:px-8">
      <OpenApeAuth v-if="ready && !user" subtitle="Sign in to recover your vault." />

      <template v-else-if="ready">
        <div class="flex flex-col gap-2">
          <h1 class="text-[34px] font-semibold leading-tight tracking-tight">
            Recover your vault
          </h1>
          <p class="text-muted">
            Enter the recovery code you saved when you set up the vault. Then create a new passkey to replace the ones you lost.
          </p>
        </div>

        <section v-if="!done" class="flex flex-col gap-4 rounded-[20px] border border-default bg-muted p-6">
          <label for="recovery-code" class="text-[15px] font-semibold">Recovery code</label>
          <UTextarea
            id="recovery-code"
            v-model="code"
            :rows="3"
            autoresize
            placeholder="Q7KM 2XRD 9FPA …"
            autocomplete="off"
            autocapitalize="characters"
            spellcheck="false"
            class="w-full"
            :ui="{ base: 'font-mono text-lg tracking-[0.08em]' }"
          />
          <p class="text-sm text-dimmed">
            The code never leaves this device. It opens your vault here, and proves to the server that you hold it.
          </p>
          <UButton size="xl" icon="i-lucide-key-round" class="self-start" :disabled="!code.trim()" :loading="busy" @click="recover">
            Recover and create passkey
          </UButton>
          <UAlert v-if="error" color="error" variant="subtle" :title="error" />
        </section>

        <section v-else class="flex flex-col items-start gap-3 rounded-[20px] border border-default bg-muted p-6">
          <p role="status" class="flex items-center gap-2 text-lg font-semibold text-brass">
            <UIcon name="i-lucide-circle-check" class="size-6" />
            Your new passkey opens the vault
          </p>
          <p class="text-muted">
            Your recovery code still works. Keep it where it was. If a passkey was lost or stolen, remove it now so it can no longer open your vault.
          </p>
          <div class="flex flex-wrap gap-2">
            <UButton to="/vault/passkeys" size="lg">
              Review passkeys
            </UButton>
            <UButton to="/vault" size="lg" color="neutral" variant="subtle">
              Open vault
            </UButton>
          </div>
        </section>
      </template>
    </main>
  </div>
</template>
