<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import { t } from './i18n'
import type { StartupActionId, StartupState } from './startup'

const symbols = { 'progress': '', 'sign-in': '→', 'retry': '!', 'blocked': '⊘', 'ok': '✓' }

/** The full-window startup status: one status, one primary action, nothing else before the owner is signed in. */
export default defineComponent({
  props: { state: { type: Object as PropType<StartupState>, required: true }, busy: Boolean },
  emits: { action: (_id: StartupActionId, _email?: string) => true },
  // An address shape, not copy; it reads the same in every language.
  data() { return { email: this.state.email ?? '', exampleAddress: 'name@example.com' } },
  computed: { symbol(): string { return symbols[this.state.tone] } },
  methods: {
    t,
    submit(id: StartupActionId) { if (!this.busy) this.$emit('action', id, this.state.email === undefined ? undefined : this.email.trim()) },
  },
})
</script>

<template>
  <main class="startup-screen" :class="`tone-${state.tone}`" :data-state="state.id">
    <section class="startup-panel" :aria-labelledby="`startup-title-${state.id}`">
      <div class="startup-brand">
        <span class="brand-mark" aria-hidden="true">{{ 'P' }}</span><strong>{{ 'OpenApe Pods' }}</strong>
      </div>
      <span class="startup-symbol" aria-hidden="true">{{ symbol }}</span>
      <div :role="state.tone === 'retry' || state.tone === 'blocked' ? 'alert' : 'status'" class="startup-status">
        <h1 :id="`startup-title-${state.id}`">
          {{ state.title }}
        </h1>
        <p>{{ state.message }}</p>
      </div>
      <p v-if="state.account" class="startup-account">
        {{ state.account }}
      </p>
      <p v-if="state.code" class="startup-code">
        {{ t('Code') }} <strong>{{ state.code }}</strong>
      </p>
      <dl v-if="state.facts" class="startup-facts">
        <div v-for="fact in state.facts" :key="fact.label">
          <dt>{{ fact.label }}</dt><dd :class="`fact-${fact.tone}`">
            {{ fact.value }}
          </dd>
        </div>
      </dl>
      <form v-if="state.actions.length" class="startup-actions" @submit.prevent="submit(state.actions[0]!.id)">
        <label v-if="state.email !== undefined">{{ t('DDISA address') }}<input v-model="email" type="email" required autocomplete="email" :placeholder="exampleAddress" :disabled="busy"></label>
        <button class="primary startup-primary" :disabled="busy">
          {{ state.actions[0]!.label }}
        </button>
        <button v-for="action in state.actions.slice(1)" :key="action.id" type="button" class="secondary startup-secondary" :disabled="busy" @click="submit(action.id)">
          {{ action.label }}
        </button>
      </form>
      <details v-if="state.detail" class="startup-detail">
        <summary>{{ t('Technical details') }}</summary>
        <code>{{ state.detail }}</code>
      </details>
    </section>
  </main>
</template>

<style scoped>
.startup-screen{--tone:var(--accent);--tone-soft:var(--tint);min-height:100vh;box-sizing:border-box;display:grid;place-items:center;padding:40px 24px;background:var(--bg)}
.tone-sign-in{--tone:var(--idp);--tone-soft:var(--idp-soft)}.tone-retry{--tone:var(--warn);--tone-soft:var(--warn-soft)}.tone-blocked{--tone:var(--bad);--tone-soft:var(--bad-soft)}.tone-ok{--tone:var(--ok);--tone-soft:var(--ok-soft)}
.startup-panel{width:min(100%,460px);display:grid;gap:18px;justify-items:center;text-align:center;overflow-wrap:anywhere}
.startup-brand{display:flex;align-items:center;gap:10px;font-size:15px;margin-bottom:12px}
.startup-symbol{width:56px;height:56px;display:grid;place-items:center;border-radius:50%;background:var(--tone-soft);color:var(--tone);font-size:26px;font-weight:700}
.tone-progress .startup-symbol{box-sizing:border-box;border:3px solid var(--tone-soft);border-top-color:var(--tone);background:none;animation:startup-spin 1s linear infinite}
@keyframes startup-spin{to{transform:rotate(1turn)}}
@media (prefers-reduced-motion:reduce){.tone-progress .startup-symbol{animation:none}}
.startup-status h1{font-size:24px;letter-spacing:-.4px;margin:0 0 10px}
.startup-status p{margin:0;color:var(--muted);line-height:1.6;font-size:14px}
.startup-account{margin:0;padding:6px 12px;border-radius:999px;background:var(--surface);border:1px solid var(--border);font-size:13px}
.startup-code{margin:0;font-size:13px;color:var(--muted)}.startup-code strong{display:block;margin-top:6px;font-size:26px;letter-spacing:4px;color:var(--text);font-family:ui-monospace,Menlo,monospace}
.startup-facts{width:100%;margin:0;display:grid;border:1px solid var(--border);border-radius:11px;background:var(--surface);text-align:left}
.startup-facts div{display:flex;justify-content:space-between;gap:16px;padding:11px 16px;font-size:13px}.startup-facts div+div{border-top:1px solid var(--border)}
.startup-facts dt{flex:none;color:var(--muted);white-space:nowrap}.startup-facts dd{margin:0;text-align:right;font-weight:550}.fact-bad{color:var(--bad)}.fact-ok{color:var(--ok)}.fact-muted{color:var(--text)}
.startup-actions{width:100%;display:grid;gap:10px;margin-top:6px}
.startup-actions label{display:grid;gap:6px;text-align:left;font-size:13px;font-weight:550}
.startup-actions input{width:100%;box-sizing:border-box;padding:13px 14px;border:1px solid var(--border);border-radius:9px;background:var(--surface);color:inherit;font:inherit;font-size:15px}
.startup-primary,.startup-secondary{min-height:50px;font-size:15px;white-space:normal}
.startup-primary{background:var(--tone);color:var(--on-accent,var(--bg))}
.startup-detail{width:100%;text-align:left;font-size:12px;color:var(--muted)}.startup-detail summary{cursor:pointer}.startup-detail code{display:block;margin-top:8px;padding:10px;border-radius:7px;background:var(--surface);border:1px solid var(--border);white-space:pre-wrap}
</style>
