<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { GrantType } from '@openape/core'
import type { ApprovalBody, ApprovalGrant, GrantDecisionResult } from '../utils/grant-decision'
import { grantDecisionError } from '../utils/grant-decision'
import { formatGrantDuration, grantValidity } from '../utils/grant-card'
import { getCliAuthorizationDetails, requiresSingleUse } from '../utils/cli-grants'
import { unwrapShellCommand } from '../utils/command-display'
import { buildRuleProposals, ruleTemplatePreview, suggestAllowPattern } from '../utils/rule-suggestions'
import GrantTechnicalDetails from './GrantTechnicalDetails.vue'

const props = withDefaults(defineProps<{ grant: ApprovalGrant, german: boolean, canApprove?: boolean }>(), { canApprove: true })
const emit = defineEmits<{ decided: [result: GrantDecisionResult] }>()
const grantType = ref<GrantType>('once')
const duration = ref(3600)
const scope = ref('exact')
const widening = ref<Record<number, string>>({})
const pattern = ref('')
const processing = ref(false)
const error = ref('')
const ruleCreated = ref(false)
const singleUse = computed(() => requiresSingleUse(props.grant))
const eligible = computed(() => !props.grant.brokered && !singleUse.value)
const cliDetails = computed(() => getCliAuthorizationDetails(props.grant.request.authorization_details))
const rules = computed(() => eligible.value ? buildRuleProposals(cliDetails.value) : [])
const similar = computed(() => eligible.value ? props.grant.similar_grants : undefined)
const suggestions = computed(() => eligible.value && !similar.value?.similar_grants.length ? props.grant.widening_suggestions ?? [] : [])
const suggestedPattern = computed(() => {
  const command = unwrapShellCommand(props.grant.request.command)
  return suggestAllowPattern(command?.shell ? command.text : props.grant.request.command ?? [])
})
const canRule = computed(() => eligible.value && (rules.value.length > 0 || (!!props.grant.card?.requester?.owner && suggestedPattern.value !== null)))
const canWiden = computed(() => suggestions.value.some(items => items.length > 1))
const hasSimilar = computed(() => !!similar.value?.similar_grants.length)
const broader = computed(() => canRule.value || canWiden.value || hasSimilar.value)
const durationMinutes = computed({ get: () => duration.value / 60, set: (value) => { duration.value = Math.round(Number(value) * 60) } })
const validDuration = computed(() => Number.isFinite(duration.value) && duration.value > 0)
const text = computed(() => props.german
  ? { validity: 'Gültigkeit', requested: 'So angefragt', once: 'Einmalig', timed: 'Befristet', always: 'Bis zum Widerruf', minutes: 'Dauer in Minuten', invalid: 'Bitte eine positive Dauer angeben.', broader: 'Allgemeinere Erlaubnis verfügbar', scope: 'Freigabeumfang', exact: 'Bei dieser Anfrage bleiben', suggestion: 'Einen größeren Umfang auswählen', widen: 'Vorhandene Freigaben mit Platzhaltern erweitern', merge: 'Diesen Wert zu vorhandenen Freigaben hinzufügen', rule: 'Eine Regel für künftige Anfragen erstellen', notice: 'Aufklappen ändert die Auswahl nicht. Eine allgemeinere Erlaubnis musst du ausdrücklich auswählen.', ruleNote: 'Die Regel gilt für künftige passende Anfragen bis zum Widerruf. Diese Anfrage wird einmal freigegeben.', ruleAction: 'Regel erstellen + einmal freigeben', deny: 'Ablehnen', approve: 'Freigeben', pattern: 'Befehlsmuster', patternNote: '* steht für beliebige Zeichen. Nur passende künftige Anfragen werden automatisch freigegeben.' }
  : { validity: 'Validity', requested: 'As requested', once: 'Single use', timed: 'Timed', always: 'Until revoked', minutes: 'Duration in minutes', invalid: 'Enter a positive duration.', broader: 'Broader permission available', scope: 'Approval scope', exact: 'Keep this request', suggestion: 'Choose a broader scope', widen: 'Extend existing grants with wildcards', merge: 'Add this value to existing grants', rule: 'Create a rule for future requests', notice: 'Expanding does not change the selection. You must explicitly choose a broader permission.', ruleNote: 'The rule covers future matching requests until revoked. This request is approved once.', ruleAction: 'Create rule + approve once', deny: 'Deny', approve: 'Approve', pattern: 'Command pattern', patternNote: '* matches any characters. Only matching future requests auto-approve.' })
