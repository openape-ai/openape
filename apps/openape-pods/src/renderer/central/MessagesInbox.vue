<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { InboxMessage, InboxMessagesCommand } from '../../contracts/inbox'
import { t } from '../i18n'
import { ago } from '../utils/cadence'

/**
 * What Pods told the owner (`context.notify`), newest first. Messages only inform: the owner marks them
 * read or archives them; anything that needs an answer is an Entscheidung instead.
 */
const props = defineProps<{ messages: InboxMessage[], now: number }>()
const emit = defineEmits<{ mark: [command: InboxMessagesCommand], openPod: [id: string] }>()
const archive = ref(false)
const shown = computed(() => props.messages.filter(item => !!item.archived === archive.value).sort((a, b) => b.created - a.created))
const unread = computed(() => props.messages.filter(item => !item.archived && !item.read))
const archivedCount = computed(() => props.messages.filter(item => item.archived).length)
// Links come from Pod scripts; notify and the relay require https, and the view does not rely on that.
const safeLinks = (item: InboxMessage) => item.links.filter(link => URL.parse(link.url)?.protocol === 'https:')
// Bulk actions ask first and then apply only to the messages that were counted in the question,
// so a message arriving meanwhile is never marked unseen.
const bulk = ref<{ action: 'read' | 'archive', items: InboxMessage[] } | null>(null)
function askBulk(action: 'read' | 'archive') { bulk.value = { action, items: action === 'read' ? unread.value : shown.value } }
function applyBulk() {
  const request = bulk.value
  bulk.value = null
  // Archiving also marks read, so archived messages never count as unread.
  for (const item of request?.items ?? []) emit('mark', request!.action === 'read' ? { type: 'mark', id: item.id, read: true } : { type: 'mark', id: item.id, archived: true, ...(item.read ? {} : { read: true }) })
}
watch(archive, () => { bulk.value = null })
// Deleting cannot be undone, so it asks once inline before it leaves.
const confirming = ref<string | null>(null)
function remove(id: string) { confirming.value = null; emit('mark', { type: 'mark', id, deleted: true }) }
</script>

<template>
  <div class="messages-inbox">
    <div class="ctrls">
      <div class="seg" role="group" :aria-label="t('Messages')">
        <button :aria-pressed="!archive" @click="archive = false">
          {{ t('Inbox') }}
        </button><button :aria-pressed="archive" @click="archive = true">
          {{ t('Archive') }} <span v-if="archivedCount" class="count">{{ archivedCount }}</span>
        </button>
      </div>
      <span v-if="bulk" class="bulk-confirm" role="group" :aria-label="t('Confirm')">
        <span class="meta">{{ bulk.action === 'read' ? t('Mark all {count} messages as read?', { count: bulk.items.length }) : t('Archive all {count} messages?', { count: bulk.items.length }) }}</span>
        <button class="secondary" type="button" @click="applyBulk">
          {{ bulk.action === 'read' ? t('Mark as read') : t('Archive message') }}
        </button>
        <button class="link" type="button" @click="bulk = null">
          {{ t('Cancel') }}
        </button>
      </span>
      <template v-else>
        <button v-if="!archive && unread.length" class="link" type="button" @click="askBulk('read')">
          {{ t('Mark all as read ({count})', { count: unread.length }) }}
        </button>
        <button v-if="!archive && shown.length" class="link" type="button" @click="askBulk('archive')">
          {{ t('Archive all ({count})', { count: shown.length }) }}
        </button>
      </template>
    </div>
    <p v-if="!shown.length" class="messages-empty" role="status">
      {{ archive ? t('No archived messages.') : t('No messages. Pods report results here.') }}
    </p>
    <ul v-else class="list">
      <li v-for="item in shown" :key="item.id" class="item" :class="{ unread: !item.read }" :data-message="item.id">
        <div class="row">
          <span v-if="!item.read" class="dot" :title="t('Unread')" />
          <span class="subj">{{ item.title }}</span>
          <span class="meta when" :title="new Date(item.created).toLocaleString()">{{ ago(item.created, now) }}</span>
        </div>
        <div v-if="item.pod" class="row meta">
          <button class="link" type="button" @click="emit('openPod', item.pod.id)">
            {{ item.pod.name ?? t('Pod') }}
          </button>
          <span v-for="tag in item.pod.tags ?? []" :key="tag" class="tag">{{ tag }}</span>
        </div>
        <p class="message-body">
          {{ item.body }}
        </p>
        <div class="row actions">
          <a v-for="link in safeLinks(item)" :key="link.url + link.title" class="secondary" :href="link.url" target="_blank" rel="noopener noreferrer">{{ link.title }} ↗</a>
          <span class="spacer" />
          <template v-if="item.archived">
            <template v-if="confirming === item.id">
              <span class="meta">{{ t('Delete permanently?') }}</span>
              <button class="link danger" type="button" @click="remove(item.id)">
                {{ t('Delete') }}
              </button>
              <button class="link" type="button" @click="confirming = null">
                {{ t('Cancel') }}
              </button>
            </template>
            <button v-else class="link danger" type="button" @click="confirming = item.id">
              {{ t('Delete') }}
            </button>
          </template>
          <button v-else class="link" type="button" @click="emit('mark', { type: 'mark', id: item.id, read: !item.read })">
            {{ item.read ? t('Mark as unread') : t('Mark as read') }}
          </button>
          <button class="link" type="button" @click="emit('mark', { type: 'mark', id: item.id, archived: !item.archived, ...(item.read ? {} : { read: true }) })">
            {{ item.archived ? t('Move to inbox') : t('Archive message') }}
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>

