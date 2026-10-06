<script setup lang="ts">
import { computed, ref } from 'vue'
import type { MapView } from '../../contracts/map-view'
import { t } from '../i18n'
import { codexBrief } from '../utils/codex-brief'

/**
 * Creation happens in Codex. This panel builds the brief from the selected group and the pinned
 * node, shows whether Codex is connected to this desktop, and hands the text over: the clipboard
 * on every host, because Codex has no deep link that carries a prompt.
 */
const props = defineProps<{ view: MapView, pinned: string | null, group: string | null, connected: boolean | null }>()
const emit = defineEmits<{ close: [], settings: [] }>()
const brief = computed(() => codexBrief(props.view, props.pinned, props.group))
const copied = ref<'copied' | 'selected' | null>(null)
const text = ref<HTMLElement | null>(null)
async function handOver() {
  try { await navigator.clipboard.writeText(brief.value); copied.value = 'copied' }
  catch {
    const range = document.createRange(); range.selectNodeContents(text.value!)
    const selection = getSelection(); selection?.removeAllRanges(); selection?.addRange(range)
    copied.value = 'selected'
  }
}
</script>

<template>
  <div class="codex-handoff" role="region" :aria-label="t('Hand over to Codex')">
    <div>
      <b>{{ t('Hand over to Codex') }}</b> <span v-if="connected !== null" class="pill" :class="connected ? 'ok' : 'off'">{{ t(connected ? 'Codex connected' : 'Codex not connected') }}</span> <button class="secondary small" type="button" @click="emit('settings')">
        {{ t('Settings') }}
      </button>
    </div>
    <pre ref="text" data-testid="codex-brief">{{ brief }}</pre>
    <div class="opts">
      <button class="primary" type="button" @click="handOver">
        {{ copied === 'copied' ? t('Copied, paste into Codex') : copied === 'selected' ? t('Selected, copy and paste into Codex') : t('Open in Codex') }}
      </button>
      <button class="secondary" type="button" @click="emit('close')">
        {{ t('Close') }}
      </button>
    </div>
  </div>
</template>

<style>
.codex-handoff{background:var(--surface);border:1px solid var(--idp);border-radius:10px;padding:12px 14px;margin:0 0 10px;display:grid;gap:8px;font-size:14px}
.codex-handoff pre{margin:0;white-space:pre-wrap;font-family:ui-monospace,Menlo,monospace;font-size:12.5px;background:var(--tint);border-radius:6px;padding:10px 12px}
.codex-handoff .opts{display:flex;flex-wrap:wrap;gap:6px}.codex-handoff .secondary{padding:6px 12px;font-size:14px}.codex-handoff .secondary.small{padding:2px 8px;font-size:12px}
.codex-handoff .pill{display:inline-block;font-size:12px;font-weight:600;padding:1px 8px;border-radius:10px}.codex-handoff .pill.ok{background:var(--ok-soft);color:var(--ok)}.codex-handoff .pill.off{background:var(--tint);color:var(--muted)}
.codex-handoff .primary{border-radius:7px;padding:6px 12px;background:var(--accent);color:var(--bg)}
</style>
