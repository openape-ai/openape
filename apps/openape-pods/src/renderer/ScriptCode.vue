<script lang="ts">
import { highlightScript } from './script-highlight'
import { t } from './i18n'
import { defineComponent } from 'vue'

export default defineComponent({
  props: { modelValue: { type: String, required: true }, readonly: Boolean, disabled: Boolean },
  emits: ['update:modelValue', 'save'],
  data() { return { scrollTop: 0, scrollLeft: 0, escapeTab: false } },
  computed: { tokens() { return highlightScript(this.modelValue) }, lines(): number { return this.modelValue.split('\n').length } },
  methods: {
    t,
    key(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === 's') { event.preventDefault(); this.$emit('save'); return }
      if (event.key === 'Escape') { this.escapeTab = true; return }
      if (event.key === 'Tab' && this.escapeTab) { this.escapeTab = false; return }
      this.escapeTab = false
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
    <div class="code-layers">
      <pre class="highlight" aria-hidden="true"><code :style="{ transform: `translate(${-scrollLeft}px, ${-scrollTop}px)` }"><span v-for="(token, index) in tokens" :key="index" :class="token.kind">{{ token.text }}</span></code></pre>
      <textarea :value="modelValue" :readonly="readonly" :disabled="disabled" :aria-label="t('Script source')" :aria-description="t('Press Escape, then Tab to leave the editor.')" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off" maxlength="150000" @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)" @scroll="scrollTop = ($event.target as HTMLTextAreaElement).scrollTop; scrollLeft = ($event.target as HTMLTextAreaElement).scrollLeft" @keydown="key" />
    </div>
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
.code-layers { position:relative;flex:1;min-width:0;background:#14251d;color:#e6efdd; }.highlight, .code-layers textarea { position:absolute;inset:0;margin:0;width:100%;height:100%;padding:16px;font:13px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;tab-size:2;box-sizing:border-box;letter-spacing:0; }.highlight { overflow:hidden;pointer-events:none; }.highlight code { display:block;font:inherit; }.code-layers textarea { color:transparent;-webkit-text-fill-color:transparent;caret-color:#fff;background:transparent; }.code-layers textarea::selection { background:#7f9e8266; }.keyword { color:#c9a9f0; }.string { color:#bcdda0; }.comment { color:#85a790; }.number { color:#efbb80; }
</style>
