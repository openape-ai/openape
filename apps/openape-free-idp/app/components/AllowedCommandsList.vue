<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  isSafeCommandGrant,
  SAFE_COMMAND_DEFAULTS,
  SAFE_COMMAND_REASON_CUSTOM,
  SAFE_COMMAND_REASON_DEFAULT,
} from '../utils/safe-commands'

interface StandingGrant {
  id: string
  status: string
  type: string
  request: {
    reason?: string
    cli_id?: string
    action?: string
    delegate?: string
    resource_chain_template?: Array<{ resource: string, selector?: Record<string, string> }>
    max_risk?: string
    grant_type?: string
    duration?: number
  }
  created_at: number
}

const props = defineProps<{
  agentEmail: string
  owner: string
  standingGrants: StandingGrant[]
}>()

const emit = defineEmits<{
  (e: 'refresh'): void
  (e: 'addScoped'): void
}>()

const busy = ref<string | null>(null)
const error = ref('')

const safeCommandByCliId = computed(() => {
  const map = new Map<string, StandingGrant>()
  for (const g of props.standingGrants) {
    if (g.request?.reason !== SAFE_COMMAND_REASON_DEFAULT) continue
    const cliId = g.request?.cli_id
    if (typeof cliId === 'string') map.set(cliId, g)
  }
  return map
})

const customSafeCommands = computed(() =>
  props.standingGrants.filter(g => g.request?.reason === SAFE_COMMAND_REASON_CUSTOM),
)

const scopedCommands = computed(() =>
  props.standingGrants.filter(g => !isSafeCommandGrant(g)),
)

function scopeDescription(g: StandingGrant): string {
  const parts: string[] = []
  const template = g.request?.resource_chain_template ?? []
  for (const slot of template) {
    if (!slot.selector || Object.keys(slot.selector).length === 0) {
      parts.push(`${slot.resource}(*)`)
      continue
    }
    const pairs = Object.entries(slot.selector).map(([k, v]) => `${k}=${v}`).join(',')
    parts.push(`${slot.resource}(${pairs})`)
  }
  return parts.length > 0 ? parts.join(' → ') : 'any'
}

async function toggleDefault(cliId: string, action: 'read' | 'exec') {
  error.value = ''
  busy.value = cliId
  try {
    const existing = safeCommandByCliId.value.get(cliId)
    if (existing) {
      await ($fetch as any)(`/api/standing-grants/${encodeURIComponent(existing.id)}`, { method: 'DELETE' })
    }
    else {
      await ($fetch as any)('/api/standing-grants', {
        method: 'POST',
        body: {
          delegate: props.agentEmail,
          audience: 'shapes',
          target_host: '*',
          cli_id: cliId,
          resource_chain_template: [],
          action,
          max_risk: 'low',
          grant_type: 'always',
          reason: SAFE_COMMAND_REASON_DEFAULT,
        },
      })
    }
    emit('refresh')
  }
  catch (e: unknown) {
    const err = e as { data?: { detail?: string, title?: string } }
    error.value = err.data?.detail ?? err.data?.title ?? `Toggle ${cliId} failed`
  }
  finally {
    busy.value = null
  }
}

async function revoke(g: StandingGrant) {
  error.value = ''
  const id = g.request?.cli_id || g.id
  busy.value = id
  try {
    await ($fetch as any)(`/api/standing-grants/${encodeURIComponent(g.id)}`, { method: 'DELETE' })
    emit('refresh')
  }
  catch (e: unknown) {
    const err = e as { data?: { detail?: string, title?: string } }
    error.value = err.data?.detail ?? err.data?.title ?? 'Revoke fehlgeschlagen'
  }
  finally {
    busy.value = null
  }
}
</script>

<template>
  <div class="space-y-4">
    <div>
      <div class="flex items-center justify-between gap-2">
        <h2 class="text-base font-semibold text-white">
          Erlaubte Commands
        </h2>
        <UButton
          color="primary"
          variant="soft"
          size="xs"
          icon="i-lucide-plus"
          @click="emit('addScoped')"
        >
          Hinzufügen
        </UButton>
      </div>
      <p class="text-xs text-gray-500 mt-1">
        Was darf dieser Agent ohne Rückfrage ausführen?
      </p>
    </div>

    <UAlert
      v-if="error"
      color="error"
      :title="error"
      @close="error = ''"
    />

    <div>
      <div class="text-xs text-gray-400 font-medium mb-2 flex items-center gap-1">
        <UIcon name="i-lucide-shield-check" class="text-green-400" />
        Safe Commands (Low-Risk Defaults)
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <label
          v-for="def in SAFE_COMMAND_DEFAULTS"
          :key="def.cli_id"
          class="flex items-start gap-2 p-2 rounded-md border border-gray-700 bg-gray-800/50 hover:bg-gray-800 cursor-pointer"
          :title="def.description"
        >
          <UCheckbox
            :model-value="safeCommandByCliId.has(def.cli_id)"
            :disabled="busy === def.cli_id"
            @update:model-value="toggleDefault(def.cli_id, def.action)"
          />
          <div class="text-xs min-w-0">
            <div class="font-mono font-semibold text-gray-100">
              {{ def.cli_id }}
            </div>
            <div class="text-gray-400 truncate">
              {{ def.display }}
            </div>
          </div>
        </label>
      </div>
    </div>

    <div v-if="customSafeCommands.length > 0 || scopedCommands.length > 0">
      <div class="text-xs text-gray-400 font-medium mb-2 flex items-center gap-1">
        <UIcon name="i-lucide-filter" class="text-primary" />
        Custom + Scoped
      </div>
      <div class="space-y-2">
        <div
          v-for="g in customSafeCommands"
          :key="g.id"
          class="flex items-center justify-between p-2 rounded-md border border-gray-700 bg-gray-800/50"
        >
          <div class="min-w-0">
            <code class="text-xs font-mono text-gray-200 break-all">
              {{ g.request?.cli_id }} ({{ g.request?.action ?? 'any' }})
            </code>
            <div class="text-xs text-gray-500 mt-0.5">
              Custom Safe Command
            </div>
          </div>
          <UButton
            variant="ghost"
            size="xs"
            color="error"
            icon="i-lucide-x"
            :disabled="busy === (g.request?.cli_id || g.id)"
            @click="revoke(g)"
          />
        </div>

        <div
          v-for="g in scopedCommands"
          :key="g.id"
          class="flex items-center justify-between p-2 rounded-md border border-gray-700 bg-gray-800/50"
        >
          <div class="min-w-0 flex-1">
            <code class="text-xs font-mono text-gray-200 break-all block">
              {{ g.request?.cli_id ?? '*' }}
              <span class="text-gray-500">·</span>
              {{ g.request?.action ?? 'any' }}
            </code>
            <div class="text-xs text-gray-400 font-mono break-all">
              {{ scopeDescription(g) }}
            </div>
            <div v-if="g.request?.reason" class="text-xs text-gray-500 mt-0.5">
              {{ g.request.reason }}
            </div>
          </div>
          <UButton
            variant="ghost"
            size="xs"
            color="error"
            icon="i-lucide-trash-2"
            :disabled="busy === g.id"
            @click="revoke(g)"
          />
        </div>
      </div>
    </div>

    <div v-else class="text-xs text-gray-500 italic">
      Keine Custom- oder Scoped-Commands. Tippe auf "Hinzufügen" um einen scoped Command zu definieren.
    </div>
  </div>
</template>
