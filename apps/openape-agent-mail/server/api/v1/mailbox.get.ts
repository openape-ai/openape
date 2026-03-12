import { defineEventHandler } from 'h3'

export default defineEventHandler(async (event) => {
  const mailbox = event.context.mailbox

  return {
    id: mailbox.id,
    address: mailbox.address,
    totalSizeBytes: mailbox.totalSizeBytes,
    softCapBytes: mailbox.softCapBytes,
    messageCount: mailbox.messageCount,
    createdAt: mailbox.createdAt,
  }
})
