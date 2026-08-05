<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'

// Destroy-agent state. Two-step UX: button on the page reveals a
// modal asking for typed confirmation (must enter agent name), then
// posts destroy-intent and polls until the nest reports back. On
// success, navigate back to /agents (the DB row is also dropped
// server-side by the WS handler, so refresh would also show the
// removal — but explicit navigateTo is the better UX).
const props = defineProps<{ agentName: string }>()

const { t } = useI18n()

const showDestroy = ref(false)
const destroyConfirmInput = ref('')
const destroying = ref(false)
const destroyError = ref('')
const destroyIntentId = ref('')
let destroyPollTimer: ReturnType<typeof setTimeout> | null = null

function openDestroy() {
  destroyConfirmInput.value = ''
  destroyError.value = ''
  destroyIntentId.value = ''
  showDestroy.value = true
}

async function pollDestroy(): Promise<void> {
  if (!destroyIntentId.value) return
  try {
    const res = await apiFetch<{ pending?: boolean, ok?: boolean, error?: string }>(`/api/agents/destroy-intent/${destroyIntentId.value}`)
    if (res.pending) {
      destroyPollTimer = setTimeout(() => { void pollDestroy() }, 2000)
      return
    }
    destroying.value = false
    if (res.ok) {
      showDestroy.value = false
      await navigateTo('/agents')
      return
    }
    destroyError.value = res.error || t('agentDetail.destroy.error.nestFailed')
  }
  catch (err: any) {
    destroying.value = false
    destroyError.value = err?.data?.statusMessage || err?.message || t('agentDetail.destroy.error.pollFailed')
  }
}

async function submitDestroy() {
  destroyError.value = ''
  destroying.value = true
  try {
    const res = await apiFetch<{ intent_id: string }>('/api/agents/destroy-intent', {
      method: 'POST',
      body: { name: props.agentName },
    })
    destroyIntentId.value = res.intent_id
    destroyPollTimer = setTimeout(() => { void pollDestroy() }, 2000)
  }
  catch (err: any) {
    destroying.value = false
    destroyError.value = err?.data?.statusMessage || err?.message || t('agentDetail.destroy.error.startFailed')
  }
}

onBeforeUnmount(() => { if (destroyPollTimer) clearTimeout(destroyPollTimer) })
</script>

<template>
  <!-- Danger zone — separated visually so it doesn't sit next to
       normal save buttons. Two-step destroy (type-the-name confirm
       in a modal) prevents accidental clicks on a phone, and
       matches the gravity of the operation: full Phase-G teardown
       on the nest (IdP-deregister + pm2 delete + root cleanup
       script + agent-home wipe). -->
  <section class="mt-12 pt-6 border-t border-red-500/20">
    <h2 class="text-sm font-medium text-red-400 mb-1">
      {{ $t('agentDetail.danger.title') }}
    </h2>
    <p class="text-xs text-muted mb-3">
      {{ $t('agentDetail.danger.hint') }}
    </p>
    <UButton color="error" variant="soft" icon="i-lucide-trash-2" @click="openDestroy">
      {{ $t('agentDetail.danger.deleteButton') }}
    </UButton>

    <UModal v-model:open="showDestroy" :title="$t('agentDetail.destroy.title')" :ui="{ content: 'sm:max-w-md' }">
      <template #body>
        <div class="space-y-4">
          <i18n-t keypath="agentDetail.destroy.body" tag="p" class="text-sm">
            <template #name>
              <span class="font-mono font-semibold">{{ agentName }}</span>
            </template>
          </i18n-t>
          <UFormField :label="$t('agentDetail.destroy.typeToConfirm', { name: agentName })">
            <UInput v-model="destroyConfirmInput" :placeholder="agentName" :disabled="destroying" autocomplete="off" />
          </UFormField>
          <UAlert v-if="destroyError" color="error" :title="destroyError" />
          <div v-if="destroyIntentId && !destroyError" class="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-xs flex items-start gap-2">
            <UIcon name="i-lucide-loader-circle" class="animate-spin shrink-0 size-4 mt-0.5" />
            <div>
              <div class="font-medium">
                {{ $t('agentDetail.destroy.pending.title') }}
              </div>
              <div class="text-muted mt-1">
                {{ $t('agentDetail.destroy.pending.hint') }}
              </div>
            </div>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex flex-row-reverse w-full gap-2">
          <UButton
            color="error"
            :loading="destroying"
            :disabled="destroying || destroyConfirmInput !== agentName"
            @click="submitDestroy"
          >
            {{ $t('agentDetail.destroy.confirmButton') }}
          </UButton>
          <UButton variant="ghost" :disabled="destroying" @click="showDestroy = false">
            {{ $t('common.cancel') }}
          </UButton>
        </div>
      </template>
    </UModal>
  </section>
</template>
