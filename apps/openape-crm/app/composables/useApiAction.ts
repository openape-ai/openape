import { problemMessage } from '../utils/problem-message'

/**
 * Every write goes through here: success is acknowledged, a failure becomes
 * visible instead of being swallowed. The return value is `null` when it went
 * wrong, so the caller stops rather than carrying on.
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
