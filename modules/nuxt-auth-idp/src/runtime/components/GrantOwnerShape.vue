<script setup lang="ts">
import type { OwnerShapeCard } from '../utils/grant-card'

// A personal or domain shape resolved this grant (issues 1551, 1553): say
// which tier, who published which digest when and what it replaces, and show
// every operation the shape declares so an over-broad shape is noticed at
// approval time, not after.
const props = defineProps<{ shape: OwnerShapeCard, german: boolean }>()
const personal = props.shape.tier === 'personal'
const badge = personal
  ? (props.german ? 'Persönliches Shape · nicht IdP-weit' : 'Personal shape · not IdP-wide')
  : (props.german ? `Domain-Shape von ${props.shape.domain}` : `Domain shape of ${props.shape.domain}`)
const publisher = personal ? props.shape.owner : props.shape.published_by
const replaced = props.shape.overrides === 'instance'
  ? (props.german ? 'das IdP-weite Shape' : 'the IdP-wide shape')
  : (props.german ? 'das Domain-Shape' : 'the domain shape')
const shortDigest = (digest: string) => digest.replace(/^(sha256|SHA-256):/i, '').slice(0, 12)
const riskColor = (risk: string) => risk === 'high' || risk === 'critical' ? 'error' : risk === 'medium' ? 'warning' : 'success'
const published = props.shape.published_at === null
  ? null
  : new Date(props.shape.published_at * 1000).toLocaleDateString(props.german ? 'de-AT' : 'en-GB', { year: 'numeric', month: '2-digit', day: '2-digit' })
const byline = [
  publisher ? ` ${props.german ? 'veröffentlicht von' : 'published by'} ${publisher}` : '',
  published ? ` ${props.german ? 'am' : 'on'} ${published}` : '',
].join('')
</script>

<template>
  <div class="min-w-0 space-y-2 border-t border-default pt-3 text-sm" data-owner-shape>
    <UBadge color="warning" variant="subtle" size="sm" :label="badge" :data-shape-tier="shape.tier" />
    <p class="text-xs text-muted break-words">
      Shape <code>{{ shape.cli_id }}</code>{{ byline }} · Digest <code>{{ shortDigest(shape.digest) }}</code>
    </p>
    <p v-if="shape.overrides" class="text-xs text-warning break-words" data-shape-overrides>
      {{ personal
        ? (german ? `Ersetzt für dich ${replaced} für dieses Programm.` : `Replaces ${replaced} for this program, for you only.`)
        : (german ? `Ersetzt für ${shape.domain} ${replaced} für dieses Programm.` : `Replaces ${replaced} for this program, for ${shape.domain} only.`) }}
    </p>
    <p v-if="!shape.current" class="text-xs text-warning" data-owner-shape-stale>
      {{ german ? 'Dieses Shape wurde nach der Anfrage geändert oder entfernt.' : 'This shape changed or was removed after the request.' }}
    </p>
    <p class="text-xs text-muted">
      {{ german ? 'Das Shape deklariert' : 'The shape declares' }}
    </p>
    <ul class="space-y-1">
      <li
        v-for="operation in shape.operations"
        :key="operation.id"
        class="flex min-w-0 items-center justify-between gap-2 rounded border px-2 py-1"
        :class="operation.id === shape.operation_id ? 'border-primary bg-primary/10' : 'border-default'"
        :data-owner-shape-operation="operation.id"
        :data-requested="operation.id === shape.operation_id ? 'true' : undefined"
      >
        <span class="min-w-0 break-words">
          <code>{{ operation.id }}</code> · <span class="font-mono text-xs text-muted">{{ [shape.cli_id, ...operation.command].join(' ') }}</span>
          <span class="block text-xs">{{ operation.display }}</span>
        </span>
        <span class="flex shrink-0 gap-1">
          <UBadge color="neutral" variant="outline" size="xs" :label="operation.action" />
          <UBadge :color="riskColor(operation.risk)" variant="subtle" size="xs" :label="operation.risk" />
        </span>
      </li>
    </ul>
  </div>
</template>
