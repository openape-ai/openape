import { Resend } from 'resend'
import { useRuntimeConfig } from '#imports'

let _resend: Resend | null = null

function getResend(): Resend {
  if (!_resend) {
    const config = useRuntimeConfig()
    _resend = new Resend(config.resendApiKey)
  }
  return _resend
}

export async function sendMagicLinkEmail(email: string, verifyUrl: string) {
  const config = useRuntimeConfig()
  const resend = getResend()

  await resend.emails.send({
    from: config.resendFrom,
    to: email,
    subject: 'Dein Login-Link — OpenApe',
    html: `
      <div style="font-family: 'Public Sans', system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <span style="font-size: 32px;">🦍</span>
          <span style="font-size: 20px; font-weight: bold; margin-left: 8px; color: #f5f5f5;">OpenApe</span>
        </div>
        <div style="background: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 32px; text-align: center;">
          <h2 style="color: #f5f5f5; margin: 0 0 16px 0; font-size: 18px;">Login bestätigen</h2>
          <p style="color: #a1a1aa; margin: 0 0 24px 0; font-size: 14px; line-height: 1.6;">
            Klicke den Button um dich als <strong style="color: #f5f5f5;">${email}</strong> anzumelden.
            Der Link ist 10 Minuten gültig.
          </p>
          <a href="${verifyUrl}" style="display: inline-block; background: #f97316; color: #fff; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-weight: 600; font-size: 14px;">
            Anmelden
          </a>
          <p style="color: #71717a; margin: 24px 0 0 0; font-size: 12px;">
            Falls du diesen Login nicht angefordert hast, ignoriere diese Email.
          </p>
        </div>
      </div>
    `,
  })
}
