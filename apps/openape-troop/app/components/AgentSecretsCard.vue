<script setup lang="ts">
import { computed, ref, watch } from 'vue'

// Secrets — capability values bound to this agent. Listed by env name + status
// only; troop never returns the value (it's sealed to the agent).
// Add/rotate = PUT, revoke = DELETE (M2c endpoints).
interface SecretRow {
  env: string
  status: 'active' | 'revoked'
  created_at: number
  updated_at: number
  revoked_at: number | null
}

const props = defineProps<{ agentName: string }>()

const { t } = useI18n()

const secrets = ref<SecretRow[]>([])
const secretsError = ref('')
const newSecret = ref({ env: '', value: '' })
const secretSaving = ref(false)

const activeCount = computed(() => secrets.value.filter(s => s.status === 'active').length)

async function loadSecrets() {
  if (!props.agentName) return
  secretsError.value = ''
  try {
    const res = await apiFetch<{ secrets: SecretRow[] }>(`/api/agents/${props.agentName}/secrets`)
    secrets.value = res.secrets
  }
  catch (err: any) { secretsError.value = err?.data?.statusMessage || err?.message || t('agentDetail.secrets.error.loadFailed') }
}
watch(() => props.agentName, loadSecrets, { immediate: true })

async function saveSecret() {
  if (!props.agentName || !newSecret.value.env || !newSecret.value.value) return
  secretSaving.value = true
  secretsError.value = ''
  try {
    await apiFetch(`/api/agents/${props.agentName}/secrets/${encodeURIComponent(newSecret.value.env)}`, {
      method: 'PUT',
      body: { value: newSecret.value.value },
    })
    newSecret.value = { env: '', value: '' }
    await loadSecrets()
  }
  catch (err: any) {
    secretsError.value = err?.data?.statusMessage || err?.message || t('agentDetail.secrets.error.saveFailed')
  }
  finally {
    secretSaving.value = false
  }
}

async function revokeSecret(env: string) {
  if (!props.agentName) return
  if (!confirm(t('agentDetail.secrets.confirmRevoke', { env }))) return
  try {
    await apiFetch(`/api/agents/${props.agentName}/secrets/${encodeURIComponent(env)}`, { method: 'DELETE' })
    await loadSecrets()
  }
  catch (err: any) {
    secretsError.value = err?.data?.statusMessage || err?.message || t('agentDetail.secrets.error.revokeFailed')
  }
}
</script>

<template>
  <UCard :ui="{ body: 'p-0' }">
    <details class="group">
      <summary class="cursor-pointer list-none px-4 py-3 flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 text-sm">
          <UIcon name="i-lucide-key-round" class="text-muted size-4" />
          <span class="font-medium">{{ $t('agentDetail.secrets.title') }}</span>
          <UBadge color="neutral" variant="subtle" size="xs">
            {{ activeCount }}
          </UBadge>
        </div>
        <UIcon name="i-lucide-chevron-down" class="size-4 text-muted transition-transform group-open:rotate-180" />
      </summary>
      <div class="border-t border-(--ui-border)">
        <p class="text-xs text-muted px-4 py-3">
          {{ $t('agentDetail.secrets.hint') }}
        </p>
        <ChatgptConnect :agent-name="agentName" @connected="loadSecrets" />
        <UAlert v-if="secretsError" color="error" :title="secretsError" class="m-4" />
        <ul v-if="secrets.length > 0" class="divide-y divide-(--ui-border)">
          <li v-for="s in secrets" :key="s.env" class="px-4 py-3 flex items-center gap-3">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <code class="font-medium">{{ s.env }}</code>
                <UBadge :color="s.status === 'active' ? 'success' : 'neutral'" variant="subtle" size="xs">
                  {{ $t(`agentDetail.secrets.status.${s.status}`) }}
                </UBadge>
              </div>
            </div>
            <UButton
              v-if="s.status === 'active'"
              size="sm"
              color="error"
              variant="ghost"
              icon="i-lucide-trash-2"
              :aria-label="$t('agentDetail.secrets.revokeAria')"
              @click="revokeSecret(s.env)"
            />
          </li>
        </ul>
        <div class="px-4 py-3 border-t border-(--ui-border) space-y-2">
          <div class="flex items-stretch gap-2">
            <UInput
              v-model="newSecret.env"
              :placeholder="$t('agentDetail.secrets.envPlaceholder')"
              class="flex-1"
              :ui="{ base: 'w-full' }"
              :disabled="secretSaving"
            />
            <UInput
              v-model="newSecret.value"
              type="password"
              :placeholder="$t('agentDetail.secrets.valuePlaceholder')"
              class="flex-1"
              :ui="{ base: 'w-full' }"
              :disabled="secretSaving"
            />
            <UButton
              color="primary"
              :loading="secretSaving"
              :disabled="!newSecret.env || !newSecret.value"
              @click="saveSecret"
            >
              {{ $t('agentDetail.secrets.setButton') }}
            </UButton>
          </div>
          <p class="text-[11px] text-muted">
            {{ $t('agentDetail.secrets.casingHint') }}
          </p>
        </div>
      </div>
    </details>
  </UCard>
</template>
