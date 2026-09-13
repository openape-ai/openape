import type { PodIdentityReference } from '../connections/agent'
import type { MailAssignment } from './service'
import type { PodResource } from '../../contracts/resources'

export function assignedMail(resources: PodResource[]): { mail: MailAssignment, identity: PodIdentityReference } {
  const mail = resources.find(resource => resource.kind === 'tool' && resource.state === 'ready' && resource.configuration.capability === 'mail.read')?.configuration
  const identity = resources.find(resource => resource.kind === 'connection' && resource.state === 'ready' && resource.configuration.provider === 'openape')?.configuration.identity as PodIdentityReference | undefined
  if (!mail || typeof mail.account !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(mail.account) || !Array.isArray(mail.folders) || !mail.folders.length || mail.folders.length > 100 || mail.folders.some(id => typeof id !== 'string' || !id || id.length > 2048 || /[\0\r\n/\\]/.test(id)) || typeof mail.attachments !== 'boolean' || typeof mail.connectionId !== 'string' || !/^[a-f0-9-]{36}$/.test(mail.connectionId) || !mail.grants || typeof mail.grants !== 'object' || Array.isArray(mail.grants)) throw new Error('Mail tool is not completely assigned')
  for (const [operation, grant] of Object.entries(mail.grants)) {
    if (!['messages', 'attachments', 'attachment'].includes(operation) || typeof grant !== 'string' || !/^[\w-]{1,128}$/.test(grant)) throw new Error('Invalid assigned mail grant')
  }
  if (!identity || ![identity.connectionId, identity.podId].every(id => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id)) || ![identity.issuer, identity.owner, identity.subject, identity.keyId].every(value => typeof value === 'string' && value.length > 0 && value.length < 2048)) throw new Error('Pod agent identity is not connected')
  const connection = resources.find(resource => resource.kind === 'connection' && resource.state === 'ready' && resource.configuration.connectionId === mail.connectionId && resource.configuration.provider === 'microsoft')
  if (!connection || connection.configuration.account !== mail.account) throw new Error('Microsoft connection is missing or belongs to another account')
  return { mail: { account: mail.account, folders: mail.folders as string[], attachments: mail.attachments, connectionId: mail.connectionId, grants: mail.grants as MailAssignment['grants'] }, identity }
}
