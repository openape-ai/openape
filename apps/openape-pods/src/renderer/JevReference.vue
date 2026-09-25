<script lang="ts">
import { defineComponent } from 'vue'
import { t } from './i18n'

const example = `const result = await context.jev.evaluate({
  state: "A customer asks for a refund",
  questions: {
    refund: { type: "noul", instructions: "Is a refund requested?" }
  }
})
const probability = result.answers.refund.noul`
export default defineComponent({ data() { return { example } }, methods: { t } })
</script>

<template>
  <details class="jev-reference">
    <summary>{{ t('Jev script reference') }}</summary>
    <p>{{ t('Assign Jev in Permissions and declare jev.evaluate in script capabilities. No API key belongs in your script.') }}</p>
    <pre><code>{{ example }}</code></pre>
    <p>{{ t('Choice and Score include confidence. Noul returns a probability. Define an explicit review path for uncertain results.') }}</p>
  </details>
</template>

<style scoped>
.jev-reference{margin:16px 0}pre{max-width:100%;overflow:auto;padding:12px;background:#81908318;font-size:13px}p{overflow-wrap:anywhere}
</style>
