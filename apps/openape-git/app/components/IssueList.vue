<script setup lang="ts">
import type { IssueRecord } from '../../shared/issue-types'
import { issueDate } from '../utils/issue-ui'

defineProps<{ issues: IssueRecord[], total: number, loading: boolean }>()
</script>

<template>
  <section class="border border-zinc-800 rounded-lg overflow-hidden" aria-label="Issue results" :aria-busy="loading">
    <header class="px-4 py-3 bg-zinc-900 border-b border-zinc-800 text-sm text-zinc-400" aria-live="polite">
      {{ loading ? 'Loading issues…' : `${total} ${total === 1 ? 'issue' : 'issues'}` }}
    </header>
    <p v-if="!loading && !issues.length" class="p-10 text-center text-zinc-400">
      No issues match these filters.
    </p>
    <ul class="divide-y divide-zinc-800">
      <li v-for="issue in issues" :key="issue.id" class="flex gap-3 p-4 hover:bg-zinc-900/50">
        <UIcon :name="issue.state === 'open' ? 'i-lucide-circle-dot' : 'i-lucide-circle-check'" class="size-5 shrink-0 mt-0.5" :class="issue.state === 'open' ? 'text-emerald-400' : 'text-violet-400'" />
        <div class="min-w-0 flex-1">
          <div class="flex gap-2 flex-wrap items-center">
            <NuxtLink :to="issue.repositoryUrl || issue.stableUrl" class="font-semibold break-words hover:text-amber-500">
              {{ issue.title }}
            </NuxtLink>
            <UBadge v-for="label in issue.labels" :key="label.id" color="neutral" variant="outline">
              {{ label.name }}
            </UBadge>
          </div>
          <p class="text-xs text-zinc-500 mt-2 break-words">
            {{ issue.state }} · <span v-if="issue.number">#{{ issue.number }} · </span>
            <span v-if="issue.capabilities.repository">{{ issue.capabilities.repository.owner }}/{{ issue.capabilities.repository.name }} · </span>
            {{ issue.productName }} · {{ issue.imported?.label || issue.authorSubject || 'Unknown author' }} · {{ issueDate(issue.createdAt) }}
          </p>
        </div>
      </li>
    </ul>
  </section>
</template>
