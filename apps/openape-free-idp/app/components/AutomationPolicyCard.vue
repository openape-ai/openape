<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { BucketDisplay, HttpMethodChoice } from '../utils/audience-buckets'
import { HTTP_METHODS, parsePattern, serializePattern } from '../utils/audience-buckets'
import { formatProvenance, fullAutoFromMode, isIneffectiveFullAuto, modeFromFullAuto } from '../utils/automation-policy'

interface YoloPolicy {
  agentEmail: string
  audience: string
  mode: 'deny-list' | 'allow-list'
  enabledBy: string
  denyRiskThreshold: 'low' | 'medium' | 'high' | 'critical' | null
  denyPatterns: string[]
  allowPatterns: string[]
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
  /** Vollautomatik: default allow, Blockliste als Veto (wire: mode='deny-list'). */
  fullAuto: boolean
  denyRiskThreshold: 'low' | 'medium' | 'high' | 'critical' | ''
  /** „Immer blockiert" — the veto list, active in BOTH modes (wire: denyPatterns). */
  blockPatterns: PatternRow[]
  /** „Ohne Rückfrage erlaubt" — active only while Vollautomatik is off (wire: allowPatterns). */
  allowPatterns: PatternRow[]
  duration: string
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

const provenanceLine = computed(() => {
  const p = representativePolicy.value
  if (!p) return ''
  return formatProvenance(p.enabledBy, p.updatedAt)
})

const form = ref<FormState>(emptyForm())

function emptyForm(): FormState {
  return {
    // No row in DB yet → everything asks for approval. The safer default.
    fullAuto: false,
    denyRiskThreshold: '',
    blockPatterns: [],
    allowPatterns: [],
    duration: '',
  }
}

// A Vollautomatik without a single block rule or risk threshold is a server-
// side no-op (fail-closed) — the switch would silently do nothing.
const ineffectiveFullAuto = computed(() =>
  isIneffectiveFullAuto(form.value.fullAuto, form.value.blockPatterns.length, form.value.denyRiskThreshold || null),
)

const riskOptions = [
  { label: 'Keine', value: '' },
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

// Risk threshold has the same semantic in both modes. Hidden only for the
// Netzwerk group because ape-proxy grants carry no shape-resolved risk score.
const showRiskThreshold = computed(() => props.bucket.id !== 'web')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const fetched: Record<string, YoloPolicy | null> = {}
    await Promise.all(props.bucket.audiences.map(async (aud) => {
      try {
        const url = `/api/users/${encodeURIComponent(props.agentEmail)}/yolo-policy?audience=${encodeURIComponent(aud)}`
        const res = await apiFetch(url) as { policy: YoloPolicy | null }
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
        fullAuto: fullAutoFromMode(rep.mode),
        denyRiskThreshold: (rep.denyRiskThreshold ?? '') as FormState['denyRiskThreshold'],
        blockPatterns: (rep.denyPatterns ?? []).map(p => parsePattern(p, props.bucket.patternShape)),
        allowPatterns: (rep.allowPatterns ?? []).map(p => parsePattern(p, props.bucket.patternShape)),
        duration: '',
      }
    }
    else {
      form.value = emptyForm()
    }
  }
  catch (err: unknown) {
    const e = err as { data?: { title?: string } }
    error.value = e.data?.title ?? 'Regeln konnten nicht geladen werden'
  }
  finally {
    loading.value = false
  }
}

function addRow(list: 'blockPatterns' | 'allowPatterns') {
  form.value[list] = [...form.value[list], { method: '*', value: '' }]
}

function removeRow(list: 'blockPatterns' | 'allowPatterns', i: number) {
  const next = form.value[list].slice()
  next.splice(i, 1)
  form.value[list] = next
}

function serializeRows(rows: PatternRow[]): string[] {
  return rows
    .map(r => serializePattern(r.method, r.value, props.bucket.patternShape))
    .filter(Boolean)
}

async function save() {
  submitting.value = true
  error.value = ''
  try {
    const durationSec = Number(form.value.duration)
    const expiresAt = Number.isFinite(durationSec) && durationSec > 0
      ? Math.floor(Date.now() / 1000) + durationSec
      : null
    // Both lists go to the server on every save — what the owner sees is
    // what is stored, in both modes.
    const body = {
      mode: modeFromFullAuto(form.value.fullAuto),
      denyRiskThreshold: showRiskThreshold.value ? (form.value.denyRiskThreshold || null) : null,
      denyPatterns: serializeRows(form.value.blockPatterns),
      allowPatterns: serializeRows(form.value.allowPatterns),
      expiresAt,
    }
    await Promise.all(props.bucket.audiences.map(aud =>
      apiFetch(
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
  if (!confirm(`Regeln für ${props.bucket.label} wirklich löschen? Danach braucht wieder jede Aktion deine Freigabe.`)) return
  submitting.value = true
  error.value = ''
  try {
    await Promise.all(props.bucket.audiences.map(aud =>
      apiFetch(
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
  <div
    class="border rounded-lg p-4 space-y-3"
    :class="form.fullAuto ? 'border-amber-600/60 bg-amber-950/15' : 'border-gray-700 bg-gray-900/40'"
  >
    <div class="flex items-start justify-between gap-2">
      <div class="flex items-start gap-3">
        <UIcon :name="bucket.icon" class="w-5 h-5 mt-0.5 text-gray-300" />
        <div>
          <h3 class="text-base font-semibold flex items-center gap-2">
            {{ bucket.label }}
            <UBadge v-if="aggregate === 'partial'" color="warning" variant="outline" size="sm">
              teilweise gesetzt
            </UBadge>
          </h3>
          <p class="text-xs text-gray-400 mt-1">
            {{ bucket.description }}
          </p>
        </div>
      </div>
    </div>

    <UAlert v-if="error" color="error" :title="error" @close="error = ''" />

    <div v-if="loading" class="text-xs text-gray-400">
      Lade…
    </div>

    <template v-else>
      <!-- Vollautomatik: default allow, Blockliste als Veto. Deliberately the
           loudest element on the card — this is the dangerous switch. -->
      <div
        class="flex items-center justify-between gap-3 p-3 rounded-md border"
        :class="form.fullAuto ? 'bg-amber-950/40 border-amber-600/60' : 'bg-gray-900/60 border-gray-700/60'"
      >
        <div>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-zap" class="w-4 h-4" :class="form.fullAuto ? 'text-amber-400' : 'text-gray-500'" />
            <span class="text-sm font-semibold">Vollautomatik</span>
            <UBadge v-if="form.fullAuto" color="warning" variant="subtle" size="sm">
              an
            </UBadge>
          </div>
          <p class="text-xs mt-1" :class="form.fullAuto ? 'text-amber-200/80' : 'text-gray-400'">
            <span v-if="form.fullAuto">Alles wird automatisch erlaubt — außer es steht in „Immer blockiert".</span>
            <span v-else>Aus — jede Aktion braucht deine Freigabe, außer sie steht in „Ohne Rückfrage erlaubt".</span>
          </p>
        </div>
        <USwitch v-model="form.fullAuto" />
      </div>

      <UAlert
        v-if="ineffectiveFullAuto"
        color="warning"
        variant="subtle"
        icon="i-lucide-alert-triangle"
        title="Wirkungslos ohne Einschränkung"
        description="Vollautomatik braucht mindestens eine Blocklisten-Regel oder eine Risiko-Schwelle — sonst ignoriert der IdP die Policy und jede Anfrage wartet weiter auf dich."
      />

      <!-- „Immer blockiert" — the veto list, active in BOTH modes. -->
      <div>
        <div class="flex items-center justify-between mb-1">
          <label class="text-sm font-medium text-gray-300 flex items-center gap-1.5">
            <UIcon name="i-lucide-ban" class="w-3.5 h-3.5 text-red-400" />
            Immer blockiert
          </label>
          <UButton size="xs" variant="ghost" icon="i-lucide-plus" @click="addRow('blockPatterns')">
            Regel
          </UButton>
        </div>
        <p class="text-xs text-gray-500 mb-2">
          Veto-Liste: gilt immer, auch bei Vollautomatik. {{ bucket.patternHelp }}
        </p>
        <div v-if="form.blockPatterns.length === 0" class="text-xs italic text-gray-500 py-1">
          Keine Blockregeln.
        </div>
        <div v-else class="space-y-2">
          <div v-for="(row, i) in form.blockPatterns" :key="i" class="flex items-center gap-2">
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
            <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="removeRow('blockPatterns', i)" />
          </div>
        </div>
      </div>

      <!-- „Ohne Rückfrage erlaubt" — active only while Vollautomatik is off. -->
      <div :class="{ 'opacity-60': form.fullAuto }">
        <div class="flex items-center justify-between mb-1">
          <label class="text-sm font-medium text-gray-300 flex items-center gap-1.5">
            <UIcon name="i-lucide-check-circle-2" class="w-3.5 h-3.5 text-green-400" />
            Ohne Rückfrage erlaubt
          </label>
          <UButton size="xs" variant="ghost" icon="i-lucide-plus" @click="addRow('allowPatterns')">
            Pattern
          </UButton>
        </div>
        <p v-if="form.fullAuto" class="text-xs text-amber-200/70 mb-2">
          Inaktiv, solange Vollautomatik an ist — dann ist ohnehin alles erlaubt, was nicht blockiert ist. Die Liste bleibt gespeichert.
        </p>
        <p v-else class="text-xs text-gray-500 mb-2">
          {{ bucket.patternHelp }}
        </p>
        <div v-if="form.allowPatterns.length === 0" class="text-xs italic text-gray-500 py-1">
          Keine Patterns — jede Anfrage wartet auf dich.
        </div>
        <div v-else class="space-y-2">
          <div v-for="(row, i) in form.allowPatterns" :key="i" class="flex items-center gap-2">
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
            <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="removeRow('allowPatterns', i)" />
          </div>
        </div>
        <!-- Scoped standing grants render here so the owner sees ONE
             "ohne Rückfrage"-Liste, fed by two mechanisms. -->
        <slot name="allow-extra" />
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <UFormField
          v-if="showRiskThreshold"
          label="Risiko-Schwelle"
          help="Anfragen bis zu dieser Risiko-Stufe werden automatisch erlaubt — darüber wartet die Anfrage auf dich. Gilt zusätzlich zu den Listen."
        >
          <USelect v-model="form.denyRiskThreshold" :items="riskOptions" />
        </UFormField>
        <UFormField label="Automatisch beenden" help="Nach Ablauf werden die Regeln gelöscht — danach fragt wieder alles nach.">
          <USelect v-model="form.duration" :items="durationOptions" />
        </UFormField>
      </div>

      <p v-if="provenanceLine" class="text-xs text-gray-500 border-t border-gray-800 pt-2">
        {{ provenanceLine }} — automatische Syncs (z. B. aus troop-Rollen) überschreiben Handänderungen beim nächsten Lauf.
      </p>

      <div class="flex items-center justify-between gap-2 pt-1">
        <span v-if="expiryLabel" class="text-xs text-gray-500">
          Aktiv bis: <span class="font-mono">{{ expiryLabel }}</span>
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
            :color="form.fullAuto ? 'warning' : 'primary'"
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
