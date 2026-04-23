<script setup>
import { computed, onMounted, ref } from 'vue'
import { navigateTo, useRoute } from '#imports'
import { useIdpAuth } from '../../composables/useIdpAuth'
import { isSafeCommandGrant, SAFE_COMMAND_DEFAULTS } from '../../utils/safe-commands'
import {
  formatRelativeTime,
  formatStandingGrantScope,
  parseResourceChainInput,
} from '../../utils/standing-grants'

const { user, loading: authLoading, fetchUser } = useIdpAuth()
const route = useRoute()
const targetEmail = computed(() => decodeURIComponent(route.params.email))
const agent = ref(null)
const loading = ref(true)
const error = ref('')
const success = ref('')
const shapes = ref([])
const form = ref({
  cli_id: '',
  resource_chain_text: '',
  max_risk: 'low',
  grant_type: 'always',
  duration: 3600,
  reason: '',
})
const formSubmitting = ref(false)
const formError = ref('')
const revokeTarget = ref(null)
const revoking = ref(false)
const safeCommandsBusy = ref(null)
const customInput = ref('')
const safeCommandError = ref('')
// YOLO-Modus state
const yoloPolicy = ref(null)
const yoloLoading = ref(false)
const yoloError = ref('')
const yoloForm = ref({
  denyRiskThreshold: 'high',
  denyPatterns: '',
})
const yoloSubmitting = ref(false)
const yoloEditing = ref(false)
const yoloExpiryInfo = computed(() => {
  const ts = yoloPolicy.value?.expiresAt
  if (!ts) return null
  const date = new Date(ts * 1000)
  return date.toLocaleString()
})
const safeCommandGrants = computed(
  () => agent.value ? agent.value.standing_grants.filter(isSafeCommandGrant) : [],
)
const richStandingGrants = computed(
  () => agent.value ? agent.value.standing_grants.filter(g => !isSafeCommandGrant(g)) : [],
)
const safeCommandByCliId = computed(() => {
  const map = /* @__PURE__ */ new Map()
  for (const g of safeCommandGrants.value) {
    const cliId = g.request?.cli_id
    if (typeof cliId === 'string') map.set(cliId, g)
  }
  return map
})
const customSafeCommands = computed(
  () => safeCommandGrants.value.filter(g => g.request?.reason === 'safe-command:custom'),
)
onMounted(async () => {
  await fetchUser()
  if (!user.value) {
    await navigateTo('/login')
    return
  }
  await Promise.all([loadAgent(), loadShapes(), loadYoloPolicy()])
})
async function loadYoloPolicy() {
  yoloLoading.value = true
  yoloError.value = ''
  try {
    const res = await $fetch(`/api/users/${encodeURIComponent(targetEmail.value)}/yolo-policy`)
    yoloPolicy.value = res?.policy ?? null
    if (yoloPolicy.value) {
      yoloForm.value = {
        denyRiskThreshold: yoloPolicy.value.denyRiskThreshold ?? 'high',
        denyPatterns: (yoloPolicy.value.denyPatterns ?? []).join('\n'),
      }
    }
  }
  catch (err) {
    yoloError.value = err?.data?.title || 'Failed to load YOLO policy'
  }
  finally {
    yoloLoading.value = false
  }
}
async function saveYoloPolicy() {
  yoloSubmitting.value = true
  yoloError.value = ''
  try {
    const patterns = yoloForm.value.denyPatterns
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean)
    const body = {
      denyRiskThreshold: yoloForm.value.denyRiskThreshold || null,
      denyPatterns: patterns,
    }
    const res = await $fetch(`/api/users/${encodeURIComponent(targetEmail.value)}/yolo-policy`, {
      method: 'PUT',
      body,
    })
    yoloPolicy.value = res?.policy ?? null
    yoloEditing.value = false
    success.value = 'YOLO-Modus gespeichert'
  }
  catch (err) {
    yoloError.value = err?.data?.title || err?.message || 'Speichern fehlgeschlagen'
  }
  finally {
    yoloSubmitting.value = false
  }
}
async function disableYoloPolicy() {
  if (!confirm('YOLO-Modus wirklich deaktivieren?')) return
  yoloSubmitting.value = true
  yoloError.value = ''
  try {
    await $fetch(`/api/users/${encodeURIComponent(targetEmail.value)}/yolo-policy`, { method: 'DELETE' })
    yoloPolicy.value = null
    yoloEditing.value = false
    yoloForm.value = { denyRiskThreshold: 'high', denyPatterns: '' }
    success.value = 'YOLO-Modus deaktiviert'
  }
  catch (err) {
    yoloError.value = err?.data?.title || 'Deaktivieren fehlgeschlagen'
  }
  finally {
    yoloSubmitting.value = false
  }
}
function startYoloEditing() {
  yoloEditing.value = true
}
async function loadAgent() {
  loading.value = true
  error.value = ''
  try {
    const all = await $fetch(`/api/users/${encodeURIComponent(user.value.email)}/agents`)
    agent.value = all.find(a => a.email === targetEmail.value) ?? null
    if (!agent.value) {
      error.value = `Agent not found: ${targetEmail.value}`
    }
  }
  catch (err) {
    error.value = err?.data?.title || 'Failed to load agent'
  }
  finally {
    loading.value = false
  }
}
async function loadShapes() {
  try {
    shapes.value = await $fetch('/api/shapes')
  }
  catch {
    shapes.value = []
  }
}
const cliOptions = computed(() => [
  { label: 'Any CLI (wildcard)', value: '' },
  ...shapes.value.map(s => ({ label: s.cli_id, value: s.cli_id })),
])
const riskOptions = [
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'Critical', value: 'critical' },
]
const grantTypeOptions = [
  { label: 'Always', value: 'always' },
  { label: 'Timed', value: 'timed' },
]
function commandCell(g) {
  const cmd = g.request?.command
  if (!cmd || cmd.length === 0) return '\u2014'
  return cmd.join(' ')
}
function statusColor(status) {
  switch (status) {
    case 'approved':
      return 'success'
    case 'pending':
      return 'warning'
    case 'denied':
    case 'revoked':
    case 'expired':
      return 'error'
    default:
      return 'neutral'
  }
}
async function handleAddSg() {
  formError.value = ''
  formSubmitting.value = true
  try {
    const resource_chain_template = parseResourceChainInput(form.value.resource_chain_text)
    const body = {
      delegate: targetEmail.value,
      audience: 'shapes',
      resource_chain_template,
      max_risk: form.value.max_risk,
      grant_type: form.value.grant_type,
      ...form.value.cli_id ? { cli_id: form.value.cli_id } : {},
      ...form.value.grant_type === 'timed' ? { duration: Number(form.value.duration) } : {},
      ...form.value.reason ? { reason: form.value.reason } : {},
    }
    await $fetch('/api/standing-grants', { method: 'POST', body })
    success.value = 'Standing grant created'
    resetForm()
    await loadAgent()
  }
  catch (err) {
    formError.value = err?.data?.title || err?.message || 'Failed to create standing grant'
  }
  finally {
    formSubmitting.value = false
  }
}
function resetForm() {
  form.value = {
    cli_id: '',
    resource_chain_text: '',
    max_risk: 'low',
    grant_type: 'always',
    duration: 3600,
    reason: '',
  }
}
function askRevoke(sg) {
  revokeTarget.value = sg
}
async function confirmRevoke() {
  if (!revokeTarget.value) return
  revoking.value = true
  try {
    await $fetch(`/api/standing-grants/${encodeURIComponent(revokeTarget.value.id)}`, { method: 'DELETE' })
    success.value = 'Standing grant revoked'
    revokeTarget.value = null
    await loadAgent()
  }
  catch (err) {
    error.value = err?.data?.title || 'Failed to revoke'
  }
  finally {
    revoking.value = false
  }
}
function cancelRevoke() {
  revokeTarget.value = null
}
async function toggleSafeCommand(cliId, action) {
  safeCommandError.value = ''
  safeCommandsBusy.value = cliId
  try {
    const existing = safeCommandByCliId.value.get(cliId)
    if (existing) {
      await $fetch(`/api/standing-grants/${encodeURIComponent(existing.id)}`, { method: 'DELETE' })
    }
    else {
      await $fetch('/api/standing-grants', {
        method: 'POST',
        body: {
          delegate: targetEmail.value,
          audience: 'shapes',
          target_host: '*',
          cli_id: cliId,
          resource_chain_template: [],
          action,
          max_risk: 'low',
          grant_type: 'always',
          reason: 'safe-command:default',
        },
      })
    }
    await loadAgent()
  }
  catch (err) {
    safeCommandError.value = err?.data?.title || `Failed to toggle ${cliId}`
  }
  finally {
    safeCommandsBusy.value = null
  }
}
async function addCustomSafeCommand() {
  const cliId = customInput.value.trim()
  if (!cliId) return
  safeCommandError.value = ''
  safeCommandsBusy.value = cliId
  try {
    await $fetch('/api/standing-grants', {
      method: 'POST',
      body: {
        delegate: targetEmail.value,
        audience: 'shapes',
        target_host: '*',
        cli_id: cliId,
        resource_chain_template: [],
        action: 'exec',
        max_risk: 'low',
        grant_type: 'always',
        reason: 'safe-command:custom',
      },
    })
    customInput.value = ''
    await loadAgent()
  }
  catch (err) {
    safeCommandError.value = err?.data?.title || `Failed to add ${cliId}`
  }
  finally {
    safeCommandsBusy.value = null
  }
}
async function removeCustomSafeCommand(grant) {
  safeCommandError.value = ''
  const cliId = grant?.request?.cli_id
  safeCommandsBusy.value = cliId || grant.id
  try {
    await $fetch(`/api/standing-grants/${encodeURIComponent(grant.id)}`, { method: 'DELETE' })
    await loadAgent()
  }
  catch (err) {
    safeCommandError.value = err?.data?.title || 'Failed to remove custom safe command'
  }
  finally {
    safeCommandsBusy.value = null
  }
}
</script>

