<script setup lang="ts">
import {
  addDays,
  addMonths,
  dayKey,
  eventsOnDay,
  isSameDay,
  isSameMonth,
  monthGridDays,
  monthTitle,
  startOfMonth,
  startOfWeekMonday,
  timeLabel,
  weekDays,
  weekdayLabels,
} from '#shared/calendar-view'
import { apiFetch } from '../utils/api'
import { problemMessage } from '../utils/problem-message'

interface EventRow {
  id: string
  subject: string
  start: string | null
  end: string | null
  web_url: string | null
  join_url: string | null
  location: string | null
  organizer: string | null
}

type CalView = 'month' | 'week'

const { user, fetchUser } = useOpenApeAuth()
const { status: graphStatus, reload: reloadGraph, connect } = useGraph()
const loading = ref(true)
const loadError = ref('')
const events = ref<EventRow[]>([])
const view = ref<CalView>('month')
const cursor = ref(startOfMonth(new Date()))
const today = new Date()
const selectedDay = ref(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())))

const viewItems = [
  { label: 'Monat', value: 'month' },
  { label: 'Woche', value: 'week' },
]

const title = computed(() => {
  if (view.value === 'week') {
    const days = weekDays(cursor.value)
    const a = days[0]!
    const b = days[6]!
    return `${a.getUTCDate()}.–${b.getUTCDate()}. ${monthTitle(a)}`
  }
  return monthTitle(cursor.value)
})

const gridDays = computed(() => view.value === 'month' ? monthGridDays(cursor.value) : weekDays(cursor.value))

const chipLimit = computed(() => view.value === 'month' ? 3 : 8)

const dayAgenda = computed(() => dayEvents(selectedDay.value))

const selectedDayLabel = computed(() => selectedDay.value.toLocaleDateString('de-AT', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
}))

onMounted(async () => {
  await fetchUser()
  if (!user.value) {
    await navigateTo('/')
    return
  }
  try {
    await reloadGraph()
    await reload()
  }
  catch (error) {
    loadError.value = problemMessage(error, 'Kalender konnte nicht geladen werden').title
  }
  finally {
    loading.value = false
  }
})

watch(() => graphStatus.value.connected, (ok) => {
  if (ok) void reload()
})

watch([cursor, view], () => {
  if (graphStatus.value.connected) void reload()
  if (view.value === 'month' && !isSameMonth(selectedDay.value, cursor.value)) {
    selectedDay.value = cursor.value
  }
})

async function reload() {
  if (!graphStatus.value.connected) {
    events.value = []
    return
  }
  const days = gridDays.value
  const start = days[0]!.toISOString()
  const end = addDays(days.at(-1)!, 1).toISOString()
  events.value = await apiFetch(`/api/graph/events?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`)
}

function shift(dir: -1 | 1) {
  cursor.value = view.value === 'month'
    ? addMonths(cursor.value, dir)
    : addDays(startOfWeekMonday(cursor.value), dir * 7)
}

function goToday() {
  cursor.value = view.value === 'month' ? startOfMonth(today) : startOfWeekMonday(today)
  selectedDay.value = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
}

function setView(next: string | number) {
  const value = String(next) as CalView
  view.value = value
  cursor.value = value === 'month' ? startOfMonth(cursor.value) : startOfWeekMonday(cursor.value)
}

function openEvent(ev: EventRow) {
  const url = ev.join_url || ev.web_url
  if (url) window.open(url, '_blank')
}

function dayEvents(day: Date) {
  return eventsOnDay(events.value, day)
}

