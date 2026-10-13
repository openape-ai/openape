import { rm } from 'node:fs/promises'

/** Automatic backups land next to the profile, outside the fixture root. */
export async function removeProfile(root: string) {
  await Promise.all([root, `${root} Backups`].map(path => rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })))
}
