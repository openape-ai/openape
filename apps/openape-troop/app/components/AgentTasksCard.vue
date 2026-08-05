<script setup lang="ts">
import type { Task } from '../types/agent'
import { ref } from 'vue'

// The agent's scheduled tasks and the editor that creates or edits one. List
// and editor stay together because the editor is only ever opened from a row
// here. Every write ends in `updated`; the page owns the agent detail and
// reloads it, so the list a user sees always comes from the server.
const props = defineProps<{ agentName: string, tasks: Task[] }>()
const emit = defineEmits<{ updated: [], error: [message: string] }>()

const { t } = useI18n()

const showEditor = ref(false)
const editing = ref<{ taskId: string, isNew: boolean }>({ taskId: '', isNew: true })
const form = ref({
  task_id: '',
  name: '',
  cron: '*/5 * * * *',
  user_prompt: '',
  tools: [] as string[],
  max_steps: 10,
  enabled: true,
})
const saving = ref(false)
const saveError = ref('')

function openCreate() {
  editing.value = { taskId: '', isNew: true }
  form.value = {
    task_id: '',
    name: '',
    cron: '*/5 * * * *',
    user_prompt: '',
    tools: [],
    max_steps: 10,
    enabled: true,
  }
  saveError.value = ''
  showEditor.value = true
}

function openEdit(task: Task) {
  editing.value = { taskId: task.taskId, isNew: false }
  form.value = {
    task_id: task.taskId,
    name: task.name,
    cron: task.cron,
    user_prompt: task.userPrompt,
    tools: [...task.tools],
    max_steps: task.maxSteps,
    enabled: task.enabled,
  }
  saveError.value = ''
  showEditor.value = true
}

async function save() {
  saving.value = true
  saveError.value = ''
  try {
    if (editing.value.isNew) {
      await apiFetch(`/api/agents/${props.agentName}/tasks`, {
        method: 'POST',
        body: form.value,
      })
    }
    else {
      await apiFetch(`/api/agents/${props.agentName}/tasks/${editing.value.taskId}`, {
        method: 'PUT',
        body: {
          name: form.value.name,
          cron: form.value.cron,
          user_prompt: form.value.user_prompt,
          tools: form.value.tools,
          max_steps: form.value.max_steps,
          enabled: form.value.enabled,
        },
      })
    }
    showEditor.value = false
    emit('updated')
  }
  catch (err: any) {
    saveError.value = err?.data?.statusMessage || err?.message || t('common.error.saveFailed')
  }
  finally {
    saving.value = false
  }
}

async function remove(task: Task) {
  if (!confirm(t('agentDetail.tasks.confirmDelete', { name: task.name }))) return
  try {
    await apiFetch(`/api/agents/${props.agentName}/tasks/${task.taskId}`, { method: 'DELETE' })
    emit('updated')
  }
  catch (err: any) {
    emit('error', err?.data?.statusMessage || err?.message || t('common.error.deleteFailed'))
  }
}
</script>

