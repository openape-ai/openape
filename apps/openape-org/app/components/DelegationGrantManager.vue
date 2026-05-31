<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

interface DelegationGrant {
  ownerEmail: string
  audience: string
  grantId: string
  createdAt: number
  revokedAt: number | null
}

const props = defineProps<{ orgId: string }>()

const { t } = useI18n()
const { fmtDate } = useDateFormat()
const config = useRuntimeConfig()

const grants = ref<DelegationGrant[]>([])
const loading = ref(true)
const error = ref('')

const pasteForm = ref({ audience: 'apes-cli', grant_id: '' })
const saving = ref(false)

// Pre-built CLI command the Owner copy-pastes into their terminal.
// Building it client-side keeps both `delegate` (org's agent email)
// and `at` (audience) in lockstep with what the spawn API will look
// for. Fixed `--approval always` because re-entering the grant_id
// for every spawn would defeat the purpose.
const cliCommand = computed(() => {
  const orgEmail = (config.public as { orgIdpAgentEmail?: string }).orgIdpAgentEmail || 'agent+openape-org@id.openape.ai'
  return `apes grants delegate --to ${orgEmail} --at apes-cli --approval always`
})

async function load() {
  loading.value = true
  error.value = ''
  try { grants.value = await ($fetch as any)(`/api/orgs/${props.orgId}/delegation-grants`) }
  catch (err: any) { error.value = err?.data?.statusMessage || err?.message || t('delegation.error.loadFailed') }
  finally { loading.value = false }
}

async function savePaste() {
  if (!pasteForm.value.grant_id.trim()) return
  saving.value = true
  error.value = ''
  try {
    await ($fetch as any)(`/api/orgs/${props.orgId}/delegation-grants`, {
      method: 'POST',
      body: { audience: pasteForm.value.audience, grant_id: pasteForm.value.grant_id.trim() },
    })
    pasteForm.value.grant_id = ''
    await load()
  }
  catch (err: any) { error.value = err?.data?.statusMessage || err?.message || t('delegation.error.saveFailed') }
  finally { saving.value = false }
}

async function revoke(g: DelegationGrant) {
  if (!confirm(t('delegation.confirmRevoke', { audience: g.audience }))) return
  try {
    await ($fetch as any)(`/api/orgs/${props.orgId}/delegation-grants/${encodeURIComponent(g.audience)}`, { method: 'DELETE' })
    await load()
  }
  catch (err: any) { error.value = err?.data?.statusMessage || err?.message || t('delegation.error.revokeFailed') }
}

function copy(s: string) {
  try { navigator.clipboard.writeText(s) }
  catch { /* clipboard blocked */ }
}

onMounted(load)
</script>

<template>
  <UCard>
    <template #header>
      <h3 class="font-semibold">
        {{ $t('delegation.title') }}
      </h3>
      <p class="text-xs text-muted mt-1">
        {{ $t('delegation.subtitle') }}
      </p>
    </template>

    <UAlert v-if="error" color="error" :title="error" class="mb-3" />

    <!-- Existing active grants. Each row shows audience + a short
         grant_id prefix + a revoke action. The full grant_id is never
         shown after the first paste — Owner can re-paste if they need
         to recover it from `apes grants list` output. -->
    <ul v-if="grants.length > 0" class="space-y-2 mb-4">
      <li v-for="g in grants" :key="g.audience" class="flex items-center justify-between gap-3 px-3 py-2 rounded-md border border-(--ui-border) bg-(--ui-bg-elevated)">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <UBadge color="success" variant="subtle" size="xs">
              {{ $t('delegation.statusActive') }}
            </UBadge>
            <code class="text-xs font-mono">{{ g.audience }}</code>
          </div>
          <p class="text-[10px] text-muted mt-1 font-mono break-all">
            {{ g.grantId.slice(0, 12) }}… · {{ fmtDate(g.createdAt) }}
          </p>
        </div>
        <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :title="$t('delegation.revoke')" @click="revoke(g)" />
      </li>
    </ul>

    <div v-else-if="!loading" class="rounded-md border border-dashed border-(--ui-border) p-4 text-center text-xs text-muted mb-4">
      {{ $t('delegation.empty') }}
    </div>

    <!-- Bootstrap instructions: pre-built CLI command + paste form.
         Two steps shown sequentially so the Owner doesn't get lost. -->
    <div class="space-y-3 border-t border-(--ui-border) pt-4">
      <div>
        <p class="text-xs font-medium uppercase tracking-wide text-muted mb-1">
          {{ $t('delegation.step1.title') }}
        </p>
        <p class="text-xs text-muted mb-2">
          {{ $t('delegation.step1.description') }}
        </p>
        <div class="flex items-stretch gap-2">
          <code class="flex-1 px-3 py-2 rounded-md bg-(--ui-bg-elevated) text-xs font-mono break-all">{{ cliCommand }}</code>
          <UButton size="sm" variant="soft" color="neutral" icon="i-lucide-copy" :title="$t('common.copy')" @click="copy(cliCommand)" />
        </div>
      </div>

      <div>
        <p class="text-xs font-medium uppercase tracking-wide text-muted mb-1">
          {{ $t('delegation.step2.title') }}
        </p>
        <p class="text-xs text-muted mb-2">
          {{ $t('delegation.step2.description') }}
        </p>
        <div class="flex items-stretch gap-2">
          <UInput v-model="pasteForm.grant_id" :placeholder="$t('delegation.step2.placeholder')" class="flex-1" :ui="{ base: 'w-full font-mono text-xs' }" :disabled="saving" autocomplete="off" autocapitalize="off" />
          <UButton color="primary" :loading="saving" :disabled="!pasteForm.grant_id.trim()" @click="savePaste">
            {{ $t('delegation.step2.save') }}
          </UButton>
        </div>
      </div>
    </div>
  </UCard>
</template>
