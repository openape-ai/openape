import type { PodIdentityReference } from '../connections/agent'

/** The Pod identity and recorded grant an SSH or Jev assignment was made with. */
export interface ProgramAuthority { identity: PodIdentityReference, ownerConnection: string, grantId: string }
