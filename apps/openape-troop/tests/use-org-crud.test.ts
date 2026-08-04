// @vitest-environment happy-dom
import type { Mock } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useOrgCrud } from '../app/composables/useOrgCrud'
import { apiFetch } from '../app/utils/api'

// The composable talks to the server through this one helper; the test drives it
// instead of a real endpoint.
vi.mock('../app/utils/api', () => ({ apiFetch: vi.fn() }))
const fetched = apiFetch as unknown as Mock

interface Item { id: string, title: string }
interface ItemForm { title: string }

const COLLECTION = '/api/orgs/org-1/objectives'

function panel(orgId = 'org-1') {
  const id = ref(orgId)
  const crud = useOrgCrud<Item, ItemForm>({
    collection: () => `/api/orgs/${id.value}/objectives`,
    emptyForm: () => ({ title: '' }),
  })
  return { ...crud, orgId: id }
}

beforeEach(() => {
  fetched.mockReset()
  fetched.mockResolvedValue([])
})

describe('useOrgCrud', () => {
  it('loads the collection of the current org', async () => {
    fetched.mockResolvedValue([{ id: 'a', title: 'Ziel A' }])

    const { items, loading } = panel()
    await flushPromises()

    expect(fetched).toHaveBeenCalledWith(COLLECTION)
    expect(items.value).toEqual([{ id: 'a', title: 'Ziel A' }])
    expect(loading.value).toBe(false)
  })

  it('reloads when the org changes', async () => {
    const { orgId } = panel()
    await flushPromises()

    orgId.value = 'org-2'
    await flushPromises()

    expect(fetched).toHaveBeenLastCalledWith('/api/orgs/org-2/objectives')
  })

  it('surfaces a load failure instead of swallowing it', async () => {
    fetched.mockRejectedValue({ data: { statusMessage: 'Keine Berechtigung.' } })

    const { error, loading } = panel()
    await flushPromises()

    expect(error.value).toBe('Keine Berechtigung.')
    expect(loading.value).toBe(false)
  })

  it('falls back to a generic message when the server names none', async () => {
    fetched.mockRejectedValue(new Error('offline'))

    const { error } = panel()
    await flushPromises()

    expect(error.value).toBe('Laden fehlgeschlagen.')
  })

  it('posts a new row and closes the form', async () => {
    const { openAdd, submit, showForm } = panel()
    await flushPromises()
    fetched.mockResolvedValue({ id: 'new' })

    openAdd()
    const result = await submit({ title: 'Ziel B' })

    expect(fetched).toHaveBeenCalledWith(COLLECTION, { method: 'POST', body: { title: 'Ziel B' } })
    expect(result).toEqual({ id: 'new' })
    expect(showForm.value).toBe(false)
  })

  it('patches the row being edited', async () => {
    const { openEdit, submit, editingId } = panel()
    await flushPromises()

    openEdit('a', { title: 'Ziel A' })
    expect(editingId.value).toBe('a')
    await submit({ title: 'Ziel A+' })

    expect(fetched).toHaveBeenCalledWith(`${COLLECTION}/a`, { method: 'PATCH', body: { title: 'Ziel A+' } })
  })

  it('keeps the form open and shows why a save failed', async () => {
    const { openAdd, submit, showForm, formError, saving } = panel()
    await flushPromises()
    fetched.mockRejectedValue({ data: { statusMessage: 'Titel schon vergeben.' } })

    openAdd()
    const result = await submit({ title: 'Ziel B' })

    expect(result).toBeUndefined()
    expect(formError.value).toBe('Titel schon vergeben.')
    expect(showForm.value).toBe(true)
    expect(saving.value).toBe(false)
  })

  it('deletes a row and reloads', async () => {
    const { remove, busy } = panel()
    await flushPromises()

    await remove('a')

    expect(fetched).toHaveBeenCalledWith(`${COLLECTION}/a`, { method: 'DELETE', body: undefined })
    expect(fetched).toHaveBeenLastCalledWith(COLLECTION)
    expect(busy.a).toBe(false)
  })

  it('surfaces a failed delete instead of swallowing it', async () => {
    const { remove, error, busy } = panel()
    await flushPromises()
    fetched.mockRejectedValue({})

    await remove('a')

    expect(error.value).toBe('Löschen fehlgeschlagen.')
    expect(busy.a).toBe(false)
  })

  it('patches a row without opening the form', async () => {
    const { patch } = panel()
    await flushPromises()

    await patch('a', { status: 'done' })

    expect(fetched).toHaveBeenCalledWith(`${COLLECTION}/a`, { method: 'PATCH', body: { status: 'done' } })
  })

  it('surfaces a failed row patch instead of swallowing it', async () => {
    const { patch, error } = panel()
    await flushPromises()
    fetched.mockRejectedValue({})

    await patch('a', { status: 'done' })

    expect(error.value).toBe('Ändern fehlgeschlagen.')
  })
})