const typeItems = computed(() => [
  { label: text.value.once, value: 'once' },
  ...singleUse.value ? [] : [{ label: text.value.timed, value: 'timed' }, { label: text.value.always, value: 'always' }],
])
const scopeItems = computed(() => [
  { value: 'exact', label: text.value.exact },
  ...canWiden.value ? [{ value: 'suggestion', label: text.value.suggestion }] : [],
  ...hasSimilar.value ? [{ value: 'widen', label: text.value.widen }, { value: 'merge', label: text.value.merge }] : [],
  ...canRule.value ? [{ value: 'rule', label: text.value.rule }] : [],
])

watch(() => props.grant.id, () => {
  grantType.value = singleUse.value ? 'once' : props.grant.request.grant_type ?? 'once'
  duration.value = props.grant.request.duration ?? 3600
  scope.value = 'exact'
  widening.value = {}
  pattern.value = suggestedPattern.value ?? ''
  error.value = ''
  ruleCreated.value = false
}, { immediate: true })

function approvalBody(): ApprovalBody {
  const body: ApprovalBody = { grant_type: singleUse.value ? 'once' : grantType.value }
  const existing = similar.value
  if (body.grant_type === 'timed') body.duration = duration.value
  if (eligible.value && existing?.similar_grants.length && (scope.value === 'widen' || scope.value === 'merge')) {
    body.extend_mode = scope.value
    body.extend_grant_ids = existing.similar_grants.map(item => item.grant.id)
  }
  else if (eligible.value && scope.value === 'suggestion') {
    const chosen = suggestions.value.map((items, index) => items[Number(widening.value[index] ?? '0')]?.detail ?? cliDetails.value[index]).filter((detail): detail is NonNullable<typeof detail> => !!detail)
    if (chosen.some((detail, index) => detail.permission !== cliDetails.value[index]?.permission)) body.widened_details = chosen
  }
  return body
}

async function createRule() {
  if (rules.value.length) {
    for (const proposal of rules.value) {
      await $fetch('/api/standing-grants', {
        method: 'POST',
        body: { delegate: props.grant.request.requester, audience: props.grant.request.audience, target_host: props.grant.request.target_host, cli_id: proposal.cliId, resource_chain_template: proposal.template, max_risk: proposal.maxRisk, grant_type: 'always', reason: `Rule created from grant ${props.grant.id}` },
      })
    }
    return
  }
  const base = `/api/users/${encodeURIComponent(props.grant.request.requester)}/yolo-policy?audience=${encodeURIComponent(props.grant.request.audience)}`
  const existing = await $fetch<{ policy?: { mode?: string, denyRiskThreshold?: string | null, denyPatterns?: string[], allowPatterns?: string[], expiresAt?: number | null } }>(base)
  const policy = existing?.policy
  const patterns = policy?.allowPatterns ?? []
  if (!patterns.includes(pattern.value.trim())) await $fetch(base, { method: 'PUT', body: { mode: policy?.mode ?? 'allow-list', denyRiskThreshold: policy?.denyRiskThreshold ?? null, denyPatterns: policy?.denyPatterns ?? [], allowPatterns: [...patterns, pattern.value.trim()], expiresAt: policy?.expiresAt ?? null } })
}

async function approve() {
  if (processing.value || ruleCreated.value || (!props.canApprove && !(scope.value === 'rule' && canRule.value)) || (grantType.value === 'timed' && !validDuration.value)) return
  processing.value = true
  error.value = ''
  try {
    const body = approvalBody()
    if (scope.value === 'rule' && canRule.value) {
      if (!rules.value.length && !pattern.value.trim()) throw new Error(props.german ? 'Bitte ein Befehlsmuster angeben.' : 'Enter a command pattern.')
      await createRule()
      if (!props.canApprove) { ruleCreated.value = true; return }
      body.grant_type = 'once'
      delete body.duration
    }
    const result = await $fetch<GrantDecisionResult>(`/api/grants/${props.grant.id}/approve`, { method: 'POST', body })
    emit('decided', result)
  }
  catch (failure) { error.value = grantDecisionError(failure) }
  finally { processing.value = false }
}

async function deny() {
  if (processing.value) return
  processing.value = true
  error.value = ''
  try {
    await $fetch(`/api/grants/${props.grant.id}/deny`, { method: 'POST' })
    emit('decided', { grant: { ...props.grant, status: 'denied' } })
  }
  catch (failure) { error.value = grantDecisionError(failure) }
  finally { processing.value = false }
}
</script>

