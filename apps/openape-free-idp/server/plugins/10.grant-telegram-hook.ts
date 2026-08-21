// Third leg of the grant-pending fan-out (#1292), next to push (08) and mail
// (09): the channel the owner is in all day anyway, with the same one-tap
// approval link. Push and mail stay untouched — a silent failure in one
// channel then shows up in the others.

import { countPendingForApprover, resolveApprover } from '../utils/approver'
import { createGrantMailDebouncer } from '../utils/grant-mail'
import { GRANT_TELEGRAM_COOLDOWN_MS, notifyApproverOfPendingGrantByTelegram } from '../utils/grant-telegram'
import { sendTelegramMessage } from '../utils/telegram'

export default defineNitroPlugin(() => {
  const debouncer = createGrantMailDebouncer(GRANT_TELEGRAM_COOLDOWN_MS)

  defineGrantPendingHook(async (grant) => {
    const config = useRuntimeConfig()
    const { telegramBotToken, telegramChatId, telegramApprover } = config
    // Same shape as the VAPID and Resend checks: unconfigured is a silent
    // no-op, so dev and the example apps are unaffected. All three are needed
    // — a chat without a named approver would take anyone's grants.
    if (!telegramBotToken || !telegramChatId || !telegramApprover) return

    await notifyApproverOfPendingGrantByTelegram(grant, {
      issuer: config.openapeIdp.issuer as string,
      chatId: telegramChatId as string,
      approver: telegramApprover as string,
      debouncer,
      resolveApprover,
      countPendingForApprover,
      send: (chatId, text) => sendTelegramMessage(telegramBotToken as string, chatId, text),
    })
  })
})
