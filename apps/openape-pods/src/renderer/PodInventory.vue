<script setup lang="ts">
import PodNavigation from './PodNavigation.vue'
import type { Organization } from '../contracts/groups'
import type { WorkspaceState, StoredPod  } from '../contracts/control'
import { computed, ref } from 'vue'
import type { WorkflowView } from '../contracts/workflows'
import { label, t } from './i18n'

const props = defineProps<{ pods: StoredPod[], workflows: WorkflowView, available: boolean, organization: Organization }>()
defineEmits<{ select: [id: string], create: [], updated: [state: WorkspaceState] }>()
const archived = ref(false)
const search = ref('')
const visible = computed(() => props.pods.filter(pod => (pod.lifecycle === 'archived') === archived.value && pod.name.toLowerCase().includes(search.value.toLowerCase())))
function memberships(id: string) { return props.workflows.workflows.filter(item => item.nodes.some(node => node.podId === id)).map(item => item.name).join(' · ') }
</script>

<template>
  <section class="pod-inventory">
    <header class="inventory-heading">
      <div>
        <h1>{{ t('Pods') }}</h1><p class="muted">
          {{ t('Every Pod has its own script, permissions and history.') }}
        </p>
      </div><button class="primary new-pod" :disabled="!available" @click="$emit('create')">
        {{ t('＋ New pod') }}
      </button>
    </header>
    <div class="inventory-toolbar">
      <div class="tabs" role="group" :aria-label="t('Pods')">
        <button :aria-pressed="!archived" @click="archived = false">
          {{ t('Current Pods') }} · {{ pods.filter(pod => pod.lifecycle !== 'archived').length }}
        </button><button :aria-pressed="archived" @click="archived = true">
          {{ t('Archived') }} · {{ pods.filter(pod => pod.lifecycle === 'archived').length }}
        </button>
      </div><input v-model="search" :aria-label="t('Search Pods')" :placeholder="t('Search Pods')" type="search">
    </div>
    <button v-for="pod in visible" :key="pod.id" class="inventory-row" @click="$emit('select', pod.id)">
      <span><strong>{{ pod.name }}</strong><small v-if="pod.description" class="inventory-purpose">{{ pod.description }}</small><small>{{ memberships(pod.id) || t('Standalone Pod') }}</small></span><span class="badge">{{ label(pod.lifecycle) }}</span><span aria-hidden="true">›</span>
    </button>
    <p v-if="!visible.length" class="muted">
      {{ archived ? t('No archived Pods') : t('No matching Pods') }}
    </p>
    <details class="inventory-groups">
      <summary>{{ t('Organize groups') }}</summary><PodNavigation :highlight="false" :pods="pods" pod-id="" :organization="organization" :available="available" @select="$emit('select', $event)" @updated="$emit('updated', $event)" />
    </details>
  </section>
</template>
