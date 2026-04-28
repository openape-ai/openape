<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { BucketDisplay, HttpMethodChoice } from '../utils/audience-buckets'
import { HTTP_METHODS, parsePattern, serializePattern } from '../utils/audience-buckets'

type YoloMode = 'deny-list' | 'allow-list'

interface YoloPolicy {
  agentEmail: string
  audience: string
  mode: YoloMode
  enabledBy: string
  denyRiskThreshold: 'low' | 'medium' | 'high' | 'critical' | null
  denyPatterns: string[]
  enabledAt: number
  expiresAt: number | null
  updatedAt: number
}

const props = defineProps<{
  agentEmail: string
  bucket: BucketDisplay
}>()

interface PatternRow { method: HttpMethodChoice, value: string }

interface FormState {
  /**
   * YOLO toggle: true = mode='deny-list' (default allow, list filters out),
   * false = mode='allow-list' (default deny, list lets through). The conceptual
   * mapping matches the OpenApe YOLO semantic: YOLO ON = lazy auto-approve.
   */
  yoloOn: boolean
  denyRiskThreshold: 'low' | 'medium' | 'high' | 'critical' | ''
  patterns: PatternRow[]
  duration: string
}

/** Map between the binary toggle and the wire-format `mode` enum. */
function modeFromToggle(yoloOn: boolean): YoloMode {
  return yoloOn ? 'deny-list' : 'allow-list'
}

const policiesByAudience = ref<Record<string, YoloPolicy | null>>({})
const loading = ref(false)
const submitting = ref(false)
const error = ref('')

const aggregate = computed<'all' | 'partial' | 'none'>(() => {
  const present = props.bucket.audiences.filter(a => policiesByAudience.value[a] != null).length
  if (present === 0) return 'none'
  if (present === props.bucket.audiences.length) return 'all'
  return 'partial'
})

const representativePolicy = computed<YoloPolicy | null>(() => {
  for (const aud of props.bucket.audiences) {
    const p = policiesByAudience.value[aud]
    if (p) return p
  }
  return null
})

const expiryLabel = computed(() => {
  const ts = representativePolicy.value?.expiresAt
  if (!ts) return ''
  return new Date(ts * 1000).toLocaleString()
})

const form = ref<FormState>(emptyForm())

function emptyForm(): FormState {
  return {
    // No row in DB yet → default OFF (= allow-list with 0 patterns =
    // every request needs human approval). This is the safer default.
    yoloOn: false,
    denyRiskThreshold: '',
    patterns: [],
    duration: '',
  }
}

const riskOptions = [
  { label: 'Kein Schwellwert', value: '' },
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High (empfohlen)', value: 'high' },
  { label: 'Critical', value: 'critical' },
]
const durationOptions = [
  { label: 'Unbefristet', value: '' },
  { label: '1 Stunde', value: '3600' },
  { label: '4 Stunden', value: '14400' },
  { label: '8 Stunden', value: '28800' },
  { label: '1 Tag', value: '86400' },
  { label: '7 Tage', value: '604800' },
  { label: '30 Tage', value: '2592000' },
]
const methodOptions = HTTP_METHODS.map(m => ({ label: m === '*' ? 'ALL' : m, value: m }))

const accentClass = computed(() => {
  switch (props.bucket.accent) {
    case 'blue': return 'border-blue-700/40 bg-blue-950/20'
    case 'orange': return 'border-orange-700/40 bg-orange-950/20'
    case 'purple': return 'border-purple-700/40 bg-purple-950/20'
    default: return 'border-gray-700 bg-gray-900/40'
  }
})

const showRiskThreshold = computed(() => form.value.yoloOn && props.bucket.id !== 'web')

// List header changes meaning with the YOLO toggle. Both wordings honest:
//  - YOLO ON  → list contents are denied (everything else auto-approved)
//  - YOLO OFF → list contents are allowed (everything else needs human)
const listLabel = computed(() => form.value.yoloOn ? 'Deny-Patterns (Ausnahmen vom Auto-Approve)' : 'Allow-Patterns (was auto-approved werden darf)')
const listEmptyHint = computed(() => form.value.yoloOn
  ? 'Keine Deny-Patterns. YOLO approved JEDEN Request automatisch.'
  : 'Keine Allow-Patterns. Jeder Request wartet auf manuelle Bestätigung.',
)

// --- Data flow --------------------------------------------------------------

