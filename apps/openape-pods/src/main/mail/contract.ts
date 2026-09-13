export interface MailScope { account: string, folders: string[], attachments: boolean }
export interface MailRead { operation: 'messages' | 'attachments' | 'attachment', folder: string, message?: string, attachment?: string, cursor?: string }
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 2048 && !/[\0\r\n/\\]/.test(value) && !['.', '..'].includes(value)

export function parseMailRequest(value: unknown, scope: MailScope): { read: MailRead, argv: string[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid mail tool request')
  const request = value as Record<string, unknown>
  if (Object.keys(request).some(key => !['toolId', 'argv'].includes(key)) || request.toolId !== 'o365-mail' || !Array.isArray(request.argv) || request.argv.length > 17 || request.argv.some(item => typeof item !== 'string' || item.length > 16384 || /[\0\r\n]/.test(item))) throw new Error('Invalid mail tool arguments')
  const argv = request.argv as string[]
  if (JSON.stringify(argv.slice(0, 3)) !== JSON.stringify(['o365-cli', 'pods', 'read']) || argv.length % 2 !== 1) throw new Error('Only the assigned read command is available')
  const flags: Record<string, string> = {}
  for (let index = 3; index < argv.length; index += 2) {
    const flag = argv[index].slice(2)
    if (!argv[index].startsWith('--') || !['operation', 'account', 'folder', 'message', 'attachment', 'cursor'].includes(flag) || flag in flags) throw new Error('Unsupported or duplicate mail argument')
    flags[flag] = argv[index + 1]
  }
  if (flags.account !== scope.account || !identifier(flags.folder) || !scope.folders.includes(flags.folder)) throw new Error('Mail account or folder is outside this pod assignment')
  if (!['messages', 'attachments', 'attachment'].includes(flags.operation)) throw new Error('Only non-mutating mail reads are assigned')
  if (flags.operation !== 'messages' && (!scope.attachments || !identifier(flags.message))) throw new Error('Message attachments are not assigned')
  if (flags.operation === 'messages' && (flags.message || flags.attachment)) throw new Error('Unexpected message read arguments')
  if (flags.operation === 'attachments' && flags.attachment) throw new Error('Unexpected attachment id')
  if (flags.operation === 'attachment' && (!identifier(flags.attachment) || flags.cursor)) throw new Error('Invalid attachment read')
  return { argv: [...argv], read: { operation: flags.operation as MailRead['operation'], folder: flags.folder, ...(flags.message ? { message: flags.message } : {}), ...(flags.attachment ? { attachment: flags.attachment } : {}), ...(flags.cursor ? { cursor: flags.cursor } : {}) } }
}
