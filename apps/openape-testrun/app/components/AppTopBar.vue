<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useOpenApeAuth } from '#imports'
import { copyText } from '../utils/toast'
import AppDialog from './AppDialog.vue'
import AppIcon from './AppIcon.vue'

defineProps<{ search: string }>()
const emit = defineEmits<{ search: [value: string] }>()
const input = ref<HTMLInputElement>()
const publishOpen = ref(false)
const command = 'ape-reports publish weekly-summary.html --key weekly-summary'
const { user, fetchUser } = useOpenApeAuth()
const email = computed(() => String(user.value?.sub ?? ''))
const initials = computed(() => email.value.split('@')[0]!.split(/[._-]/u).filter(Boolean).slice(0, 2).map(part => part[0]!.toUpperCase()).join(''))

function onKey(event: KeyboardEvent) {
  if (event.key !== '/' || (event.target as HTMLElement | null)?.closest('input,textarea,select,[contenteditable]')) return
  event.preventDefault()
  input.value?.focus()
}
onMounted(async () => {
  window.addEventListener('keydown', onKey)
  if (!user.value) await fetchUser()
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
defineExpose({ focus: () => input.value?.focus() })
</script>

<template>
  <header class="topbar">
    <NuxtLink class="brand" to="/reports" aria-label="OpenApe Reports, all reports">
      <AppIcon name="mark" class="brand-mark" /><span class="wordmark">OpenApe <span>Reports</span></span>
    </NuxtLink>
    <div class="search" role="search">
      <AppIcon name="search" />
      <label class="sr" for="q">Search reports</label>
      <input id="q" ref="input" type="search" placeholder="Search titles, tags and publishers" :value="search" autocomplete="off" @input="emit('search', ($event.target as HTMLInputElement).value)">
      <kbd aria-hidden="true">/</kbd>
    </div>
    <div class="top-actions">
      <button class="btn quiet" type="button" @click="publishOpen = true">
        <AppIcon name="upload" /><span class="publish-label">Publish</span>
      </button>
      <span v-if="initials" class="avatar" :title="email" :aria-label="`Signed in as ${email}`">{{ initials }}</span>
    </div>
    <AppDialog :open="publishOpen" title="Publish a report" center @close="publishOpen = false">
      <p>Reports publishes one finished HTML file. Run this where the file is, or let your agent run it:</p>
      <pre class="cmd">{{ command }}</pre>
      <ul class="facts">
        <li>New reports are private and kept permanently.</li>
        <li>Publishing again with the same key adds a new version. The link stays the same.</li>
        <li>Add a category and tags to make it easy to find.</li>
      </ul>
      <template #foot>
        <button class="btn" type="button" @click="copyText(command, 'Command copied.')">
          <AppIcon name="copy" small />Copy command
        </button>
        <button class="btn primary" type="button" @click="publishOpen = false">
          Done
        </button>
      </template>
    </AppDialog>
  </header>
</template>

<style scoped>
.topbar { position: sticky; top: 0; z-index: 20; height: calc(var(--bar-h) + var(--safe-top, 0px)); padding: var(--safe-top, 0px) 20px 0; display: flex; align-items: center; gap: 16px; background: var(--mat); border-bottom: 1px solid var(--rule); }
.brand { display: flex; align-items: center; gap: 10px; text-decoration: none; font-weight: 650; letter-spacing: -.01em; white-space: nowrap; }
.brand-mark { width: 22px; height: 22px; }
.wordmark span { color: var(--muted); font-weight: 500; }
.search { flex: 1; max-width: 560px; margin: 0 auto; position: relative; }
.search > .i { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); color: var(--muted); pointer-events: none; }
.search input { width: 100%; height: 38px; border: 1px solid var(--rule-strong); background: var(--paper); color: var(--ink); border-radius: var(--radius-m); padding: 0 40px 0 36px; font: inherit; }
.search input::placeholder { color: var(--muted); }
.search kbd { position: absolute; right: 9px; top: 50%; transform: translateY(-50%); font: 12px var(--font); color: var(--muted); border: 1px solid var(--rule-strong); border-radius: 4px; padding: 0 6px; }
.top-actions { display: flex; align-items: center; gap: 8px; }
.avatar { width: 32px; height: 32px; border-radius: 50%; background: var(--ink); color: var(--paper); display: grid; place-items: center; font-size: 12px; font-weight: 650; }
.facts { display: grid; gap: 6px; list-style: disc; padding-left: 20px; margin: 0; }
p { margin: 0; }
@media (max-width: 760px) {
  .topbar { padding: var(--safe-top, 0px) 12px 0; gap: 10px; }
  .wordmark, .publish-label, .search kbd { display: none; }
}
</style>