<template>
  <UCard :ui="{ body: 'p-0' }">
    <details class="group">
      <summary class="cursor-pointer list-none px-4 py-3 flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 text-sm">
          <UIcon name="i-lucide-clock" class="text-muted size-4" />
          <span class="font-medium">{{ $t('agentDetail.tasks.title') }}</span>
          <UBadge color="neutral" variant="subtle" size="xs">
            {{ tasks.length }}
          </UBadge>
        </div>
        <UIcon name="i-lucide-chevron-down" class="size-4 text-muted transition-transform group-open:rotate-180" />
      </summary>
      <div class="border-t border-(--ui-border)">
        <div class="flex items-center justify-end px-4 py-3">
          <UButton color="primary" size="sm" icon="i-lucide-plus" @click="openCreate">
            {{ $t('agentDetail.tasks.newButton') }}
          </UButton>
        </div>
        <div v-if="tasks.length === 0" class="px-4 pb-6 text-center text-muted text-sm">
          {{ $t('agentDetail.tasks.empty') }}
        </div>
        <ul v-else class="divide-y divide-(--ui-border)">
          <li v-for="task in tasks" :key="task.taskId">
            <button
              type="button"
              class="w-full text-left px-4 py-4 active:bg-zinc-900 transition-colors flex items-start gap-3"
              @click="openEdit(task)"
            >
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap mb-1">
                  <span class="font-medium text-base">{{ task.name }}</span>
                  <UBadge v-if="!task.enabled" color="neutral" variant="subtle" size="xs">
                    {{ $t('common.badge.disabled') }}
                  </UBadge>
                </div>
                <div class="flex items-center gap-2 text-xs text-muted">
                  <UIcon name="i-lucide-clock" class="size-3.5 shrink-0" />
                  <code class="font-mono">{{ task.cron }}</code>
                </div>
                <p v-if="task.userPrompt" class="text-xs text-muted mt-1 line-clamp-2">
                  {{ task.userPrompt }}
                </p>
                <div class="flex items-center gap-2 text-xs text-muted mt-1.5 flex-wrap">
                  <span v-if="task.tools.length > 0" class="flex items-center gap-1">
                    <UIcon name="i-lucide-wrench" class="size-3.5 shrink-0" />
                    {{ $t('agentDetail.tasks.toolsCount', task.tools.length) }}
                  </span>
                  <span class="flex items-center gap-1">
                    <UIcon name="i-lucide-list-checks" class="size-3.5 shrink-0" />
                    {{ $t('agentDetail.tasks.maxSteps', { n: task.maxSteps }) }}
                  </span>
                </div>
              </div>
              <UButton
                variant="ghost"
                color="error"
                size="sm"
                icon="i-lucide-trash-2"
                :ui="{ base: 'shrink-0' }"
                @click.stop="remove(task)"
              />
            </button>
          </li>
        </ul>
      </div>
    </details>

    <!-- Task editor modal — fullscreen on mobile so the keyboard
         doesn't push the save button under the textarea. -->
    <UModal
      v-model:open="showEditor"
      :title="editing.isNew ? $t('agentDetail.taskEditor.titleNew') : $t('agentDetail.taskEditor.titleEdit', { id: editing.taskId })"
      fullscreen
      :ui="{ content: 'sm:max-w-2xl sm:max-h-[90vh]' }"
    >
      <template #body>
        <form class="space-y-5" @submit.prevent="save">
          <UFormField label="task_id" :hint="$t('agentDetail.taskEditor.taskId.hint')" :required="editing.isNew">
            <UInput
              v-model="form.task_id"
              :disabled="!editing.isNew"
              placeholder="daily-summary"
              size="lg"
              class="w-full font-mono"
              autocapitalize="off"
              autocorrect="off"
              spellcheck="false"
              pattern="[a-z][a-z0-9-]*"
              @input="form.task_id = String($event.target.value).toLowerCase().replace(/[^a-z0-9-]/g, '')"
            />
          </UFormField>
          <UFormField :label="$t('agentDetail.taskEditor.displayName')" required>
            <UInput v-model="form.name" placeholder="Daily Summary" size="lg" class="w-full" />
          </UFormField>
          <UFormField :label="$t('agentDetail.taskEditor.cron.label')" :hint="$t('agentDetail.taskEditor.cron.hint')">
            <CronInput v-model="form.cron" />
          </UFormField>
          <UFormField :label="$t('agentDetail.taskEditor.userPrompt.label')" :hint="$t('agentDetail.taskEditor.userPrompt.hint')" required>
            <UTextarea
              v-model="form.user_prompt"
              :rows="8"
              autoresize
              size="lg"
              class="w-full"
              :placeholder="$t('agentDetail.taskEditor.userPrompt.placeholder')"
            />
          </UFormField>
          <UFormField :label="$t('agentDetail.taskEditor.toolsLabel')">
            <ToolPicker v-model="form.tools" />
          </UFormField>
          <UFormField :label="$t('agentDetail.taskEditor.maxStepsLabel')">
            <UInput v-model.number="form.max_steps" type="number" :min="1" :max="50" size="lg" class="w-full" />
          </UFormField>
          <UFormField>
            <UCheckbox v-model="form.enabled" :label="$t('agentDetail.taskEditor.enabledLabel')" />
          </UFormField>

          <UAlert v-if="saveError" color="error" :title="saveError" />
        </form>
      </template>
      <template #footer>
        <div class="flex flex-row-reverse w-full gap-2">
          <UButton type="submit" color="primary" :loading="saving" size="lg" class="flex-1 sm:flex-none justify-center" @click="save">
            {{ editing.isNew ? $t('agentDetail.taskEditor.createButton') : $t('agentDetail.taskEditor.saveButton') }}
          </UButton>
          <UButton variant="ghost" :disabled="saving" size="lg" @click="showEditor = false">
            {{ $t('common.cancel') }}
          </UButton>
        </div>
      </template>
    </UModal>
  </UCard>
</template>
