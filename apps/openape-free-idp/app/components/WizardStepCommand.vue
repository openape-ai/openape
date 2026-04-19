<script setup lang="ts">
import { ref, watch } from 'vue'
import { useShapeResolver } from '../composables/useShapeResolver'
import type { ResolvedCommand } from '../composables/useShapeResolver'

const props = defineProps<{
  /** Current argv text (joined with spaces). Two-way bound with the wizard container. */
  input: string
  /** Pre-populate when editing an existing scoped grant. */
  initialCliId?: string
}>()

const emit = defineEmits<{
  (e: 'update:input', value: string): void
  (e: 'resolved', resolved: ResolvedCommand): void
}>()

const local = ref(props.input)
watch(() => props.input, (v) => { local.value = v })
watch(local, (v) => { emit('update:input', v) })

const { resolve, loading, error } = useShapeResolver()
const resolved = ref<ResolvedCommand | null>(null)

let debounceHandle: ReturnType<typeof setTimeout> | undefined

function parseArgv(text: string): string[] {
  // Simple whitespace split; no shell-quote handling. Good enough for the
  // wizard input where users type example commands, not pastes with quotes.
  return text.trim().split(/\s+/).filter(Boolean)
}

async function runResolve() {
  const argv = parseArgv(local.value)
  if (argv.length === 0) {
    resolved.value = null
    return
  }
  const cliId = argv[0]!
  try {
    const r = await resolve(cliId, argv)
    resolved.value = r
    emit('resolved', r)
  }
  catch {
    resolved.value = null
  }
}

watch(local, () => {
  if (debounceHandle) clearTimeout(debounceHandle)
  debounceHandle = setTimeout(() => { void runResolve() }, 200)
}, { immediate: false })

// Initial resolve if user navigated back to this step
if (local.value.trim()) void runResolve()
</script>

<template>
  <div class="space-y-3">
    <div>
      <label class="text-sm text-gray-300 font-medium">Beispiel-Command</label>
      <p class="text-xs text-gray-500 mt-1">
        Tippe den Befehl so ein, wie du ihn auf der Shell ausführen würdest.
      </p>
    </div>

    <UInput
      v-model="local"
      placeholder="z.B. gh push repository openape"
      size="lg"
      class="font-mono"
    />

    <div v-if="loading" class="text-xs text-gray-500 italic">
      Analysiere …
    </div>

    <div v-else-if="error" class="text-xs text-red-400">
      {{ error }}
    </div>

    <div v-else-if="resolved" class="p-3 rounded-lg border border-gray-700 bg-gray-800/60 space-y-2">
      <div class="flex items-center gap-2">
        <UIcon
          :name="resolved.synthetic ? 'i-lucide-zap-off' : 'i-lucide-check-circle-2'"
          :class="resolved.synthetic ? 'text-amber-400' : 'text-green-400'"
        />
        <div class="text-sm">
          <span class="font-mono text-gray-100">{{ resolved.operation_id }}</span>
          <span class="text-gray-500 ml-2">{{ resolved.cli_id }}</span>
        </div>
      </div>
      <div class="text-xs text-gray-400">
        Risk: <UBadge :color="resolved.detail.risk === 'low' ? 'success' : resolved.detail.risk === 'medium' ? 'warning' : 'error'" size="xs">
          {{ resolved.detail.risk }}
        </UBadge>
        · Action: <span class="font-mono">{{ resolved.detail.action }}</span>
      </div>
      <div v-if="resolved.detail.resource_chain.length > 0" class="text-xs text-gray-400">
        Erkannte Slots:
        <div class="mt-1 space-y-1">
          <div
            v-for="(r, i) in resolved.detail.resource_chain"
            :key="i"
            class="font-mono text-gray-200 break-all"
          >
            {{ r.resource }}<span v-if="r.selector">({{ Object.entries(r.selector).map(([k, v]) => `${k}=${v}`).join(', ') }})</span>
          </div>
        </div>
      </div>
      <div v-if="resolved.synthetic" class="text-xs text-amber-500">
        Generic fallback: diese CLI hat keinen Shape — scope bindet sonst exakt an argv-hash.
      </div>
    </div>

    <div v-else class="text-xs text-gray-500 italic">
      Noch keine Übereinstimmung.
    </div>
  </div>
</template>
