<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { OpenApeCliResourceRef } from '@openape/core'
import WizardStepCommand from './WizardStepCommand.vue'
import WizardStepScope from './WizardStepScope.vue'
import type { ScopeSlot } from './WizardStepScope.vue'
import WizardStepPolicy from './WizardStepPolicy.vue'
import type { PolicyState } from './WizardStepPolicy.vue'
import type { ResolvedCommand } from '../composables/useShapeResolver'

const props = defineProps<{
  open: boolean
  /** The agent whose policy this SG scopes. */
  agentEmail: string
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'created'): void
}>()

const step = ref(1)
const argvInput = ref('')
const resolved = ref<ResolvedCommand | null>(null)
const slots = ref<ScopeSlot[]>([])
const policy = ref<PolicyState>({
  max_risk: 'low',
  grant_type: 'always',
  reason: '',
})
const submitting = ref(false)
const submitError = ref('')

watch(() => props.open, (v) => {
  if (v) reset()
})

function reset() {
  step.value = 1
  argvInput.value = ''
  resolved.value = null
  slots.value = []
  policy.value = { max_risk: 'low', grant_type: 'always', reason: '' }
  submitError.value = ''
}

function close() {
  if (submitting.value) return
  emit('update:open', false)
}

function onResolved(r: ResolvedCommand) {
  resolved.value = r
  if (policy.value.max_risk === 'low' && r.detail.risk !== 'low') {
    policy.value.max_risk = r.detail.risk
  }
}

function buildResourceChainTemplate(): OpenApeCliResourceRef[] {
  const byResource = new Map<string, Record<string, string>>()
  const order: string[] = []
  for (const slot of slots.value) {
    if (slot.mode === 'any') {
      if (!byResource.has(slot.resource)) {
        byResource.set(slot.resource, {})
        order.push(slot.resource)
      }
      continue
    }
    const existing = byResource.get(slot.resource) ?? {}
    existing[slot.selectorKey] = slot.value
    if (!byResource.has(slot.resource)) order.push(slot.resource)
    byResource.set(slot.resource, existing)
  }
  return order.map((resource) => {
    const selector = byResource.get(resource)!
    if (Object.keys(selector).length === 0) return { resource }
    return { resource, selector }
  })
}

async function submit() {
  if (!resolved.value) return
  submitError.value = ''
  submitting.value = true
  try {
    const body: Record<string, unknown> = {
      delegate: props.agentEmail,
      audience: 'shapes',
      target_host: '*',
      cli_id: resolved.value.cli_id,
      resource_chain_template: buildResourceChainTemplate(),
      action: resolved.value.detail.action,
      max_risk: policy.value.max_risk,
      grant_type: policy.value.grant_type,
    }
    if (policy.value.grant_type === 'timed' && policy.value.duration) body.duration = policy.value.duration
    if (policy.value.reason.trim()) body.reason = policy.value.reason.trim()

    await ($fetch as any)('/api/standing-grants', { method: 'POST', body })
    emit('created')
    emit('update:open', false)
  }
  catch (e: unknown) {
    const err = e as { data?: { detail?: string, title?: string } }
    submitError.value = err.data?.detail ?? err.data?.title ?? 'Speichern fehlgeschlagen'
  }
  finally {
    submitting.value = false
  }
}

const canAdvanceFromStep1 = computed(() => !!resolved.value)
const canSave = computed(() => !!resolved.value && !submitting.value)

const stepLabels = ['Command', 'Scope', 'Policy']
</script>

<template>
  <UModal
    :open="open"
    fullscreen
    :dismissible="!submitting"
    @update:open="(v: boolean) => emit('update:open', v)"
  >
    <template #content>
      <div class="flex flex-col h-full bg-gray-950">
        <header class="sticky top-0 z-10 px-4 py-3 bg-gray-900/95 backdrop-blur border-b border-gray-800">
          <div class="flex items-center gap-3">
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              icon="i-lucide-x"
              :disabled="submitting"
              @click="close"
            />
            <h2 class="text-base font-semibold text-white flex-1 truncate">
              Erlaubten Command hinzufügen
            </h2>
          </div>
          <div class="flex items-center gap-1 mt-3">
            <div
              v-for="(label, idx) in stepLabels"
              :key="label"
              class="flex items-center gap-1"
            >
              <div
                class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold"
                :class="step >= idx + 1 ? 'bg-primary text-white' : 'bg-gray-800 text-gray-400'"
              >
                {{ idx + 1 }}
              </div>
              <span
                class="text-xs"
                :class="step >= idx + 1 ? 'text-white' : 'text-gray-500'"
              >{{ label }}</span>
              <UIcon
                v-if="idx < stepLabels.length - 1"
                name="i-lucide-chevron-right"
                class="text-gray-600 mx-1"
              />
            </div>
          </div>
        </header>

        <main class="flex-1 overflow-y-auto p-4 space-y-4">
          <UAlert
            v-if="submitError"
            color="error"
            :title="submitError"
            @close="submitError = ''"
          />

          <WizardStepCommand
            v-show="step === 1"
            v-model:input="argvInput"
            @resolved="onResolved"
          />

          <WizardStepScope
            v-if="step === 2 && resolved"
            :resolved="resolved"
            @update="(v) => (slots = v)"
          />

          <WizardStepPolicy
            v-if="step === 3 && resolved"
            :initial="policy"
            :resolved-risk="resolved.detail.risk"
            @update="(v) => (policy = v)"
          />
        </main>

        <footer class="sticky bottom-0 px-4 py-3 bg-gray-900/95 backdrop-blur border-t border-gray-800">
          <div class="flex items-center justify-between gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              :disabled="step === 1 || submitting"
              icon="i-lucide-chevron-left"
              @click="step = Math.max(1, step - 1)"
            >
              Zurück
            </UButton>

            <UButton
              v-if="step < 3"
              color="primary"
              :disabled="step === 1 && !canAdvanceFromStep1"
              trailing-icon="i-lucide-chevron-right"
              @click="step = step + 1"
            >
              Weiter
            </UButton>

            <UButton
              v-else
              color="primary"
              :loading="submitting"
              :disabled="!canSave"
              icon="i-lucide-check"
              @click="submit"
            >
              Speichern
            </UButton>
          </div>
        </footer>
      </div>
    </template>
  </UModal>
</template>
