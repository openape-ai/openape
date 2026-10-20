<script setup lang="ts">
import { computed } from 'vue'
import type { GrantWithCard } from '../utils/grant-card'
import { grantScope, grantScopeNote, grantValidity } from '../utils/grant-card'
import { grantSummaryView } from '../utils/grant-summary'
import { grantBatchPath } from '../utils/grant-batch'
import GrantClaims from './GrantClaims.vue'
import GrantIdentity from './GrantIdentity.vue'
import GrantTechnicalDetails from './GrantTechnicalDetails.vue'
import GrantRequestedMarker from './GrantRequestedMarker.vue'
import GrantRequestDate from './GrantRequestDate.vue'

const props = withDefaults(defineProps<{ grant: GrantWithCard, german: boolean, compact?: boolean, identity?: boolean, showValidity?: boolean, languageSwitch?: boolean, technical?: boolean }>(), { identity: true, showValidity: true, languageSwitch: true, technical: true })
defineEmits<{ language: [german: boolean] }>()
const language = computed(() => props.german ? 'de' as const : 'en' as const)
const summary = computed(() => grantSummaryView(props.grant.request.summary))
const scope = computed(() => grantScope(props.grant, language.value))
const note = computed(() => grantScopeNote(props.grant, language.value))
const fallback = computed(() => props.grant.card?.registry?.title[language.value] || (props.german ? 'Berechtigungsanfrage' : 'Permission request'))
const batchPath = computed(() => props.grant.request.batch ? grantBatchPath(props.grant.request.requester, props.grant.request.batch.id) : null)
</script>

<template>
  <section class="min-w-0 space-y-4" :class="compact ? 'text-sm' : 'rounded-lg border border-default bg-default p-5'" data-grant-card>
    <div class="flex min-w-0 items-start justify-between gap-3">
      <div class="min-w-0 flex-1">
        <GrantClaims v-if="summary" :request="grant.request" :german="german" :compact="compact" />
        <template v-else>
          <h2 class="text-xl font-semibold leading-tight break-words">
            {{ fallback }}<GrantRequestedMarker v-if="grant.card?.registry?.title.requested" :german="german" />
          </h2>
          <p class="mt-2 text-sm text-muted">
            {{ german ? 'Der Antragsteller hat keine Beschreibung angegeben.' : 'The requester supplied no description.' }}
          </p>
          <GrantClaims :request="grant.request" :german="german" />
        </template>
      </div>
      <button v-if="languageSwitch" type="button" class="shrink-0 text-xs underline" @click="$emit('language', !german)">
        {{ german ? 'English' : 'Deutsch' }}
      </button>
    </div>
    <GrantIdentity v-if="identity" :grant="grant" :german="german" />
    <GrantRequestDate :created-at="grant.created_at" :german="german" />
    <div class="space-y-1.5" data-bound-scope>
      <p class="text-xs text-muted">
        {{ german ? 'Angefragter Umfang' : 'Requested scope' }}
      </p>
      <p class="text-sm font-medium break-words">
        {{ scope }}
      </p>
      <p v-if="note" class="text-xs text-muted break-words">
        {{ note }}
      </p>
    </div>
    <p v-if="showValidity" class="text-sm" data-grant-validity>
      {{ german ? 'Gültigkeit' : 'Validity' }}: {{ grantValidity(grant, language) }}
    </p>
    <p v-if="grant.request.run_as" class="text-sm break-all">
      {{ german ? 'Ausführen als' : 'Run as' }}: {{ grant.request.run_as }}
    </p>
    <p v-if="grant.expires_at" class="text-xs text-muted">
      {{ german ? 'Gültig bis' : 'Valid until' }} {{ new Date(grant.expires_at * 1000).toLocaleString(german ? 'de-AT' : 'en-GB') }}
    </p>
    <a v-if="batchPath && !compact" :href="batchPath" class="block text-xs underline">{{ german ? 'Teil einer Sammelanfrage · Gemeinsam prüfen' : 'Part of a batch request · Review together' }}</a>
    <slot />
    <GrantTechnicalDetails v-if="technical" :grant="grant" :german="german" />
  </section>
</template>
