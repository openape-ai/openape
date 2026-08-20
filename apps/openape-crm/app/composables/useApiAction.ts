import { problemMessage } from '../utils/problem-message'

/**
 * Jede schreibende Aktion läuft hier durch: Erfolg wird quittiert, ein Fehler
 * wird sichtbar statt still verschluckt. Der Rückgabewert ist `null`, wenn es
 * schiefging — der Aufrufer bricht dann ab, statt weiterzumachen.
 */
export function useApiAction() {
  const toast = useToast()

  async function run<T>(action: () => Promise<T>, opts: { success?: string, failure?: string } = {}): Promise<T | null> {
    try {
      const result = await action()
      if (opts.success) toast.add({ title: opts.success, color: 'success' })
      return result
    }
    catch (error) {
      const { title, detail } = problemMessage(error, opts.failure)
      toast.add({ title, description: detail, color: 'error' })
      return null
    }
  }

  return { run }
}
