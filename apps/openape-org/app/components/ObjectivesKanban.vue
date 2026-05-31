<script setup lang="ts">
import { computed, ref } from 'vue'

interface Objective {
  id: string
  orgId: string
  title: string
  description: string
  status: 'planned' | 'in_progress' | 'done' | 'abandoned'
  targetDate: number | null
  parentId: string | null
  createdByEmail: string
  createdAt: number
  updatedAt: number
}

const props = defineProps<{ orgId: string, objectives: Objective[] }>()
const emit = defineEmits<{ changed: [] }>()

const { t } = useI18n()
const { fmtDate } = useDateFormat()

const showCreate = ref(false)
const editing = ref<Objective | null>(null)
const draft = ref({ title: '', description: '', status: 'planned' as Objective['status'], target_date: null as number | null })
const submitting = ref(false)
const error = ref('')

function startCreate() {
  editing.value = null
  draft.value = { title: '', description: '', status: 'planned', target_date: null }
  error.value = ''
  showCreate.value = true
}
function startEdit(o: Objective) {
  editing.value = o
  draft.value = { title: o.title, description: o.description, status: o.status, target_date: o.targetDate }
  error.value = ''
  showCreate.value = true
}

async function save() {
  if (!draft.value.title.trim()) return
  submitting.value = true
  error.value = ''
  try {
    if (editing.value) {
      await ($fetch as any)(`/api/orgs/${props.orgId}/objectives/${editing.value.id}`, { method: 'PATCH', body: draft.value })
    }
    else {
      await ($fetch as any)(`/api/orgs/${props.orgId}/objectives`, { method: 'POST', body: draft.value })
    }
    showCreate.value = false
    emit('changed')
  }
  catch (err: any) {
    error.value = err?.data?.statusMessage || err?.message || t('objective.error.saveFailed')
  }
  finally {
    submitting.value = false
  }
}

async function moveTo(o: Objective, status: Objective['status']) {
  if (o.status === status) return
  try {
    await ($fetch as any)(`/api/orgs/${props.orgId}/objectives/${o.id}`, { method: 'PATCH', body: { status } })
    emit('changed')
  }
  catch (err: any) {
    error.value = err?.data?.statusMessage || err?.message || t('objective.error.saveFailed')
  }
}

async function remove(o: Objective) {
  if (!confirm(t('objective.confirmDelete', { title: o.title }))) return
  try {
    await ($fetch as any)(`/api/orgs/${props.orgId}/objectives/${o.id}`, { method: 'DELETE' })
    emit('changed')
  }
  catch (err: any) {
    error.value = err?.data?.statusMessage || err?.message || t('objective.error.deleteFailed')
  }
}

const planned = computed(() => props.objectives.filter(o => o.status === 'planned'))
const inProgress = computed(() => props.objectives.filter(o => o.status === 'in_progress'))
const done = computed(() => props.objectives.filter(o => o.status === 'done'))
const abandoned = computed(() => props.objectives.filter(o => o.status === 'abandoned'))

const columns = computed(() => [
  { key: 'planned' as const, label: t('objective.column.planned'), items: planned.value, accent: 'border-zinc-600/40' },
  { key: 'in_progress' as const, label: t('objective.column.inProgress'), items: inProgress.value, accent: 'border-blue-500/40' },
  { key: 'done' as const, label: t('objective.column.done'), items: done.value, accent: 'border-emerald-500/40' },
])
</script>