async function load() {
  loading.value = true
  error.value = ''
  try {
    const fetched: Record<string, YoloPolicy | null> = {}
    await Promise.all(props.bucket.audiences.map(async (aud) => {
      try {
        const url = `/api/users/${encodeURIComponent(props.agentEmail)}/yolo-policy?audience=${encodeURIComponent(aud)}`
        const res = await ($fetch as any)(url) as { policy: YoloPolicy | null }
        fetched[aud] = res?.policy && res.policy.audience === aud ? res.policy : null
      }
      catch {
        fetched[aud] = null
      }
    }))
    policiesByAudience.value = fetched

    const rep = representativePolicy.value
    if (rep) {
      form.value = {
        yoloOn: rep.mode !== 'allow-list',
        denyRiskThreshold: (rep.denyRiskThreshold ?? '') as FormState['denyRiskThreshold'],
        patterns: (rep.denyPatterns ?? []).map(p => parsePattern(p, props.bucket.patternShape)),
        duration: rep.expiresAt ? '' : '',
      }
    }
    else {
      form.value = emptyForm()
    }
  }
  catch (err: unknown) {
    const e = err as { data?: { title?: string } }
    error.value = e.data?.title ?? 'YOLO-Policies konnten nicht geladen werden'
  }
  finally {
    loading.value = false
  }
}

function addPatternRow() {
  form.value.patterns.push({ method: '*', value: '' })
}

function removePatternRow(i: number) {
  form.value.patterns.splice(i, 1)
}

async function save() {
  submitting.value = true
  error.value = ''
  try {
    const patterns = form.value.patterns
      .map(r => serializePattern(r.method, r.value, props.bucket.patternShape))
      .filter(Boolean)
    const durationSec = Number(form.value.duration)
    const expiresAt = Number.isFinite(durationSec) && durationSec > 0
      ? Math.floor(Date.now() / 1000) + durationSec
      : null
    const body = {
      mode: modeFromToggle(form.value.yoloOn),
      denyRiskThreshold: showRiskThreshold.value ? (form.value.denyRiskThreshold || null) : null,
      denyPatterns: patterns,
      expiresAt,
    }
    await Promise.all(props.bucket.audiences.map(aud =>
      ($fetch as any)(
        `/api/users/${encodeURIComponent(props.agentEmail)}/yolo-policy?audience=${encodeURIComponent(aud)}`,
        { method: 'PUT', body },
      ),
    ))
    await load()
  }
  catch (err: unknown) {
    const e = err as { data?: { title?: string }, message?: string }
    error.value = e.data?.title ?? e.message ?? 'Speichern fehlgeschlagen'
  }
  finally {
    submitting.value = false
  }
}

async function reset() {
  if (!confirm(`Policy für ${props.bucket.label} wirklich löschen? Default-Verhalten (jeder Request manuell) wird wiederhergestellt.`)) return
  submitting.value = true
  error.value = ''
  try {
    await Promise.all(props.bucket.audiences.map(aud =>
      ($fetch as any)(
        `/api/users/${encodeURIComponent(props.agentEmail)}/yolo-policy?audience=${encodeURIComponent(aud)}`,
        { method: 'DELETE' },
      ),
    ))
    policiesByAudience.value = {}
    form.value = emptyForm()
  }
  catch (err: unknown) {
    const e = err as { data?: { title?: string } }
    error.value = e.data?.title ?? 'Zurücksetzen fehlgeschlagen'
  }
  finally {
    submitting.value = false
  }
}

watch(() => props.agentEmail, () => { if (props.agentEmail) load() }, { immediate: true })
</script>