<template>
  <div class="min-h-screen py-8 px-4">
    <div class="max-w-4xl mx-auto">
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-2xl font-bold">
            {{ agent?.display_name || targetEmail }}
          </h1>
          <p class="text-sm text-muted font-mono break-all">
            {{ targetEmail }}
          </p>
        </div>
        <UButton to="/agents" color="neutral" variant="soft" size="sm">
          ← All agents
        </UButton>
      </div>

      <div v-if="authLoading || loading" class="text-center text-muted mt-10">
        Loading…
      </div>

      <UAlert v-else-if="error" color="error" :title="error" class="mb-4" />

      <template v-else-if="agent">
        <UAlert v-if="success" color="success" :title="success" class="mb-4" @close="success = ''" />

        <!-- Safe Commands Section -->
        <UCard class="mb-6">
          <template #header>
            <h2 class="text-lg font-semibold">
              Safe commands
            </h2>
            <p class="text-sm text-muted mt-1">
              Low-risk read-only CLIs that auto-approve without a prompt.
            </p>
          </template>

          <UAlert
            v-if="safeCommandError"
            color="error"
            :title="safeCommandError"
            class="mb-3"
            @close="safeCommandError = ''"
          />

          <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            <label
              v-for="def in SAFE_COMMAND_DEFAULTS"
              :key="def.cli_id"
              class="flex items-start gap-2 p-2 rounded-md border border-(--ui-border) hover:bg-(--ui-bg-elevated)/60 cursor-pointer"
              :title="def.description"
            >
              <UCheckbox
                :model-value="safeCommandByCliId.has(def.cli_id)"
                :disabled="safeCommandsBusy === def.cli_id"
                @update:model-value="toggleSafeCommand(def.cli_id, def.action)"
              />
              <div class="text-xs">
                <div class="font-mono font-semibold">{{ def.cli_id }}</div>
                <div class="text-muted">{{ def.display }}</div>
              </div>
            </label>
          </div>

          <div class="mt-4">
            <div class="text-sm font-semibold mb-2">
              Custom safe commands
            </div>
            <div v-if="customSafeCommands.length === 0" class="text-xs text-muted mb-2">
              None yet. Add any CLI below to auto-approve low-risk invocations.
            </div>
            <div v-else class="flex flex-wrap gap-2 mb-3">
              <UBadge
                v-for="g in customSafeCommands"
                :key="g.id"
                color="neutral"
                variant="soft"
                class="font-mono text-xs"
              >
                {{ g.request?.cli_id }}
                <UButton
                  variant="link"
                  size="xs"
                  color="error"
                  icon="i-lucide-x"
                  class="!p-0 ml-1"
                  :disabled="safeCommandsBusy === (g.request?.cli_id || g.id)"
                  @click="removeCustomSafeCommand(g)"
                />
              </UBadge>
            </div>
            <div class="flex gap-2">
              <UInput
                v-model="customInput"
                placeholder="e.g. jq"
                size="sm"
                class="font-mono"
                @keydown.enter="addCustomSafeCommand"
              />
              <UButton
                size="sm"
                :disabled="!customInput.trim() || safeCommandsBusy !== null"
                icon="i-lucide-plus"
                @click="addCustomSafeCommand"
              >
                Add
              </UButton>
            </div>
          </div>
        </UCard>

        <!-- Standing Grants Section -->
        <UCard :ui="{ body: 'p-0' }" class="mb-6">
          <template #header>
            <h2 class="text-lg font-semibold">
              Standing grants
            </h2>
            <p class="text-sm text-muted mt-1">
              Pre-authorized scoped patterns (beyond the safe-command defaults).
            </p>
          </template>

          <div v-if="richStandingGrants.length === 0" class="p-6 text-center text-muted text-sm">
            No scoped standing grants yet.
          </div>
          <table v-else class="w-full">
            <thead class="border-b border-(--ui-border)">
              <tr>
                <th class="text-left px-4 py-3 text-xs font-medium text-muted uppercase">
                  Scope
                </th>
                <th class="text-left px-4 py-3 text-xs font-medium text-muted uppercase">
                  Created
                </th>
                <th class="text-right px-4 py-3 text-xs font-medium text-muted uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-(--ui-border)">
              <tr
                v-for="sg in richStandingGrants"
                :key="sg.id"
                class="odd:bg-(--ui-bg-elevated)/40 even:bg-(--ui-bg)"
              >
                <td class="px-4 py-3 text-sm font-mono">
                  {{ formatStandingGrantScope(sg) }}
                  <div v-if="sg.request?.reason" class="text-xs text-muted font-sans mt-1">
                    {{ sg.request.reason }}
                  </div>
                </td>
                <td class="px-4 py-3 text-xs text-muted">
                  {{ formatRelativeTime(sg.created_at) }}
                </td>
                <td class="px-4 py-3 text-right">
                  <UButton
                    variant="ghost"
                    size="xs"
                    color="error"
                    icon="i-lucide-trash-2"
                    @click="askRevoke(sg)"
                  >
                    Revoke
                  </UButton>
                </td>
              </tr>
            </tbody>
          </table>
        </UCard>

        <!-- YOLO-Modus Section -->
        <UCard class="mb-6" :ui="{ body: yoloPolicy ? 'p-0' : '' }">
          <template #header>
            <div class="flex items-center gap-2">
              <h2 class="text-lg font-semibold">
                YOLO-Modus
              </h2>
              <UBadge v-if="yoloPolicy" color="warning" variant="subtle" size="sm">
                aktiv
              </UBadge>
            </div>
            <p class="text-sm text-muted mt-1">
              Auto-approval für alle Grant-Requests dieses Agents — außer Deny-Pattern oder
              Risiko-Schwelle greifen. Der Agent sieht keinen Unterschied zu einer
              menschlichen Bestätigung; nur der Audit-Trail markiert diese Grants als
              <span class="font-mono">auto_approval_kind: 'yolo'</span>.
            </p>
          </template>

          <UAlert
            v-if="yoloError"
            color="error"
            :title="yoloError"
            class="mb-4"
            @close="yoloError = ''"
          />

          <div v-if="yoloLoading" class="text-sm text-muted">
            Lade…
          </div>

          <div v-else-if="!yoloPolicy && !yoloEditing">
            <p class="text-sm text-muted mb-3">
              Derzeit inaktiv. Alle Grant-Requests dieses Agents warten auf menschliche Bestätigung.
            </p>
            <UButton color="warning" icon="i-lucide-zap" @click="startYoloEditing">
              YOLO-Modus aktivieren
            </UButton>
          </div>

          <div v-else-if="yoloPolicy && !yoloEditing" class="p-4">
            <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt class="text-muted">
                Aktiviert von
              </dt>
              <dd class="font-mono">
                {{ yoloPolicy.enabledBy }}
              </dd>
              <dt class="text-muted">
                Risiko-Schwelle
              </dt>
              <dd>
                <span v-if="yoloPolicy.denyRiskThreshold" class="font-mono">
                  {{ yoloPolicy.denyRiskThreshold }}
                </span>
                <span v-else class="text-muted italic">keine</span>
                <span class="text-muted text-xs ml-2">
                  (Requests mit Risiko ≥ Schwelle fallen auf manuell zurück)
                </span>
              </dd>
              <dt class="text-muted">
                Deny-Patterns
              </dt>
              <dd>
                <span v-if="yoloPolicy.denyPatterns.length === 0" class="text-muted italic">
                  keine
                </span>
                <ul v-else class="font-mono text-xs space-y-1">
                  <li
                    v-for="p in yoloPolicy.denyPatterns"
                    :key="p"
                    class="inline-block bg-(--ui-bg-elevated) px-2 py-0.5 rounded mr-1"
                  >
                    {{ p }}
                  </li>
                </ul>
              </dd>
              <dt class="text-muted">
                Ablauf
              </dt>
              <dd>
                <span v-if="yoloExpiryInfo">{{ yoloExpiryInfo }}</span>
                <span v-else class="text-muted italic">unbefristet</span>
              </dd>
            </dl>
            <div class="flex gap-2 mt-4">
              <UButton icon="i-lucide-pencil" variant="outline" @click="startYoloEditing">
                Bearbeiten
              </UButton>
              <UButton color="error" variant="outline" icon="i-lucide-trash-2" @click="disableYoloPolicy">
                Deaktivieren
              </UButton>
            </div>
          </div>

          <div v-else class="space-y-4">
            <UFormField label="Risiko-Schwelle">
              <USelect v-model="yoloForm.denyRiskThreshold" :items="riskOptions" />
              <template #help>
                Requests mit diesem oder höherem Risiko brauchen weiter menschliche Bestätigung.
                Leer lassen, um die Schwelle zu deaktivieren.
              </template>
            </UFormField>
            <UFormField label="Deny-Patterns (eine Zeile, Glob-Syntax: * ?)">
              <UTextarea
                v-model="yoloForm.denyPatterns"
                :rows="4"
                placeholder="rm -rf *&#10;sudo *&#10;curl*| sh"
              />
            </UFormField>
            <div class="flex gap-2">
              <UButton color="warning" icon="i-lucide-save" :loading="yoloSubmitting" @click="saveYoloPolicy">
                {{ yoloPolicy ? "Speichern" : "Aktivieren" }}
              </UButton>
              <UButton variant="ghost" @click="yoloEditing = false">
                Abbrechen
              </UButton>
            </div>
          </div>
        </UCard>

        <!-- Add Standing Grant Form -->
        <UCard class="mb-6">
          <template #header>
            <h2 class="text-lg font-semibold">
              Add standing grant
            </h2>
            <p class="text-sm text-muted mt-1">
              Matching incoming agent requests will auto-approve — no prompt.
            </p>
          </template>

          <UAlert v-if="formError" color="error" :title="formError" class="mb-4" @close="formError = ''" />

          <div class="space-y-3">
            <UFormField label="CLI">
              <USelect v-model="form.cli_id" :items="cliOptions" />
            </UFormField>
            <UAlert
              v-if="form.cli_id === ''"
              color="warning"
              variant="soft"
              title="Wildcard across all CLIs"
              description="This grants the agent auto-approval for any CLI that matches the resource chain below. Use with caution."
              class="text-xs"
            />

            <UFormField label="Resource-chain template" description="One entry per line. Format: resource or resource:key=value,key2=value2. Empty = wildcard within CLI.">
              <UTextarea
                v-model="form.resource_chain_text"
                :rows="3"
                class="font-mono text-xs"
                placeholder="e.g.&#10;repo:owner=patrick&#10;or leave blank for wildcard"
              />
            </UFormField>

            <UFormField label="Max risk">
              <USelect v-model="form.max_risk" :items="riskOptions" />
            </UFormField>

            <UFormField label="Grant type">
              <USelect v-model="form.grant_type" :items="grantTypeOptions" />
            </UFormField>

            <UFormField v-if="form.grant_type === 'timed'" label="Duration (seconds)">
              <UInput v-model.number="form.duration" type="number" min="60" />
            </UFormField>

            <UFormField label="Reason (optional)">
              <UInput v-model="form.reason" placeholder="e.g. CI agent — safe commands only" />
            </UFormField>

            <div class="flex gap-2">
              <UButton
                color="primary"
                :loading="formSubmitting"
                :disabled="formSubmitting"
                icon="i-lucide-plus"
                @click="handleAddSg"
              >
                Add standing grant
              </UButton>
              <UButton variant="ghost" :disabled="formSubmitting" @click="resetForm">
                Reset
              </UButton>
            </div>
          </div>
        </UCard>

        <!-- Recent Activity -->
        <UCard :ui="{ body: 'p-0' }">
          <template #header>
            <h2 class="text-lg font-semibold">
              Recent activity
            </h2>
            <p class="text-sm text-muted mt-1">
              Last 20 grant requests from this agent.
            </p>
          </template>

          <div v-if="agent.recent_grants.length === 0" class="p-6 text-center text-muted text-sm">
            No recent activity.
          </div>
          <table v-else class="w-full">
            <thead class="border-b border-(--ui-border)">
              <tr>
                <th class="text-left px-4 py-3 text-xs font-medium text-muted uppercase">
                  Command
                </th>
                <th class="text-left px-4 py-3 text-xs font-medium text-muted uppercase">
                  Status
                </th>
                <th class="text-left px-4 py-3 text-xs font-medium text-muted uppercase">
                  When
                </th>
                <th class="text-right px-4 py-3 text-xs font-medium text-muted uppercase">
                  Auto?
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-(--ui-border)">
              <tr
                v-for="g in agent.recent_grants"
                :key="g.id"
                class="odd:bg-(--ui-bg-elevated)/40 even:bg-(--ui-bg)"
              >
                <td class="px-4 py-3 text-xs font-mono break-all">
                  {{ commandCell(g) }}
                </td>
                <td class="px-4 py-3">
                  <UBadge :color="statusColor(g.status)" variant="subtle" size="sm">
                    {{ g.status }}
                  </UBadge>
                </td>
                <td class="px-4 py-3 text-xs text-muted">
                  {{ formatRelativeTime(g.created_at) }}
                </td>
                <td class="px-4 py-3 text-right">
                  <UBadge
                    v-if="g.decided_by_safe_command"
                    color="success"
                    variant="subtle"
                    size="xs"
                    icon="i-lucide-shield-check"
                    title="Auto-approved via Safe Command"
                  >
                    Safe cmd
                  </UBadge>
                  <UIcon
                    v-else-if="g.decided_by_standing_grant"
                    name="i-lucide-zap"
                    class="text-primary inline-block"
                    :title="`Auto-approved by standing grant ${g.decided_by_standing_grant}`"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </UCard>
      </template>
    </div>

    <!-- Revoke confirmation modal -->
    <UModal v-model:open="revokeTarget" :dismissible="!revoking">
      <template #content>
        <UCard>
          <template #header>
            <h3 class="text-lg font-semibold">
              Revoke standing grant?
            </h3>
          </template>
          <p v-if="revokeTarget" class="text-sm">
            This will stop auto-approval for:
            <br>
            <code class="text-xs bg-gray-800 px-1 rounded">
              {{ formatStandingGrantScope(revokeTarget) }}
            </code>
            <br>
            Cannot be undone — you'll have to re-create it.
          </p>
          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton variant="ghost" :disabled="revoking" @click="cancelRevoke">
                Cancel
              </UButton>
              <UButton color="error" :loading="revoking" :disabled="revoking" @click="confirmRevoke">
                Revoke
              </UButton>
            </div>
          </template>
        </UCard>
      </template>
    </UModal>
  </div>
</template>
