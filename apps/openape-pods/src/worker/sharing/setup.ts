import type { PodDatabase } from '../storage/database'

// Imported source stays inert until the recipient finishes setup: no validation run, no activation.
export function assertImportSetupFinished(store: PodDatabase, podId: string): void {
  if (store.db.prepare('SELECT 1 FROM portable_import_pods p JOIN portable_imports i ON i.id=p.import_id WHERE p.pod_id=? AND i.state=\'committed\'').get(podId)) throw new Error('Finish the import setup before preparing, validating or activating this script')
}
