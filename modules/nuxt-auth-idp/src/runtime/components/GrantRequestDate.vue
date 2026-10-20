<script setup lang="ts">
const props = defineProps<{ createdAt: number, latestAt?: number, german: boolean }>()
function format(seconds: number) {
  return new Date(seconds * 1000).toLocaleString(props.german ? 'de-AT' : 'en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}
const iso = (seconds: number) => new Date(seconds * 1000).toISOString()
</script>

<template>
  <div class="text-xs text-muted space-y-1" data-grant-request-date>
    <template v-if="latestAt !== undefined && latestAt !== createdAt">
      <p>
        {{ german ? 'Älteste offene Anfrage' : 'Oldest pending request' }}:
        <time :datetime="iso(createdAt)">{{ format(createdAt) }}</time>
      </p>
      <p>
        {{ german ? 'Neueste offene Anfrage' : 'Newest pending request' }}:
        <time :datetime="iso(latestAt)">{{ format(latestAt) }}</time>
      </p>
    </template>
    <p v-else>
      {{ german ? 'Angefragt am' : 'Requested on' }}:
      <time :datetime="iso(createdAt)">{{ format(createdAt) }}</time>
    </p>
  </div>
</template>