function pickDay(day: Date) {
  selectedDay.value = day
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <header class="flex flex-wrap items-center gap-2 border-b border-[var(--crm-line)] px-3 py-2.5 sm:px-4">
      <h1 class="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight">
        {{ title }}
      </h1>
      <UTabs
        :items="viewItems"
        :content="false"
        :model-value="view"
        size="sm"
        class="w-36 shrink-0"
        @update:model-value="setView"
      />
      <div class="flex items-center gap-1">
        <UButton icon="i-lucide-chevron-left" color="neutral" variant="ghost" size="sm" aria-label="Zurück" @click="shift(-1)" />
        <UButton icon="i-lucide-calendar-check" color="neutral" variant="ghost" size="sm" class="sm:hidden" aria-label="Heute" @click="goToday" />
        <UButton label="Heute" color="neutral" variant="ghost" size="sm" class="hidden sm:inline-flex" @click="goToday" />
        <UButton icon="i-lucide-chevron-right" color="neutral" variant="ghost" size="sm" aria-label="Weiter" @click="shift(1)" />
      </div>
    </header>

    <div class="flex-1 overflow-auto p-2 sm:p-3">
      <p v-if="loadError" class="text-sm text-[var(--crm-rose)]">
        {{ loadError }}
      </p>
      <p v-else-if="!graphStatus.connected" class="p-4 text-sm text-[var(--crm-ink-3)]">
        Microsoft verbinden, um den Kalender zu laden.
        <UButton size="xs" class="ms-2" @click="connect">
          Verbinden
        </UButton>
      </p>
      <div v-else class="mx-auto flex h-full max-w-5xl flex-col gap-3">
        <div v-if="view === 'week'" class="space-y-2 md:hidden">
          <section
            v-for="day in gridDays"
            :key="dayKey(day)"
            class="rounded-[10px] border border-[var(--crm-line)] bg-[var(--crm-panel)] p-3"
            :class="{ 'ring-1 ring-[var(--crm-accent)]': isSameDay(day, today) }"
          >
            <div class="mb-2 flex items-center justify-between text-sm">
              <span class="font-medium">
                {{ day.toLocaleDateString('de-AT', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) }}
              </span>
              <span
                v-if="isSameDay(day, today)"
                class="rounded-full bg-[var(--crm-accent)] px-2 py-0.5 text-[10px] font-medium text-white"
              >
                Heute
              </span>
            </div>
            <div v-if="dayEvents(day).length" class="space-y-1">
              <button
                v-for="ev in dayEvents(day)"
                :key="ev.id"
                type="button"
                class="flex w-full items-start gap-2 rounded-md bg-[var(--crm-accent-soft)] px-2 py-1.5 text-left text-sm text-[var(--crm-accent-2)]"
                @click="openEvent(ev)"
              >
                <span class="w-12 shrink-0 text-[11px] text-[var(--crm-ink-3)]">{{ timeLabel(ev.start) || '—' }}</span>
                <span class="min-w-0 flex-1 truncate">{{ ev.subject }}</span>
              </button>
            </div>
            <p v-else class="text-xs text-[var(--crm-ink-3)]">
              Keine Termine
            </p>
          </section>
        </div>

        <template v-else>
          <div class="mb-1 grid grid-cols-7 gap-px text-center text-[11px] font-medium uppercase tracking-wide text-[var(--crm-ink-3)]">
            <div v-for="label in weekdayLabels()" :key="label" class="py-1">
              <span class="sm:hidden">{{ label.charAt(0) }}</span>
              <span class="hidden sm:inline">{{ label }}</span>
            </div>
          </div>
          <div
            class="grid grid-cols-7 grid-rows-6 gap-px overflow-hidden rounded-[10px] border border-[var(--crm-line)] bg-[var(--crm-line)] md:min-h-[28rem] md:flex-1"
          >
            <div
              v-for="day in gridDays"
              :key="dayKey(day)"
              class="flex min-h-[2.75rem] flex-col bg-[var(--crm-panel)] p-1 sm:min-h-[4.5rem] sm:p-1.5 md:min-h-0"
              :class="{
                'opacity-45': !isSameMonth(day, cursor),
                'ring-1 ring-inset ring-[var(--crm-accent)]': isSameDay(day, today) || isSameDay(day, selectedDay),
              }"
            >
              <button
                type="button"
                class="mb-0.5 flex w-full items-center justify-between gap-1"
                @click="pickDay(day)"
              >
                <span
                  class="grid size-6 place-items-center rounded-full text-[12px]"
                  :class="isSameDay(day, today) ? 'bg-[var(--crm-accent)] font-semibold text-white' : 'text-[var(--crm-ink-2)]'"
                >
                  {{ day.getUTCDate() }}
                </span>
                <span
                  v-if="dayEvents(day).length"
                  class="rounded-full bg-[var(--crm-accent-soft)] px-1 text-[9px] font-medium text-[var(--crm-accent-2)] md:hidden"
                >
                  {{ dayEvents(day).length }}
                </span>
              </button>
              <div class="hidden min-h-0 flex-1 flex-col gap-0.5 overflow-hidden md:flex">
                <button
                  v-for="ev in dayEvents(day).slice(0, chipLimit)"
                  :key="ev.id"
                  type="button"
                  class="truncate rounded bg-[var(--crm-accent-soft)] px-1 py-0.5 text-left text-[11px] leading-tight text-[var(--crm-accent-2)] hover:brightness-110"
                  :title="ev.subject"
                  @click="openEvent(ev)"
                >
                  <span v-if="timeLabel(ev.start)" class="text-[var(--crm-ink-3)]">{{ timeLabel(ev.start) }} </span>{{ ev.subject }}
                </button>
                <span
                  v-if="dayEvents(day).length > chipLimit"
                  class="px-1 text-[10px] text-[var(--crm-ink-3)]"
                >
                  +{{ dayEvents(day).length - chipLimit }} mehr
                </span>
              </div>
            </div>
          </div>

          <section class="rounded-[10px] border border-[var(--crm-line)] bg-[var(--crm-panel)] p-3 md:hidden">
            <h2 class="mb-2 text-sm font-semibold capitalize">
              {{ selectedDayLabel }}
            </h2>
            <div v-if="dayAgenda.length" class="space-y-1">
              <button
                v-for="ev in dayAgenda"
                :key="ev.id"
                type="button"
                class="flex w-full items-start gap-2 rounded-md bg-[var(--crm-accent-soft)] px-2 py-1.5 text-left text-sm text-[var(--crm-accent-2)]"
                @click="openEvent(ev)"
              >
                <span class="w-12 shrink-0 text-[11px] text-[var(--crm-ink-3)]">{{ timeLabel(ev.start) || '—' }}</span>
                <span class="min-w-0 flex-1 truncate">{{ ev.subject }}</span>
              </button>
            </div>
            <p v-else class="text-sm text-[var(--crm-ink-3)]">
              Keine Termine an diesem Tag.
            </p>
          </section>
        </template>

        <div v-if="view === 'week'" class="hidden md:flex md:flex-1 md:flex-col">
          <div class="mb-1 grid grid-cols-7 gap-px text-center text-[11px] font-medium uppercase tracking-wide text-[var(--crm-ink-3)]">
            <div v-for="label in weekdayLabels()" :key="`w-${label}`" class="py-1">
              {{ label }}
            </div>
          </div>
          <div
            class="grid flex-1 grid-cols-7 gap-px overflow-hidden rounded-[10px] border border-[var(--crm-line)] bg-[var(--crm-line)] md:min-h-[22rem]"
          >
            <div
              v-for="day in gridDays"
              :key="`desk-${dayKey(day)}`"
              class="flex min-h-0 flex-col bg-[var(--crm-panel)] p-1.5"
              :class="{ 'ring-1 ring-inset ring-[var(--crm-accent)]': isSameDay(day, today) }"
            >
              <div class="mb-1 flex items-center justify-between">
                <span
                  class="grid size-6 place-items-center rounded-full text-[12px]"
                  :class="isSameDay(day, today) ? 'bg-[var(--crm-accent)] font-semibold text-white' : 'text-[var(--crm-ink-2)]'"
                >
                  {{ day.getUTCDate() }}
                </span>
              </div>
              <div class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden">
                <button
                  v-for="ev in dayEvents(day).slice(0, chipLimit)"
                  :key="ev.id"
                  type="button"
                  class="truncate rounded bg-[var(--crm-accent-soft)] px-1 py-0.5 text-left text-[11px] leading-tight text-[var(--crm-accent-2)] hover:brightness-110"
                  :title="ev.subject"
                  @click="openEvent(ev)"
                >
                  <span v-if="timeLabel(ev.start)" class="text-[var(--crm-ink-3)]">{{ timeLabel(ev.start) }} </span>{{ ev.subject }}
                </button>
                <span
                  v-if="dayEvents(day).length > chipLimit"
                  class="px-1 text-[10px] text-[var(--crm-ink-3)]"
                >
                  +{{ dayEvents(day).length - chipLimit }} mehr
                </span>
              </div>
            </div>
          </div>
        </div>

        <p v-if="!loading && !events.length" class="py-6 text-center text-sm text-[var(--crm-ink-3)]">
          Keine Termine in diesem Zeitraum.
        </p>
      </div>
    </div>
  </div>
</template>
