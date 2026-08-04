import type { Ref } from 'vue'
import { reactive, ref, watch } from 'vue'
import { apiFetch } from '../utils/api'

export interface OrgCrudOptions<TForm extends object> {
  /** Collection endpoint of the panel, e.g. `() => \`/api/cockpit/orgs/${props.orgId}/skills\``. */
  collection: () => string
  /** Field values a fresh form starts with. Also the reset used by `openAdd`. */
  emptyForm: () => TForm
}

export interface SubmitOptions {
  /** Keep the form open after a successful save (panels that show a result). */
  closeForm?: boolean
  /** Message shown when the server sends no `statusMessage`. */
  fallbackError?: string
}

function errorMessage(err: unknown, fallback: string): string {
  return (err as { data?: { statusMessage?: string } })?.data?.statusMessage || fallback
}

/**
 * The list + form skeleton every company panel repeats: load the collection for
 * the current org, add or edit a row through one form, patch and delete rows.
 *
 * Failures are always visible — `error` carries load and row failures, `formError`
 * the ones the open form caused. Nothing is swallowed.
 */
export function useOrgCrud<TItem extends { id: string }, TForm extends object>(options: OrgCrudOptions<TForm>) {
  const items = ref([]) as Ref<TItem[]>
  const loading = ref(true)
  const error = ref('')
  const busy = reactive<Record<string, boolean>>({})

  const showForm = ref(false)
  const editingId = ref('')
  const saving = ref(false)
  const formError = ref('')
  const form = reactive(options.emptyForm()) as TForm

  async function load(): Promise<void> {
    loading.value = true
    error.value = ''
    try {
      items.value = await apiFetch<TItem[]>(options.collection())
    }
    catch (err) {
      error.value = errorMessage(err, 'Laden fehlgeschlagen.')
    }
    finally {
      loading.value = false
    }
  }

  function openAdd(): void {
    editingId.value = ''
    Object.assign(form, options.emptyForm())
    formError.value = ''
    showForm.value = true
  }

  function openEdit(id: string, values: TForm): void {
    editingId.value = id
    Object.assign(form, values)
    formError.value = ''
    showForm.value = true
  }

  /**
   * POST to the collection, or PATCH the row named by `editingId`. Returns the
   * server response on success and `undefined` when the call failed — `formError`
   * then holds the reason.
   */
  async function submit<TResult = TItem>(body: Record<string, unknown>, opts: SubmitOptions = {}): Promise<TResult | undefined> {
    const editing = editingId.value
    saving.value = true
    formError.value = ''
    try {
      const url = editing ? `${options.collection()}/${editing}` : options.collection()
      const result = await apiFetch<TResult>(url, { method: editing ? 'PATCH' : 'POST', body })
      if (opts.closeForm !== false) showForm.value = false
      await load()
      return result
    }
    catch (err) {
      formError.value = errorMessage(err, opts.fallbackError ?? 'Speichern fehlgeschlagen.')
      return undefined
    }
    finally {
      saving.value = false
    }
  }

  async function rowRequest(id: string, method: 'PATCH' | 'DELETE', body: Record<string, unknown> | undefined, fallback: string): Promise<void> {
    busy[id] = true
    error.value = ''
    try {
      await apiFetch(`${options.collection()}/${id}`, { method, body })
      await load()
    }
    catch (err) {
      error.value = errorMessage(err, fallback)
    }
    finally {
      busy[id] = false
    }
  }

  const patch = (id: string, body: Record<string, unknown>) => rowRequest(id, 'PATCH', body, 'Ändern fehlgeschlagen.')
  const remove = (id: string) => rowRequest(id, 'DELETE', undefined, 'Löschen fehlgeschlagen.')

  watch(options.collection, load, { immediate: true })

  return { items, loading, error, busy, showForm, editingId, saving, formError, form, load, openAdd, openEdit, submit, patch, remove }
}
