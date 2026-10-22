import { sweepApprovalPackages } from '../utils/vault-requests'

const SWEEP_EVERY_MS = 60 * 60 * 1000

/** Hourly: empty packages that can no longer be collected. */
export default defineNitroPlugin(() => {
  if (!useRuntimeConfig().vaultEnabled) return
  setInterval(() => {
    sweepApprovalPackages().catch(err => console.error('[vault] package sweep failed', err))
  }, SWEEP_EVERY_MS).unref()
})
