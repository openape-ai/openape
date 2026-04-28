<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { BucketDisplay } from '../utils/audience-buckets'

interface YoloPolicy {
  agentEmail: string
  audience: string
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

/**
 * Per-bucket YOLO state. We hold one YoloPolicy per audience in the bucket
 * (could be 1..N rows). Aggregate state:
 *
 *   - 'all'    — every audience in the bucket has a YOLO row → bucket is fully on
 *   - 'partial'— some audiences have YOLO, some don't → mixed state
 *   - 'none'   — no audience in the bucket has YOLO
 *
 * For multi-audience buckets (Commands has 3) "Enable" writes one row per
 * audience and "Disable" deletes them all. Single-audience buckets are 1:1.
 */
const policiesByAudience = ref<Record<string, YoloPolicy | null>>({})
const loading = ref(false)
const submitting = ref(false)
const editing = ref(false)
const error = ref('')

const aggregate = computed<'all' | 'partial' | 'none'>(() => {
  const present = props.bucket.audiences.filter(a => policiesByAudience.value[a] != null).length
  if (present === 0) return 'none'
  if (present === props.bucket.audiences.length) return 'all'
  return 'partial'
})

const representativePolicy = computed<YoloPolicy | null>(() => {
  // For display purposes, surface the first existing policy in the bucket.
  // When the bucket is partially active or inactive across audiences, we
  // still need *some* policy fields to render the form — fall back to the
  // last-known.
  for (const aud of props.bucket.audiences) {
    const p = policiesByAudience.value[aud]
    if (p) return p
  }
  return null
})

const expiryLabel = computed(() => {
  const ts = representativePolicy.value?.expiresAt
  if (!ts) return 'unbefristet'
  return new Date(ts * 1000).toLocaleString()
})

// --- Form state -------------------------------------------------------------

interface FormState {
  denyRiskThreshold: 'low' | 'medium' | 'high' | 'critical' | ''
  denyPatterns: string
  duration: string
}

const form = ref<FormState>({
  denyRiskThreshold: 'high',
  denyPatterns: '',
  duration: '3600',
})

const riskOptions = [
  { label: 'Kein Schwellwert', value: '' },
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High (empfohlen)', value: 'high' },
  { label: 'Critical', value: 'critical' },
]
const durationOptions = [
  { label: '1 Stunde (Standard)', value: '3600' },
  { label: '4 Stunden', value: '14400' },
  { label: '8 Stunden', value: '28800' },
  { label: '1 Tag', value: '86400' },
  { label: '7 Tage', value: '604800' },
  { label: '30 Tage', value: '2592000' },
  { label: 'Unbefristet', value: '' },
]

const accentClass = computed(() => {
  switch (props.bucket.accent) {
    case 'blue': return 'border-blue-700/40 bg-blue-950/20'
    case 'orange': return 'border-orange-700/40 bg-orange-950/20'
    case 'purple': return 'border-purple-700/40 bg-purple-950/20'
    default: return 'border-gray-700 bg-gray-900/40'
  }
})

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
        // The GET endpoint falls back to wildcard ('*') when there's no
        // exact row; we want exact-match here so the "this audience has its
        // own row" signal isn't muddled by the bucket-default. Only count it
        // if the returned policy.audience matches what we asked for.
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
        denyRiskThreshold: (rep.denyRiskThreshold ?? 'high') as FormState['denyRiskThreshold'],
        denyPatterns: rep.denyPatterns.join('\n'),
        duration: rep.expiresAt ? '' : '3600',
      }
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

async function save() {
  submitting.value = true
  error.value = ''
  try {
    const patterns = form.value.denyPatterns
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean)
    const durationSec = Number(form.value.duration)
    const expiresAt = Number.isFinite(durationSec) && durationSec > 0
      ? Math.floor(Date.now() / 1000) + durationSec
      : null
    const body = {
      denyRiskThreshold: form.value.denyRiskThreshold || null,
      denyPatterns: patterns,
      expiresAt,
    }
    // Multi-audience buckets: write one row per audience. The server enforces
    // (agent_email, audience) uniqueness so re-PUTs are upserts.
    await Promise.all(props.bucket.audiences.map(aud =>
      ($fetch as any)(
        `/api/users/${encodeURIComponent(props.agentEmail)}/yolo-policy?audience=${encodeURIComponent(aud)}`,
        { method: 'PUT', body },
      ),
    ))
    await load()
    editing.value = false
  }
  catch (err: unknown) {
    const e = err as { data?: { title?: string }, message?: string }
    error.value = e.data?.title ?? e.message ?? 'Speichern fehlgeschlagen'
  }
  finally {
    submitting.value = false
  }
}

