import type { SpClientState } from '@openape/cli-auth'
import { createProofClient } from '@openape/proof-cli'

export interface CrmState extends SpClientState {
  endpoint?: string
  /** Default workspace ULID. `workspaces use <id>` sets it. */
  activeWorkspaceId?: string
}

export const crmClient = createProofClient<CrmState>({
  endpoint: 'https://crm.openape.ai',
  envVar: 'APE_CRM_ENDPOINT',
  configFile: 'auth-crm.json',
  aud: 'crm.openape.ai',
})

export const { loadConfig, saveConfig, _request } = crmClient
