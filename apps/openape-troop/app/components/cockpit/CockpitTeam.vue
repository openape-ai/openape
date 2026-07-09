<script setup lang="ts">
import { onMounted, ref } from 'vue'

const props = defineProps<{ orgId: string, companyName: string }>()
const emit = defineEmits<{ close: [] }>()
const { team, error, load, add, patch, remove } = useCockpitTeam()
const label = ref('')
const tools = ref('')
const duties = ref('')
onMounted(() => load(props.orgId))

async function onAdd(): Promise<void> {
  const l = label.value.trim()
  if (!l) return
  await add({
    label: l,
    role: 'specialist',
    duties: duties.value.trim(),
    tools: tools.value.split(',').map(t => t.trim()).filter(Boolean),
  })
  if (!error.value) { label.value = ''; tools.value = ''; duties.value = '' }
}
</script>

<template>
  <div class="services-overlay" @click.self="emit('close')">
    <div class="services-panel">
      <header class="services-head">
        <span class="services-title">Team · {{ companyName }}</span>
        <button class="ghost" type="button" aria-label="Schließen" @click="emit('close')">
          ✕
        </button>
      </header>
      <p class="services-note">
        Rollen, an die dein CEO tool-pflichtige Aufgaben delegiert. Jede bekommt Aufgaben-Beschreibung +
        Werkzeuge (z.&nbsp;B. <code>o365-cli</code>); der reaktive Loop führt sie read-only unter deiner Identität aus.
      </p>
      <div class="services-list">
        <div v-for="a in team" :key="a.id" class="team-card">
          <div class="team-row">
            <label class="service-toggle">
              <input type="checkbox" :checked="a.enabled" @change="patch(a, { enabled: !a.enabled })">
              <span class="service-label">{{ a.label }} <span class="muted small">· {{ a.role }}</span></span>
            </label>
            <button class="ghost remove" type="button" aria-label="Entfernen" @click="remove(a.id)">
              ✕
            </button>
          </div>
          <div v-if="a.duties" class="team-duties">
            {{ a.duties }}
          </div>
          <div class="team-tools">
            <span v-for="t in a.tools" :key="t" class="tool-chip">{{ t }}</span>
            <span v-if="!a.tools.length" class="muted small">keine Werkzeuge</span>
          </div>
        </div>
        <p v-if="!team.length" class="muted small">
          Noch kein Team — leg unten das erste Blatt an.
        </p>
      </div>
      <form class="services-add team-add" @submit.prevent="onAdd">
        <input v-model="label" class="services-input" placeholder="Rolle, z. B. Mail-Beauftragter">
        <input v-model="tools" class="services-input" placeholder="Werkzeuge (Komma), z. B. o365-cli">
        <textarea v-model="duties" class="services-input team-duties-input" rows="2" placeholder="Aufgabe: was tut diese Rolle? (read-only)" />
        <button class="ghost" type="submit" :disabled="!label.trim()">
          Blatt hinzufügen
        </button>
      </form>
      <p v-if="error" class="services-error">
        {{ error }}
      </p>
    </div>
  </div>
</template>