<template>
  <div class="min-w-0 space-y-4" data-grant-decision>
    <section class="rounded-lg border border-default bg-elevated/40 p-3.5" data-validity-control>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <label :for="`validity-${grant.id}`" class="text-sm font-medium">{{ text.validity }}</label>
        <USelect :id="`validity-${grant.id}`" v-model="grantType" :items="typeItems" class="w-full sm:w-48" />
      </div>
      <p class="mt-2 text-xs text-muted">
        {{ text.requested }}: {{ grantValidity(grant, german ? 'de' : 'en') }}
      </p>
      <div v-if="grantType === 'timed'" class="mt-3 space-y-1.5">
        <label :for="`duration-${grant.id}`" class="block text-xs text-muted">{{ text.minutes }}</label>
        <UInput :id="`duration-${grant.id}`" v-model="durationMinutes" type="number" :min="1 / 60" step="any" class="w-full" :aria-invalid="!validDuration" />
        <p class="text-xs" :class="validDuration ? 'text-muted' : 'text-error'">
          {{ validDuration ? formatGrantDuration(duration) : text.invalid }}
        </p>
      </div>
    </section>
    <details v-if="broader" class="rounded-lg border border-default p-3" data-broader-permission>
      <summary class="cursor-pointer text-sm">
        {{ text.broader }}
      </summary>
      <fieldset class="mt-3 min-w-0 space-y-3">
        <legend class="sr-only">
          {{ text.scope }}
        </legend>
        <p class="text-xs text-muted">
          {{ text.notice }}
        </p>
        <label v-for="item in scopeItems" :key="item.value" class="flex cursor-pointer items-start gap-2 rounded border border-default p-2 text-sm">
          <input v-model="scope" :name="`scope-${grant.id}`" :value="item.value" type="radio" class="mt-0.5 shrink-0 accent-primary"><span>{{ item.label }}</span>
        </label>
        <div v-if="scope === 'suggestion'" class="space-y-3">
          <URadioGroup v-for="(items, index) in suggestions" :key="index" v-model="widening[index]" default-value="0" :items="items.map((item, at) => ({ value: String(at), label: item.label, description: item.permission }))" :ui="{ description: 'font-mono text-xs break-all' }" />
        </div>
        <div v-if="(scope === 'widen' || scope === 'merge') && similar" class="space-y-2 text-xs" data-scope-preview>
          <p v-for="detail in scope === 'widen' ? similar.widened_details : similar.merged_details" :key="detail.permission" class="font-mono break-all">
            {{ detail.permission }}
          </p>
        </div>
        <div v-if="scope === 'rule'" class="space-y-2 text-xs" data-rule-preview>
          <p>{{ canApprove ? text.ruleNote : (german ? 'Der Aufrufer wartet nicht mehr. Die Regel gilt nur für künftige passende Anfragen.' : 'The requester has stopped waiting. The rule applies only to future matching requests.') }}</p>
          <p v-for="proposal in rules" :key="proposal.cliId" class="font-mono break-all">
            {{ ruleTemplatePreview(proposal) }}
          </p>
          <template v-if="!rules.length">
            <label :for="`pattern-${grant.id}`">{{ text.pattern }}</label><UInput :id="`pattern-${grant.id}`" v-model="pattern" class="w-full font-mono" /><p class="text-muted">
              {{ text.patternNote }}
            </p>
          </template>
        </div>
      </fieldset>
    </details>
    <p v-if="scope !== 'exact'" class="text-xs font-medium" data-selected-scope>
      {{ german ? 'Gewählter Umfang' : 'Selected scope' }}: {{ scopeItems.find(item => item.value === scope)?.label }}
      <span v-if="scope === 'rule'" class="mt-1 block text-muted">{{ canApprove ? text.ruleNote : (german ? 'Nur für künftige Anfragen.' : 'Future requests only.') }}</span>
    </p>
    <GrantTechnicalDetails :grant="grant" :german="german" />
    <UAlert v-if="error" color="error" :title="error" />
    <UAlert v-if="ruleCreated" color="success" :title="german ? 'Regel für künftige Anfragen gespeichert' : 'Rule saved for future requests'" :description="german ? 'Dieser Aufruf wurde nicht freigegeben. Der Antragsteller wartet nicht mehr.' : 'This invocation was not approved. The requester has stopped waiting.'" />
    <div class="grid grid-cols-2 gap-3">
      <UButton color="neutral" variant="outline" class="justify-center" :loading="processing" @click="deny">
        {{ text.deny }}
      </UButton>
      <UButton v-if="canApprove || (scope === 'rule' && canRule)" color="primary" class="justify-center" :loading="processing" :disabled="ruleCreated || (grantType === 'timed' && !validDuration)" @click="approve">
        {{ scope === 'rule' ? (canApprove ? text.ruleAction : (german ? 'Regel erstellen' : 'Create rule')) : text.approve }}
      </UButton>
    </div>
  </div>
</template>
