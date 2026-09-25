<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import type { PodRunPresentation } from '../utils/pod-run-grant'

export default defineComponent({
  props: { pod: { type: Object as PropType<PodRunPresentation>, required: true }, german: { type: Boolean, default: false } },
  emits: ['language'],
})
</script>

<template>
  <section class="rounded-lg border border-primary/30 bg-primary/5 p-5 space-y-4">
    <div class="flex items-center justify-between gap-3">
      <h2 class="text-xl font-semibold">
        {{ pod.name }}
      </h2><button type="button" class="text-xs underline" @click="$emit('language', !german)">
        {{ german ? 'English' : 'Deutsch' }}
      </button>
    </div>
    <p class="font-medium">
      {{ german ? 'Gespeichertes Pod-Skript ausführen' : 'Run the stored Pod script' }}
    </p>
    <p>{{ german ? 'Erlaubt diesem Pod, seine gespeicherten Skripte innerhalb der separat vergebenen Zugriffsrechte auszuführen. Skriptänderungen benötigen keine erneute Ausführungserlaubnis.' : 'Allows this Pod to execute its stored scripts within its separately assigned permissions. Script changes do not require a new execution permission.' }}</p>
    <p class="text-sm text-muted">
      {{ german ? 'Eine dauerhafte Freigabe gilt bis zum Widerruf. Sie aktiviert keinen Zeitplan und erlaubt keine beliebigen Shell-Befehle.' : 'Continuing permission lasts until revoked. It does not enable a schedule or authorize arbitrary shell commands.' }}
    </p>
    <dl class="space-y-2 text-sm">
      <div>
        <dt class="text-muted">
          {{ german ? 'Skript' : 'Script' }}
        </dt><dd class="font-mono break-all">
          {{ pod.script }}
        </dd>
      </div><div>
        <dt class="text-muted">
          {{ german ? 'Arbeitsverzeichnis' : 'Working directory' }}
        </dt><dd class="font-mono break-all">
          {{ pod.workspace }}
        </dd>
      </div>
    </dl>
    <details>
      <summary class="cursor-pointer text-sm">
        {{ german ? 'Umgebungsvariablen anzeigen' : 'Show environment variables' }}
      </summary><dl class="mt-3 space-y-2 text-xs">
        <div v-for="(value, key) in pod.environment" :key="key">
          <dt class="font-mono font-semibold">
            {{ key }}
          </dt><dd class="font-mono break-all">
            {{ value }}
          </dd>
        </div>
      </dl><p class="mt-3 text-xs text-muted">
        {{ german ? 'Die angezeigten Pfade und Werte sind Angaben der anfragenden Anwendung. Geheimniswerte werden nicht angefordert.' : 'Paths and values are supplied by the requesting application. Secret values are not requested.' }}
      </p>
    </details>
  </section>
</template>
