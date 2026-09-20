import type { MailWorkflowConfiguration, WorkflowMail } from '../../contracts/mail-workflow'

export function protectedPartner(message: WorkflowMail, configuration: MailWorkflowConfiguration): boolean {
  const participants = [message.sender, ...message.participants].map(value => value.toLowerCase()).filter(value => value !== configuration.mailbox.toLowerCase())
  return configuration.protectedPartners.some(partner => participants.some(value => partner.kind === 'address' ? value === partner.value.toLowerCase() : value.split('@')[1] === partner.value.toLowerCase()))
}
export function classifyMail(message: WorkflowMail, configuration: MailWorkflowConfiguration, protectedConversation: boolean): { disposition: 'retain' | 'archive', reason: string } {
  if (protectedPartner(message, configuration) || protectedConversation) return { disposition: 'retain', reason: 'Protected communication partner or conversation' }
  if (message.hasAttachments || message.flagged || message.important) return { disposition: 'retain', reason: 'Attachment, flag or high importance requires human review' }
  const content = `${message.subject}\n${message.body}`
  if (/\b(?:invoice|rechnung|payment|zahlung|contract|vertrag|agreement|vereinbarung|security|sicherheit|password|passwort|verify|verification|deadline|frist|due|termin|action|handlungsbedarf|reply|antwort|urgent|dringend|confirm|bestätig|sign|unterschr|expire|ablauf|overdue|fällig|please|bitte|reminder|erinnerung|meeting|invite|einladung|must|müssen)\w*/i.test(content) || /\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b/.test(content)) return { disposition: 'retain', reason: 'Potential financial, legal, security, deadline or action content' }
  if (!message.listId || !message.conversation || !message.body.trim()) return { disposition: 'retain', reason: 'Personal or uncertain correspondence remains in the inbox' }
  const rule = configuration.rules.find(rule => rule.enabled && rule.sender.toLowerCase() === message.sender.toLowerCase() && rule.listId === message.listId && message.subject.startsWith(rule.subjectPrefix))
  return rule ? { disposition: 'archive', reason: `Owner rule ${rule.id}: exact sender, list identity and subject prefix` } : { disposition: 'retain', reason: 'No enabled owner archive rule matches' }
}