<template>
  <div class="border rounded-lg p-4 space-y-3" :class="[accentClass]">
    <div class="flex items-start justify-between gap-2">
      <div class="flex items-start gap-3">
        <UIcon :name="bucket.icon" class="w-5 h-5 mt-0.5 text-gray-300" />
        <div>
          <h3 class="text-base font-semibold flex items-center gap-2">
            {{ bucket.label }}
          </h3>
          <p class="text-xs text-gray-400 mt-1">
            {{ bucket.description }}
          </p>
          <p class="text-xs text-gray-500 mt-1 font-mono">
            audiences: {{ bucket.audiences.join(', ') }}
          </p>
        </div>
      </div>
    </div>

    <UAlert
      v-if="bucket.notice"
      color="info"
      variant="subtle"
      :title="bucket.notice"
      icon="i-lucide-info"
    />

    <UAlert v-if="error" color="error" :title="error" @close="error = ''" />

    <div v-if="loading" class="text-xs text-gray-400">
      Lade…
    </div>

    <template v-else>
      <!-- YOLO toggle: ON = default allow / list = deny-exceptions.
           OFF = default deny / list = allow-exceptions. -->
      <div class="flex items-center justify-between gap-3 p-3 rounded-md bg-gray-900/60 border border-gray-700/60">
        <div>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-zap" class="w-4 h-4" :class="form.yoloOn ? 'text-amber-400' : 'text-gray-500'" />
            <span class="text-sm font-semibold">YOLO-Modus</span>
            <UBadge v-if="form.yoloOn" color="warning" variant="subtle" size="sm">
              an — default allow
            </UBadge>
            <UBadge v-else color="neutral" variant="subtle" size="sm">
              aus — default deny
            </UBadge>
            <UBadge v-if="aggregate === 'partial'" color="warning" variant="outline" size="sm">
              teilweise
            </UBadge>
          </div>
          <p class="text-xs text-gray-400 mt-1">
            <span v-if="form.yoloOn">Jeder Request auto-approved — die Liste unten ist eine <strong>Deny</strong>-Liste (Ausnahmen).</span>
            <span v-else>Jeder Request wartet auf manuelle Bestätigung — die Liste unten ist eine <strong>Allow</strong>-Liste (Ausnahmen die ohne Bestätigung durchgehen).</span>
          </p>
        </div>
        <USwitch v-model="form.yoloOn" />
      </div>

      <!-- Always-visible pattern list; label flips with the toggle. -->
      <div>
        <div class="flex items-center justify-between mb-1">
          <label class="text-sm font-medium text-gray-300">{{ listLabel }}</label>
          <UButton size="xs" variant="ghost" icon="i-lucide-plus" @click="addPatternRow">
            Hinzufügen
          </UButton>
        </div>
        <p class="text-xs text-gray-500 mb-2">
          {{ bucket.patternHelp }}
        </p>
        <div v-if="form.patterns.length === 0" class="text-xs italic text-gray-500 py-2">
          {{ listEmptyHint }}
        </div>
        <div v-else class="space-y-2">
          <div
            v-for="(row, i) in form.patterns"
            :key="i"
            class="flex items-center gap-2"
          >
            <USelect
              v-if="bucket.patternShape === 'method-url'"
              v-model="row.method"
              :items="methodOptions"
              class="w-28 shrink-0"
            />
            <UInput
              v-model="row.value"
              :placeholder="bucket.patternPlaceholder"
              class="flex-1"
              :class="{ 'font-mono text-xs': bucket.patternShape === 'method-url' }"
            />
            <UButton
              size="xs"
              color="error"
              variant="ghost"
              icon="i-lucide-trash-2"
              @click="removePatternRow(i)"
            />
          </div>
        </div>
      </div>

      <!-- YOLO-Timer + Risiko-Schwelle (deny-mode + non-web only). -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <UFormField label="YOLO-Timer" help="Nach Ablauf wird die Policy gelöscht (zurück zu default deny).">
          <USelect v-model="form.duration" :items="durationOptions" />
        </UFormField>
        <UFormField
          v-if="showRiskThreshold"
          label="Risiko-Schwelle"
          help="Requests mit diesem Risiko oder höher fallen trotz YOLO zurück auf manuelle Bestätigung."
        >
          <USelect v-model="form.denyRiskThreshold" :items="riskOptions" />
        </UFormField>
      </div>

      <!-- Action row. -->
      <div class="flex items-center justify-between gap-2 pt-1">
        <span v-if="expiryLabel" class="text-xs text-gray-500">
          Aktuell aktiv bis: <span class="font-mono">{{ expiryLabel }}</span>
        </span>
        <span v-else />
        <div class="flex gap-2">
          <UButton
            v-if="aggregate !== 'none'"
            size="sm"
            color="error"
            variant="outline"
            icon="i-lucide-rotate-ccw"
            :loading="submitting"
            @click="reset"
          >
            Zurücksetzen
          </UButton>
          <UButton
            color="warning"
            size="sm"
            icon="i-lucide-save"
            :loading="submitting"
            @click="save"
          >
            Speichern
          </UButton>
        </div>
      </div>
    </template>
  </div>
</template>