<style>
.messages-inbox .ctrls{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;margin:10px 0}
.messages-inbox .seg{display:inline-flex;gap:2px;border:1px solid var(--border);border-radius:8px;padding:2px;background:var(--surface)}
.messages-inbox .seg button{font-size:13px;font-weight:500;color:var(--muted);border-radius:6px;padding:4px 10px}
.messages-inbox .seg button[aria-pressed="true"]{background:var(--tint);color:var(--accent);font-weight:600}
.messages-inbox .bulk-confirm{display:inline-flex;flex-wrap:wrap;gap:6px 12px;align-items:center;padding:4px 10px;border:1px solid var(--warn);background:var(--warn-soft);border-radius:8px}
.messages-inbox .bulk-confirm .secondary{padding:3px 10px;font-size:13px}
.messages-inbox .count{font-variant-numeric:tabular-nums;opacity:.7;margin-left:2px}
.messages-inbox .link{font-size:13px;color:var(--accent);padding:0;border:0;background:none}.messages-inbox .link.danger{color:var(--bad)}
.messages-inbox .list{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.messages-inbox .item{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px 16px;display:grid;gap:6px;min-width:0}
.messages-inbox .item.unread{border-left:3px solid var(--accent)}
.messages-inbox .row{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;min-width:0}
.messages-inbox .subj{font-weight:600;overflow-wrap:anywhere}.messages-inbox .item:not(.unread) .subj{font-weight:500}
.messages-inbox .dot{width:8px;height:8px;border-radius:50%;background:var(--accent);flex:none}
.messages-inbox .meta{font-size:13px;color:var(--muted)}.messages-inbox .when{margin-left:auto;font-size:12px;white-space:nowrap}
.messages-inbox .tag{font-size:12px;padding:0 8px;border-radius:10px;background:var(--tint);color:var(--muted)}
.messages-inbox .message-body{margin:0;white-space:pre-line;line-height:1.45;overflow-wrap:anywhere}
.messages-inbox .actions .secondary{padding:4px 10px;font-size:13px;text-decoration:none;color:var(--accent)}
.messages-inbox .actions .spacer{flex:1}
.messages-empty{padding:48px 16px;text-align:center;color:var(--muted);border:1px dashed var(--border);border-radius:8px}
</style>
