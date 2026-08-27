<script setup lang="ts">
import type { SearchHit } from '#shared/search'
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { apiFetch } from '../utils/api'

const props = defineProps<{ workspaceId: string | null }>()
const emit = defineEmits<{ pick: [hit: SearchHit & { deal_id?: string, phase?: string }] }>()

const open = ref(false)
const q = ref('')
const sel = ref(0)
const hits = ref<(SearchHit & { deal_id?: string, phase?: string })[]>([])
const toast = useToast()

function onKey(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    open.value = !open.value
    if (open.value) {
      q.value = ''
      hits.value = []
      sel.value = 0
    }
  }
  if (!open.value) return
  if (e.key === 'Escape') {
    open.value = false
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    sel.value = Math.min(sel.value + 1, Math.max(hits.value.length - 1, 0))
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    sel.value = Math.max(sel.value - 1, 0)
  }
  if (e.key === 'Enter' && hits.value[sel.value]) {
    e.preventDefault()
    choose(hits.value[sel.value]!)
  }
}

onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))

watch(q, async (value) => {
  sel.value = 0
  if (!props.workspaceId || !value.trim()) {
    hits.value = []
    return
  }
  hits.value = await apiFetch(`/api/search?workspace_id=${props.workspaceId}&q=${encodeURIComponent(value)}`)
})

function choose(hit: SearchHit & { deal_id?: string, phase?: string }) {
  if (!hit.deal_id) {
    toast.add({ title: 'Kein Vorgang zu diesem Treffer', color: 'neutral' })
    open.value = false
    return
  }
  emit('pick', hit)
  open.value = false
}

defineExpose({ open })
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-50 flex justify-center bg-[rgba(5,7,10,.66)] pt-[12vh] backdrop-blur-[3px]" data-palette @click.self="open = false">
    <div class="w-[min(620px,92vw)] overflow-hidden rounded-xl border border-[var(--crm-line-2)] bg-[var(--crm-panel-2)] shadow-2xl">
      <input
        v-model="q"
        class="w-full border-0 border-b border-[var(--crm-line)] bg-transparent px-[18px] py-[15px] text-[15px] outline-none"
        placeholder="Suche Vorgang, Person, Firma, Volltext …"
        autocomplete="off"
        data-palette-input
      >
      <div>
        <button
          v-for="(hit, i) in hits"
          :key="hit.typ + hit.id"
          type="button"
          class="flex w-full items-center gap-2.5 px-[18px] py-2.5 text-start"
          :class="i === sel ? 'bg-[var(--crm-accent-soft)]' : ''"
          @click="choose(hit)"
        >
          <span class="w-[54px] shrink-0 text-[10px] uppercase text-[var(--crm-ink-3)]">{{ hit.typ }}</span>
          <span>{{ hit.label }}</span>
          <span class="ms-auto text-[11.5px] text-[var(--crm-ink-3)]">{{ hit.sub }}</span>
        </button>
        <div v-if="q && !hits.length" class="px-[18px] py-2.5 text-[var(--crm-ink-3)]">
          Keine Treffer
        </div>
        <div v-else-if="!q" class="px-[18px] py-2.5 text-[var(--crm-ink-3)]">
          Tippen zum Suchen …
        </div>
      </div>
      <div class="flex gap-3 border-t border-[var(--crm-line)] px-[18px] py-2 text-[11.5px] text-[var(--crm-ink-3)]">
        <span>↑↓ navigieren</span>
        <span>⏎ öffnen</span>
        <span>esc schließen</span>
      </div>
    </div>
  </div>
</template>
