<script lang="ts">
import { t } from './i18n'
import { defineComponent } from 'vue'

export default defineComponent({
  props: { modelValue: { type: String, required: true }, readonly: Boolean, disabled: Boolean },
  emits: ['update:modelValue', 'save'],
  data() { return { scrollTop: 0 } },
  computed: { lines(): number { return this.modelValue.split('\n').length } },
  methods: {
    t,
    key(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === 's') { event.preventDefault(); this.$emit('save'); return }
      if (event.key !== 'Tab' || event.shiftKey || this.readonly || this.disabled) return
      event.preventDefault()
      const input = event.target as HTMLTextAreaElement
      const start = input.selectionStart; const end = input.selectionEnd
      const code = `${this.modelValue.slice(0, start)}  ${this.modelValue.slice(end)}`
      this.$emit('update:modelValue', code)
      void this.$nextTick(() => { input.setSelectionRange(start + 2, start + 2) })
    },
  },
})
</script>

<template>
  <div class="code-editor">
    <div class="line-gutter" aria-hidden="true">
      <pre :style="{ transform: `translateY(-${scrollTop}px)` }">{{ Array.from({ length: lines }, (_, index) => index + 1).join('\n') }}</pre>
    </div>
    <textarea :value="modelValue" :readonly="readonly" :disabled="disabled" :aria-label="t('Script source')" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off" maxlength="150000" @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)" @scroll="scrollTop = ($event.target as HTMLTextAreaElement).scrollTop" @keydown="key" />
  </div>
</template>

<style scoped>
.code-editor { display:flex; min-width:0; border:1px solid var(--border); border-radius:10px; overflow:hidden; background:var(--bg); height:360px; min-height:180px; max-height:70vh; resize:vertical; }
.line-gutter { width:48px; flex-shrink:0; overflow:hidden; color:var(--muted); background:var(--surface); border-right:1px solid var(--border); text-align:right; }
pre, textarea { font:13px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace; tab-size:2; }
pre { margin:0; padding:16px 10px; }
textarea { display:block; min-width:0; width:100%; height:100%; resize:none; border:0; padding:16px; margin:0; color:var(--text); background:transparent; box-sizing:border-box; white-space:pre; }
textarea:focus { outline:2px solid var(--accent); outline-offset:-2px; }
@media (max-width:640px) { .code-editor { height:320px; } textarea { padding:12px; } pre { padding-top:12px; } .line-gutter { width:36px; } }
</style>
