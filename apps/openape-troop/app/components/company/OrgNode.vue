<script setup lang="ts">
import { useI18n } from 'vue-i18n'

// The canonical employee shape, shared with the company page's editor. The card
// only renders label/tools/duties; `procedure` and `vars` travel through it to
// the edit form, so they live here instead of in a second copy of this type.
export interface Employee { id: string, role: string, label: string, duties: string, procedure: string, vars: Record<string, unknown>, tools: string[], enabled: boolean, reportsTo: string | null }
export interface TreeNode { e: Employee, children: TreeNode[] }

defineProps<{ node: TreeNode }>()
const emit = defineEmits<{ edit: [e: Employee], delete: [e: Employee], toggle: [e: Employee] }>()

// Imported rather than auto-imported: the layout test mounts this component
// outside Nuxt, where only a real vue-i18n plugin is in play.
const { t, te } = useI18n()
// A role the catalog does not know still has to name itself on the card.
function roleLabel(role: string): string {
  const key = `common.role.${role}`
  return te(key) ? t(key) : role
}
</script>

<template>
  <li>
    <div class="org-card" :class="node.e.role === 'ceo' ? 'is-ceo' : (node.e.enabled ? 'is-on' : 'is-off')" :title="node.e.duties">
      <div class="org-card-head">
        <UIcon v-if="node.e.role === 'ceo'" name="i-lucide-crown" class="size-3.5 text-amber-400 shrink-0" />
        <span class="org-name">{{ node.e.label }}</span>
      </div>
      <div class="org-role">
        {{ roleLabel(node.e.role) }}
      </div>
      <div v-if="node.e.tools.length" class="org-tools">
        {{ node.e.tools.join(' · ') }}
      </div>
      <div class="org-actions">
        <button type="button" :title="$t('common.edit')" @click="emit('edit', node.e)">
          <UIcon name="i-lucide-pencil" class="size-3.5" />
        </button>
        <button type="button" :title="node.e.enabled ? $t('orgChart.action.pause') : $t('orgChart.action.activate')" @click="emit('toggle', node.e)">
          <UIcon :name="node.e.enabled ? 'i-lucide-pause' : 'i-lucide-play'" class="size-3.5" />
        </button>
        <button type="button" :title="$t('common.remove')" class="danger" @click="emit('delete', node.e)">
          <UIcon name="i-lucide-trash-2" class="size-3.5" />
        </button>
      </div>
    </div>
    <ul v-if="node.children.length">
      <CompanyOrgNode v-for="c in node.children" :key="c.e.id" :node="c" @edit="emit('edit', $event)" @delete="emit('delete', $event)" @toggle="emit('toggle', $event)" />
    </ul>
  </li>
</template>

<style>
/* Classic pure-CSS org chart (nested ul/li with connector lines). */
.org-tree, .org-tree ul { list-style: none; margin: 0; padding: 0; }
/* Let the tree take its intrinsic width so the scroll container can reach all of
   it. Squeezed into a narrower parent, the centered flex rows below spill over
   BOTH edges — and everything left of the scroll origin is unreachable, which is
   how the team-lead and the first specialists went missing on a phone (#1086).
   min-width keeps it filling (and centered) whenever it does fit. */
.org-tree { width: max-content; min-width: 100%; }
.org-tree li { position: relative; }
.org-tree li::before, .org-tree li::after { content: ''; position: absolute; }

/* Wide screens: the classic side-by-side tree with elbow connectors. Kept behind
   a min-width query so the phone layout below needs no specificity fight with the
   :first-child / :only-child rules here. */
@media (min-width: 641px) {
  .org-tree ul { display: flex; justify-content: center; position: relative; padding-top: 22px; }
  .org-tree li { padding: 22px 10px 0; text-align: center; }
  .org-tree li::before, .org-tree li::after {
    top: 0; right: 50%; width: 50%; height: 22px; border-top: 1px solid #3f3f46;
  }
  .org-tree li::after { right: auto; left: 50%; border-left: 1px solid #3f3f46; }
  .org-tree li:only-child::before, .org-tree li:only-child::after { display: none; }
  .org-tree li:only-child { padding-top: 22px; }
  .org-tree li:first-child::before, .org-tree li:last-child::after { border: 0 none; }
  .org-tree li:last-child::before { border-right: 1px solid #3f3f46; }
  .org-tree ul ul::before {
    content: ''; position: absolute; top: 0; left: 50%;
    width: 0; height: 22px; border-left: 1px solid #3f3f46;
  }
}
/* node card */
.org-card {
  display: inline-flex; flex-direction: column; gap: 2px; align-items: center;
  min-width: 150px; max-width: 210px; padding: 8px 12px; border-radius: 10px;
  border: 1px solid #3f3f46; background: #18181b; position: relative;
}
.org-card.is-ceo { border-color: color-mix(in srgb, #f59e0b 55%, transparent); background: color-mix(in srgb, #f59e0b 12%, #18181b); }
.org-card.is-on { border-color: color-mix(in srgb, #8b5cf6 45%, transparent); background: color-mix(in srgb, #8b5cf6 10%, #18181b); }
.org-card.is-off { opacity: 0.6; }
.org-card-head { display: flex; align-items: center; gap: 5px; }
.org-name { font-size: 13.5px; font-weight: 600; color: #f4f4f5; }
.org-role { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #a1a1aa; }
.org-tools { font-size: 10.5px; color: #8b5cf6; font-family: ui-monospace, monospace; max-width: 190px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.org-actions { display: flex; gap: 2px; margin-top: 4px; opacity: 0; transition: opacity .12s; }
.org-card:hover .org-actions { opacity: 1; }
.org-actions button { padding: 3px; border-radius: 6px; color: #a1a1aa; }
.org-actions button:hover { background: #27272a; color: #e4e4e7; }
.org-actions button.danger:hover { color: #f87171; }

/* Phone: a side-by-side tree needs ~1000px, so on a 390px screen it can only ever
   show two cards. Below 640px the same markup becomes an indented tree — every
   card full width and readable, no horizontal scrolling at all. */
@media (max-width: 640px) {
  .org-tree { width: auto; min-width: 0; }
  .org-tree ul { display: block; padding-left: 15px; }
  .org-tree li { padding: 6px 0 0 15px; text-align: left; }
  /* Connectors become a spine down the left plus an elbow into each card. The
     spine stops at the elbow on the last child, so it doesn't dangle. */
  .org-tree li::before {
    left: 0; top: 0; bottom: 0; width: 0;
    border-left: 1px solid #3f3f46;
  }
  .org-tree li:last-child::before { bottom: auto; height: 34px; }
  .org-tree li::after {
    left: 0; top: 34px; width: 11px;
    border-top: 1px solid #3f3f46;
  }
  .org-tree > li { padding-left: 0; }
  .org-tree > li::before, .org-tree > li::after { display: none; }
  .org-card { display: flex; align-items: flex-start; width: 100%; min-width: 0; max-width: none; }
  .org-tools { max-width: 100%; }
  /* No hover on touch — the edit/pause/remove buttons would stay invisible. */
  .org-actions { opacity: 1; }
}
</style>
