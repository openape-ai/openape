<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import type { ResourceCommand, ResourceState } from '../contracts/resources'
import { defaultJevModel, jevMaxAttempts } from '../contracts/jev'
import { t, label } from './i18n'

export default defineComponent({
  props: { state: { type: Object as PropType<ResourceState>, required: true }, podId: { type: String, required: true }, busy: Boolean },
  emits: { command: (_command: ResourceCommand) => true },
  data() { return { model: defaultJevModel, maxAttempts: jevMaxAttempts } },
  computed: { assignment() { return this.state.resources.find(item => item.configuration.type === 'jev' && item.state === 'ready') } },
  watch: {
    'assignment.id': { immediate: true, handler() { this.model = String(this.assignment?.configuration.model ?? defaultJevModel); this.maxAttempts = Number(this.assignment?.configuration.maxAttempts ?? jevMaxAttempts) } },
  },
  methods: {
    t, label,
    assign() {
      if (!this.state.jev || this.state.jev.state !== 'ready') return
      this.$emit('command', { type: 'assignJev', podId: this.podId, connectionId: this.state.jev.id, epoch: this.state.epoch, model: this.model, maxAttempts: this.maxAttempts })
    },
  },
})
</script>

<template>
  <section class="jev-permissions" :aria-label="t('Jev decisions')">
    <h3>{{ t('Jev decisions') }}</h3>
    <p>{{ t('The script sends its selected text to TypeSafe for classification, scoring or yes/no decisions.') }}</p>
    <p>{{ t('TypeSafe connection') }}: {{ state.jev ? label(state.jev.state) : t('Not connected') }}</p>
    <p v-if="assignment">
      {{ assignment.configuration.model }} · {{ assignment.configuration.maxAttempts }} {{ t('attempts per run') }}
    </p>
    <form v-if="state.jev?.state === 'ready'" @submit.prevent="assign">
      <label>{{ t('Pinned Jev model') }}<input v-model="model" required pattern="jev-\d+\.\d+\.\d+" :disabled="busy"></label>
      <label>{{ t('Maximum attempts per run') }}<input v-model.number="maxAttempts" type="number" min="1" max="100" required :disabled="busy"></label>
      <button class="primary" :disabled="busy">
        {{ t('Assign Jev to this Pod') }}
      </button>
    </form>
    <p v-else>
      {{ t('Connect TypeSafe in desktop Accounts, then assign it here.') }}
    </p>
    <button v-if="assignment" class="secondary" :disabled="busy" @click="$emit('command', { type: 'revoke', podId, id: assignment.id, revision: assignment.revision })">
      {{ t('Revoke access') }}
    </button>
    <p>{{ t('Assigning pauses this Pod. Validate its script before the next run.') }}</p>
  </section>
</template>

<style scoped>
.jev-permissions{border-top:1px solid #81908355;padding:16px 0;overflow-wrap:anywhere}form,label{display:grid;gap:8px}input{min-width:0;padding:10px;border:1px solid currentColor;border-radius:8px;font:inherit;background:transparent;color:inherit}button{justify-self:start;margin:12px 0}
</style>
