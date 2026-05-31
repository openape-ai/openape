<script setup lang="ts">
import { computed, ref } from 'vue'

interface Report {
  id: string
  orgId: string
  kind: 'daily' | 'weekly' | 'quarterly' | 'alert' | 'adhoc'
  title: string
  bodyMd: string
  generatedByEmail: string
  createdAt: number
}

const props = defineProps<{ reports: Report[] }>()

const { t } = useI18n()
const { fmtRelative } = useRelativeTime()
const { fmtDate } = useDateFormat()

const filter = ref<'all' | Report['kind']>('all')
const expandedIds = ref<Set<string>>(new Set())

const filterOptions = computed(() => [
  { label: t('reports.filter.all'), value: 'all' as const },
  { label: t('reports.kind.alert'), value: 'alert' as const },
  { label: t('reports.kind.weekly'), value: 'weekly' as const },
  { label: t('reports.kind.daily'), value: 'daily' as const },
  { label: t('reports.kind.quarterly'), value: 'quarterly' as const },
  { label: t('reports.kind.adhoc'), value: 'adhoc' as const },
])

const visible = computed(() => filter.value === 'all' ? props.reports : props.reports.filter(r => r.kind === filter.value))

function toggle(id: string) {
  const next = new Set(expandedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedIds.value = next
}

// Very small Markdown renderer: paragraph splits + simple **bold** /
// *italic* / `code` / # heading. Sufficient for agent-generated
// summaries. Avoids pulling in a 30 KB markdown lib for v1.
function renderInlineMd(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code class="bg-(--ui-bg) px-1 rounded text-xs">$1</code>')
}
function renderMd(body: string): string {
  const lines = body.split(/\r?\n/)
  const out: string[] = []
  let inList = false
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (line.startsWith('# ')) {
      if (inList) { out.push('</ul>'); inList = false }
      out.push(`<h3 class="text-base font-semibold mt-3 mb-1">${renderInlineMd(line.slice(2))}</h3>`)
    }
    else if (line.startsWith('## ')) {
      if (inList) { out.push('</ul>'); inList = false }
      out.push(`<h4 class="text-sm font-semibold mt-2 mb-1">${renderInlineMd(line.slice(3))}</h4>`)
    }
    else if (line.startsWith('- ') || line.startsWith('* ')) {
      if (!inList) { out.push('<ul class="list-disc list-inside space-y-0.5 my-1">'); inList = true }
      out.push(`<li>${renderInlineMd(line.slice(2))}</li>`)
    }
    else if (line.trim() === '') {
      if (inList) { out.push('</ul>'); inList = false }
      out.push('<div class="h-2"></div>')
    }
    else {
      if (inList) { out.push('</ul>'); inList = false }
      out.push(`<p class="text-sm leading-relaxed">${renderInlineMd(line)}</p>`)
    }
  }
  if (inList) out.push('</ul>')
  return out.join('\n')
}

function kindColor(k: Report['kind']): 'error' | 'warning' | 'info' | 'success' | 'neutral' {
  switch (k) {
    case 'alert': return 'error'
    case 'weekly': return 'info'
    case 'quarterly': return 'success'
    case 'daily': return 'neutral'
    case 'adhoc': return 'warning'
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between flex-wrap gap-2">
      <USelect v-model="filter" :items="filterOptions" size="sm" :ui="{ base: 'min-w-[140px]' }" />
      <p class="text-xs text-muted">
        {{ $t('reports.count', visible.length) }}
      </p>
    </div>

    <div v-if="visible.length === 0" class="rounded-lg border border-dashed border-(--ui-border) p-8 text-center text-sm text-muted">
      {{ $t('reports.empty') }}
    </div>

    <ul v-else class="space-y-2">
      <li
        v-for="r in visible"
        :key="r.id"
        class="rounded-lg border border-(--ui-border) bg-(--ui-bg-elevated) overflow-hidden"
      >
        <button
          type="button"
          class="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-zinc-900/40 transition-colors cursor-pointer"
          @click="toggle(r.id)"
        >
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <UBadge :color="kindColor(r.kind)" variant="subtle" size="xs">
                {{ $t(`reports.kind.${r.kind}`) }}
              </UBadge>
              <h4 class="text-sm font-medium truncate">
                {{ r.title }}
              </h4>
            </div>
            <p class="text-xs text-muted mt-1">
              {{ fmtRelative(r.createdAt) }} · <span class="font-mono">{{ r.generatedByEmail }}</span>
            </p>
          </div>
          <UIcon
            name="i-lucide-chevron-down"
            class="size-4 text-muted shrink-0 mt-1 transition-transform"
            :class="{ 'rotate-180': expandedIds.has(r.id) }"
          />
        </button>
        <div v-if="expandedIds.has(r.id)" class="border-t border-(--ui-border) px-4 py-3 bg-(--ui-bg)">
          <div class="prose-sm" v-html="renderMd(r.bodyMd)" />
          <p class="text-[10px] text-muted mt-3">
            {{ fmtDate(r.createdAt) }}
          </p>
        </div>
      </li>
    </ul>
  </div>
</template>
