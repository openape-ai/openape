export interface IdPConfig {
  issuer: string
  adminEmails?: string[]
  managementToken?: string
  sessionSecret?: string
}

let _config: IdPConfig | null = null

export function getIdPConfig(): IdPConfig {
  if (!_config) {
    const rc = useRuntimeConfig()
    const adminEmails = ((rc.adminEmails as string) || '').split(',').map(e => e.trim()).filter(Boolean)
    _config = {
      issuer: (rc.issuer as string).trim(),
      managementToken: (rc.managementToken as string)?.trim() || undefined,
      sessionSecret: (rc.sessionSecret as string)?.trim() || undefined,
      adminEmails: adminEmails.length > 0 ? adminEmails : undefined,
    }
  }
  return _config
}