async function disable() {
  if (!confirm(`YOLO für ${props.bucket.label} wirklich deaktivieren?`)) return
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
    editing.value = false
    form.value = { denyRiskThreshold: 'high', denyPatterns: '', duration: '3600' }
  }
  catch (err: unknown) {
    const e = err as { data?: { title?: string } }
    error.value = e.data?.title ?? 'Deaktivieren fehlgeschlagen'
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
            <UBadge v-if="aggregate === 'all'" color="warning" variant="subtle" size="sm">
              YOLO aktiv
            </UBadge>
            <UBadge v-else-if="aggregate === 'partial'" color="warning" variant="outline" size="sm">
              YOLO teilweise
            </UBadge>
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

    <UAlert v-if="error" color="error" :title="error" @close="error = ''" />

    <div v-if="loading" class="text-xs text-gray-400">
      Lade…
    </div>

    <div v-else-if="aggregate === 'none' && !editing">
      <p class="text-sm text-gray-400 mb-3">
        Inaktiv. Grant-Requests in dieser Schicht warten auf menschliche Bestätigung.
      </p>
      <UButton color="warning" size="sm" icon="i-lucide-zap" @click="editing = true">
        YOLO aktivieren
      </UButton>
    </div>

    <div v-else-if="!editing" class="space-y-2 text-sm">
      <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <span class="text-gray-400">Aktiviert von</span>
        <span class="font-mono text-xs">{{ representativePolicy?.enabledBy ?? '-' }}</span>
        <span class="text-gray-400">Risiko-Schwelle</span>
        <span>
          <span v-if="representativePolicy?.denyRiskThreshold" class="font-mono">{{ representativePolicy.denyRiskThreshold }}</span>
          <span v-else class="italic text-gray-500">keine</span>
        </span>
        <span class="text-gray-400">Deny-Patterns</span>
        <span>
          <span v-if="!representativePolicy?.denyPatterns?.length" class="italic text-gray-500">keine</span>
          <span v-else class="flex flex-wrap gap-1">
            <code v-for="p in representativePolicy.denyPatterns" :key="p" class="bg-gray-800 px-2 py-0.5 rounded text-xs">{{ p }}</code>
          </span>
        </span>
        <span class="text-gray-400">Ablauf</span>
        <span>{{ expiryLabel }}</span>
      </div>
      <p v-if="aggregate === 'partial'" class="text-xs text-amber-400 italic">
        Teilweise aktiv — nicht alle Audiences in diesem Bucket haben einen
        eigenen YOLO-Eintrag. Speichern stellt alle gleich.
      </p>
      <div class="flex gap-2 pt-2">
        <UButton size="sm" icon="i-lucide-pencil" variant="outline" @click="editing = true">
          Bearbeiten
        </UButton>
        <UButton size="sm" color="error" variant="outline" icon="i-lucide-trash-2" :loading="submitting" @click="disable">
          Deaktivieren
        </UButton>
      </div>
    </div>

    <div v-else class="space-y-3">
      <UFormField label="Dauer" help="Nach Ablauf wird wieder jeder Request manuell bestätigt.">
        <USelect v-model="form.duration" :items="durationOptions" />
      </UFormField>
      <UFormField label="Risiko-Schwelle" help="Requests mit diesem oder höherem Risiko werden weiter menschlich bestätigt.">
        <USelect v-model="form.denyRiskThreshold" :items="riskOptions" />
      </UFormField>
      <UFormField label="Deny-Patterns (eine Zeile, Glob: * ?)">
        <UTextarea
          v-model="form.denyPatterns"
          :rows="3"
          placeholder="rm -rf *&#10;sudo *"
        />
      </UFormField>
      <div class="flex gap-2">
        <UButton color="warning" size="sm" icon="i-lucide-save" :loading="submitting" @click="save">
          {{ aggregate === 'none' ? 'Aktivieren' : 'Speichern' }}
        </UButton>
        <UButton variant="ghost" size="sm" :disabled="submitting" @click="editing = false">
          Abbrechen
        </UButton>
      </div>
    </div>
  </div>
</template>