<template>
  <div class="space-y-4">
    <div class="flex justify-end">
      <UButton color="primary" size="sm" icon="i-lucide-plus" @click="startCreate">
        {{ $t('objective.new') }}
      </UButton>
    </div>

    <UAlert v-if="error" color="error" :title="error" />

    <!-- Mobile-first: vertical-stacked sections, each scrolls horizontally
         if cards overflow. On sm+ we go to a 3-column grid. -->
    <div class="space-y-4 sm:grid sm:grid-cols-3 sm:gap-4 sm:space-y-0">
      <section
        v-for="col in columns"
        :key="col.key"
        class="rounded-lg border bg-(--ui-bg-elevated) p-3 min-h-[200px]" :class="[col.accent]"
      >
        <header class="flex items-center justify-between mb-3 pb-2 border-b border-(--ui-border)">
          <h3 class="text-sm font-semibold uppercase tracking-wide">
            {{ col.label }}
          </h3>
          <span class="text-xs text-muted">{{ col.items.length }}</span>
        </header>
        <ul v-if="col.items.length > 0" class="space-y-2">
          <li v-for="o in col.items" :key="o.id">
            <div class="rounded-md border border-(--ui-border) bg-(--ui-bg) p-3 hover:border-zinc-500 transition-colors">
              <div class="flex items-start justify-between gap-2">
                <button type="button" class="text-left flex-1 min-w-0 cursor-pointer" @click="startEdit(o)">
                  <h4 class="text-sm font-medium line-clamp-2">
                    {{ o.title }}
                  </h4>
                  <p v-if="o.description" class="text-xs text-muted mt-1 line-clamp-2">
                    {{ o.description }}
                  </p>
                  <p v-if="o.targetDate" class="text-[10px] text-muted mt-1">
                    🎯 {{ fmtDate(o.targetDate) }}
                  </p>
                </button>
                <UDropdownMenu
                  :items="[
                    [
                      { label: $t('objective.move.planned'), icon: 'i-lucide-circle', onSelect: () => moveTo(o, 'planned'), disabled: o.status === 'planned' },
                      { label: $t('objective.move.inProgress'), icon: 'i-lucide-play', onSelect: () => moveTo(o, 'in_progress'), disabled: o.status === 'in_progress' },
                      { label: $t('objective.move.done'), icon: 'i-lucide-check', onSelect: () => moveTo(o, 'done'), disabled: o.status === 'done' },
                      { label: $t('objective.move.abandoned'), icon: 'i-lucide-x', onSelect: () => moveTo(o, 'abandoned'), disabled: o.status === 'abandoned' },
                    ],
                    [{ label: $t('objective.delete'), icon: 'i-lucide-trash-2', color: 'error', onSelect: () => remove(o) }],
                  ]"
                  :popper="{ placement: 'bottom-end' }"
                >
                  <UButton variant="ghost" size="xs" icon="i-lucide-more-vertical" :ui="{ base: 'shrink-0' }" />
                </UDropdownMenu>
              </div>
            </div>
          </li>
        </ul>
        <div v-else class="text-xs text-muted text-center py-6">
          {{ $t('objective.empty') }}
        </div>
      </section>
    </div>

    <!-- Abandoned bucket below — collapsed by default to keep the main
         board clean. Owners rarely need it but it's preserved for audit. -->
    <details v-if="abandoned.length > 0" class="rounded-lg border border-(--ui-border) bg-(--ui-bg-elevated) px-3 py-2 mt-4">
      <summary class="cursor-pointer text-sm text-muted">
        {{ $t('objective.abandoned') }} ({{ abandoned.length }})
      </summary>
      <ul class="space-y-2 mt-3">
        <li v-for="o in abandoned" :key="o.id" class="text-xs">
          <div class="rounded-md border border-(--ui-border) px-3 py-2">
            <div class="flex items-center justify-between gap-2">
              <span class="line-through opacity-60">{{ o.title }}</span>
              <UDropdownMenu
                :items="[[
                  { label: $t('objective.move.planned'), icon: 'i-lucide-circle', onSelect: () => moveTo(o, 'planned') },
                  { label: $t('objective.delete'), icon: 'i-lucide-trash-2', color: 'error', onSelect: () => remove(o) },
                ]]"
                :popper="{ placement: 'bottom-end' }"
              >
                <UButton variant="ghost" size="xs" icon="i-lucide-more-vertical" />
              </UDropdownMenu>
            </div>
          </div>
        </li>
      </ul>
    </details>

    <UModal v-model:open="showCreate" :ui="{ content: 'sm:max-w-md max-h-[92dvh] flex flex-col' }">
      <template #content>
        <div class="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
          <div class="flex items-start justify-between gap-3">
            <h3 class="text-lg font-semibold">
              {{ editing ? $t('objective.edit.title') : $t('objective.new') }}
            </h3>
            <UButton variant="ghost" size="sm" icon="i-lucide-x" :disabled="submitting" @click="showCreate = false" />
          </div>

          <UFormField :label="$t('objective.field.title')" required>
            <UInput v-model="draft.title" size="lg" class="w-full" :ui="{ base: 'w-full' }" />
          </UFormField>
          <UFormField :label="$t('objective.field.description')">
            <UTextarea v-model="draft.description" :rows="4" autoresize class="w-full" :ui="{ base: 'w-full' }" />
          </UFormField>
          <UFormField v-if="editing" :label="$t('objective.field.status')">
            <USelect
              v-model="draft.status"
              :items="[
                { label: $t('objective.column.planned'), value: 'planned' },
                { label: $t('objective.column.inProgress'), value: 'in_progress' },
                { label: $t('objective.column.done'), value: 'done' },
                { label: $t('objective.move.abandoned'), value: 'abandoned' },
              ]"
            />
          </UFormField>
          <UAlert v-if="error" color="error" :title="error" />
        </div>

        <div class="shrink-0 flex justify-end gap-2 border-t border-default bg-default px-5 sm:px-6 pt-3 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
          <UButton variant="ghost" :disabled="submitting" @click="showCreate = false">
            {{ $t('common.cancel') }}
          </UButton>
          <UButton color="primary" :loading="submitting" :disabled="!draft.title.trim()" @click="save">
            {{ $t('common.save') }}
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
