<script setup lang="ts">
import { onMounted, ref } from 'vue'

const emit = defineEmits<{ close: [] }>()
const { services, error, load, add, remove, toggle } = useCockpitServices()
const url = ref('')
onMounted(load)

async function onAdd(): Promise<void> {
  const v = url.value.trim()
  if (!v) return
  await add(v)
  if (!error.value) url.value = ''
}
</script>

<template>
  <div class="services-overlay" @click.self="emit('close')">
    <div class="services-panel">
      <header class="services-head">
        <span class="services-title">Services</span>
        <button class="ghost" type="button" aria-label="Schließen" @click="emit('close')">
          ✕
        </button>
      </header>
      <p class="services-note">
        Dein reaktiver Loop (<code>/loop /troop-cockpit-ceo</code>) betreut diese Queues zusätzlich zum Cockpit.
      </p>
      <div class="services-list">
        <div class="service home">
          <span class="service-label">troop Cockpit <span class="muted">· dein Zuhause</span></span>
          <span class="muted small">immer aktiv</span>
        </div>
        <div v-for="s in services" :key="s.id" class="service">
          <label class="service-toggle">
            <input type="checkbox" :checked="s.enabled" @change="toggle(s)">
            <span class="service-label">{{ s.label }}</span>
          </label>
          <button class="ghost remove" type="button" aria-label="Entfernen" @click="remove(s.id)">
            ✕
          </button>
        </div>
      </div>
      <form class="services-add" @submit.prevent="onAdd">
        <input v-model="url" class="services-input" type="url" inputmode="url" placeholder="https://service.example.com">
        <button class="ghost" type="submit" :disabled="!url.trim()">
          Hinzufügen
        </button>
      </form>
      <p v-if="error" class="services-error">
        {{ error }}
      </p>
    </div>
  </div>
</template>
