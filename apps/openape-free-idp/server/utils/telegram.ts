/**
 * Minimal Telegram Bot API sender. No parse_mode: the message carries command
 * lines and URLs, and Markdown/HTML parsing would either mangle them or reject
 * the whole message over an unescaped underscore.
 */
export async function sendTelegramMessage(botToken: string, chatId: string, text: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) {
    // The body names the reason (wrong chat id, bot blocked, bad token) and is
    // the only useful thing in the hook runner's log.
    throw new Error(`Telegram sendMessage failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
  }
}
