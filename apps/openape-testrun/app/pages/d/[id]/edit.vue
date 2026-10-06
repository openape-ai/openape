<script setup lang="ts">
import type { SourcePlan } from '../../../components/PlanSourceEditor.vue'
import PlanSourceEditor from '../../../components/PlanSourceEditor.vue'

const route = useRoute()
const { data, error } = await useFetch<SourcePlan>(() => `/api/plans-compat/plans/${route.params.id}`)
useSeoMeta({ title: 'Edit plan source', robots: 'noindex, nofollow' })
</script>

<template>
  <PlanSourceEditor v-if="data" :plan="data" />
  <main v-else>
    <h1>Plan unavailable</h1><p>{{ error?.statusCode === 401 ? 'Sign in to edit this plan.' : 'Check your access and the latest document version.' }}</p><NuxtLink to="/reports">
      Reports
    </NuxtLink>
  </main>
</template>
