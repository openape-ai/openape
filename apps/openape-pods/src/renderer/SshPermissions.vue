<script lang="ts">
import { t, label } from './i18n'
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import type { ResourceState } from '../contracts/resources'
import { parseSshTarget } from '../contracts/ssh'
import type { SshBinding } from '../contracts/ssh'

export default defineComponent({
  props: { state: { type: Object as PropType<ResourceState>, required: true }, busy: Boolean, readOnly: Boolean },
  emits: ['assign', 'revoke'],
  data() { return { alias: '', jumps: '', error: '' } },
  computed: { targets() { return this.state.resources.filter(item => item.configuration.type === 'sshInventory') } },
  methods: {
    t, label,
    route(configuration: Record<string, unknown>) {
      const binding = configuration as unknown as SshBinding
      return binding.hosts.map(host => `${host.user}@${host.alias} (${host.hostname}:${host.port})`).join(' → ')
    },
    assign() {
      this.error = ''
      try { this.$emit('assign', parseSshTarget({ alias: this.alias.trim(), jumps: this.jumps.split(',').map(item => item.trim()).filter(Boolean), profile: 'linde-server-v1' })) }
      catch (error) { this.error = error instanceof Error ? error.message : 'Invalid SSH target' }
    },
  },
})
</script>

<template>
  <section :aria-label="t('SSH inventory')">
    <h3>{{ t('SSH inventory') }}</h3>
    <p class="muted">
      {{ t('Read fixed server observations using reviewed SSH targets. Commands and private keys are unavailable to scripts.') }}
    </p>
    <article v-for="resource in targets" :key="resource.id" class="resource-row">
      <div><strong>{{ resource.name }}</strong><p>{{ route(resource.configuration) }}</p><span>{{ label(resource.state) }} · {{ t('{p0} · revision {p1}', { p0: 'SSH', p1: resource.revision }) }} · {{ 'linde-server-v1' }}</span></div>
      <button :disabled="busy || resource.state === 'revoked'" @click="$emit('revoke', resource)">
        {{ t('Revoke SSH access') }}
      </button>
    </article>
    <p v-if="readOnly" class="muted">
      {{ t('Assign SSH targets on the desktop that holds the SSH keys.') }}
    </p>
    <form v-else @submit.prevent="assign">
      <label>{{ t('SSH configuration alias') }}<input v-model="alias" name="ssh-alias" required :disabled="busy"></label>
      <label>{{ t('Jump aliases, outermost first (comma separated)') }}<input v-model="jumps" name="ssh-jumps" :disabled="busy"></label>
      <button :disabled="busy">
        {{ t('Assign fixed inventory') }}
      </button>
    </form>
    <p v-if="error" role="alert">
      {{ error }}
    </p>
  </section>
</template>
