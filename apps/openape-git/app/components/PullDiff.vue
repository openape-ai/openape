<script setup lang="ts">
import { commentsByAnchor } from '~/utils/git-ui'
import { formatDate } from '~/utils/repo-browse'

interface DiffLine {
  type: 'add' | 'del' | 'ctx' | 'hunk'
  text: string
  oldLine: number | null
  newLine: number | null
}

interface DiffFile {
  path: string
  oldPath: string | null
  binary: boolean
  additions: number
  deletions: number
  lines: DiffLine[]
}

interface Comment {
  id: string
  authorEmail: string
  body: string
  path: string | null
  line: number | null
  createdAt: number
}

const props = defineProps<{
  files: DiffFile[]
  comments: Comment[]
}>()

const emit = defineEmits<{ comment: [path: string, line: number] }>()

const LINE_CLASS: Record<DiffLine['type'], string> = {
  add: 'bg-emerald-950/50 text-emerald-200',
  del: 'bg-red-950/40 text-red-200',
  ctx: 'text-zinc-300',
  hunk: 'bg-zinc-900 text-zinc-500',
}

const SIGN: Record<DiffLine['type'], string> = { add: '+', del: '-', ctx: ' ', hunk: '' }

const anchored = computed(() => commentsByAnchor(props.comments))

function commentsFor(path: string, line: number | null): Comment[] {
  return line === null ? [] : anchored.value.get(`${path}:${line}`) ?? []
}
</script>

<template>
  <section
    v-for="file in files"
    :key="file.path"
    class="border border-zinc-800 rounded-lg overflow-hidden"
  >
    <header class="flex items-center gap-2 px-3 py-2 bg-zinc-900/60 text-sm">
      <UIcon name="i-lucide-file-diff" class="size-4 text-zinc-500 shrink-0" />
      <code class="font-mono truncate">
        <span v-if="file.oldPath" class="text-zinc-500">{{ file.oldPath }} → </span>{{ file.path }}
      </code>
      <span class="ml-auto font-mono text-xs shrink-0">
        <span class="text-emerald-500">+{{ file.additions }}</span>
        <span class="text-red-500 ml-1.5">-{{ file.deletions }}</span>
      </span>
    </header>

    <p v-if="file.binary" class="px-3 py-2 text-sm text-zinc-500">
      Binary file not shown.
    </p>

    <div v-else class="overflow-x-auto">
      <table class="w-full font-mono text-xs border-collapse">
        <tbody>
          <template v-for="(line, index) in file.lines" :key="index">
            <tr class="group" :class="LINE_CLASS[line.type]">
              <td class="w-10 px-2 text-right text-zinc-600 select-none align-top">
                {{ line.oldLine ?? '' }}
              </td>
              <td class="w-10 px-2 text-right text-zinc-600 select-none align-top">
                {{ line.newLine ?? '' }}
              </td>
              <td class="w-6 text-center align-top">
                <button
                  v-if="line.newLine !== null"
                  type="button"
                  class="opacity-0 group-hover:opacity-100 text-amber-500"
                  :title="`Comment on line ${line.newLine}`"
                  @click="emit('comment', file.path, line.newLine)"
                >
                  +
                </button>
              </td>
              <td class="pr-3 whitespace-pre-wrap break-all">
                {{ SIGN[line.type] }}{{ line.text }}
              </td>
            </tr>
            <tr v-for="comment in commentsFor(file.path, line.newLine)" :key="comment.id">
              <td colspan="4" class="px-3 py-2 bg-zinc-900/80 border-y border-zinc-800">
                <p class="text-[11px] text-zinc-500">
                  {{ comment.authorEmail }} · {{ formatDate(comment.createdAt) }}
                </p>
                <p class="text-xs text-zinc-200 whitespace-pre-wrap font-sans mt-0.5">
                  {{ comment.body }}
                </p>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </section>
</template>
