<script setup lang="ts">
import { computed } from 'vue'
import type { PushState } from '../inbox/push'
import { t } from '../inbox/i18n'

const props = defineProps<{ state: PushState, busy: boolean, online: boolean }>()
defineEmits<{ toggle: [] }>()
const text = computed(() => ({ on: t('settingsPushOn'), off: t('settingsPushOff'), denied: t('settingsPushDenied'), unavailable: t('settingsPushUnavailable') })[props.state])
</script>

<template>
  <div class="push-setting">
    <p>{{ text }}</p>
    <button v-if="online && (state === 'on' || state === 'off')" type="button" :class="{ secondary: state === 'on' }" :disabled="busy" @click="$emit('toggle')">
      {{ state === 'on' ? t('settingsPushDisable') : t('settingsPushEnable') }}
    </button>
  </div>
</template>

<style scoped>
.push-setting p { margin: 0; }
.push-setting button { width: 100%; margin-top: 8px; }
</style>
