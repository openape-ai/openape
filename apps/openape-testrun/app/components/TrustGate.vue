<script setup lang="ts">
import AppIcon from './AppIcon.vue'

defineProps<{ author: string, images: number, loading: boolean, ready: boolean, error: string }>()
const emit = defineEmits<{ open: [], explain: [] }>()
</script>

<template>
  <section class="gate" aria-labelledby="gate-h">
    <div class="gate-head">
      <span class="mark"><AppIcon name="shield" /></span>
      <div>
        <h2 id="gate-h">
          Open this report?
        </h2>
        <p>{{ author }} made this report as a web page with its own code. The code runs when you open it.</p>
      </div>
    </div>
    <ul class="gate-facts">
      <li class="yes">
        <AppIcon name="check" /><span>It can't use your OpenApe sign-in or read anything else in Reports.</span>
      </li>
      <li class="no">
        <AppIcon name="alert" /><span>It can send what it shows to other websites.</span>
      </li>
      <li v-if="images" class="no">
        <AppIcon name="network" /><span>It loads {{ images === 1 ? '1 image' : `${images} images` }} from other websites. They may change after publishing.</span>
      </li>
    </ul>
    <p><strong>Open it if you trust {{ author }}.</strong></p>
    <p v-if="error" role="alert" class="error">
      {{ error }}
    </p>
    <div class="gate-acts">
      <button class="btn primary" type="button" :disabled="loading || !ready" @click="emit('open')">
        {{ loading ? 'Opening…' : 'Open report' }}
      </button>
      <button class="link" type="button" @click="emit('explain')">
        What gets isolated
      </button>
    </div>
  </section>
</template>

<style scoped>
.gate { background: var(--paper); border: 1px solid var(--rule); border-radius: var(--radius-l); max-width: 500px; padding: 26px 26px 22px; box-shadow: 0 12px 32px rgba(15, 20, 25, .10); display: grid; gap: 14px; }
.gate-head { display: flex; gap: 12px; align-items: flex-start; }
.mark { width: 40px; height: 40px; border-radius: 10px; background: var(--accent-soft); color: var(--accent); display: grid; place-items: center; flex: none; }
h2 { font-size: 19px; line-height: 1.3; font-weight: 680; margin: 0 0 4px; }
p { color: var(--ink-2); margin: 0; }
.gate-facts { display: grid; gap: 8px; font-size: 14px; border-top: 1px solid var(--rule); padding: 12px 0 0; margin: 0; list-style: none; }
.gate-facts li { display: grid; grid-template-columns: 20px 1fr; gap: 8px; }
.gate-facts .i { width: 16px; height: 16px; margin-top: 2px; }
.yes .i { color: var(--ok); }
.no .i { color: var(--warn-ink); }
.error { color: var(--bad); font-size: 14px; }
.gate-acts { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
@media (max-width: 760px) { .gate { padding: 20px 18px; } }
</style>
