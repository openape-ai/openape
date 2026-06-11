import { createError } from 'h3'
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

/** Shared outer markup of every mail: brand header wrapping the card. */
function brandedHtml(maxWidthPx: number, cardHtml: string): string {
  return `
      <div style="font-family: 'Public Sans', system-ui, sans-serif; max-width: ${maxWidthPx}px; margin: 0 auto; padding: 40px 20px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <span style="font-size: 32px;">🦍</span>
          <span style="font-size: 20px; font-weight: bold; margin-left: 8px; color: #f5f5f5;">OpenApe</span>
        </div>
        ${cardHtml}
      </div>
    `
}

// The Resend SDK returns { data, error } and does NOT throw on API failures
// (invalid key, unverified sender domain, rate limit, etc.). Without checking
// `error` we'd return 200 to the caller while the email is silently dropped.
async function sendViaResend(label: string, to: string, subject: string, html: string): Promise<void> {
  const config = useRuntimeConfig()
  const { data, error } = await getResend().emails.send({
    from: config.resendFrom,
    to,
    subject,
    html,
  })

  if (error) {
    console.error(`[email] resend ${label} failed for`, to, 'from', config.resendFrom, error)
    throw createError({
      statusCode: 502,
      statusMessage: 'Email delivery failed',
      data: { title: 'Email delivery failed', detail: error.message ?? error.name ?? 'unknown Resend error' },
    })
  }
  console.info(`[email] ${label} email queued id=${data?.id ?? 'unknown'} to=${to}`)
}

export async function sendRegistrationEmail(email: string, registerUrl: string) {
  await sendViaResend('registration', email, 'Dein Account — OpenApe', brandedHtml(480, `
        <div style="background: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 32px; text-align: center;">
          <h2 style="color: #f5f5f5; margin: 0 0 16px 0; font-size: 18px;">Account erstellen</h2>
          <p style="color: #a1a1aa; margin: 0 0 24px 0; font-size: 14px; line-height: 1.6;">
            Klicke den Button um einen Passkey für
            <strong style="color: #f5f5f5;">${email}</strong> zu erstellen.
            Der Link ist 24 Stunden gültig.
          </p>
          <a href="${registerUrl}" style="display: inline-block; background: #f97316; color: #fff; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-weight: 600; font-size: 14px;">
            Passkey erstellen
          </a>
          <p style="color: #71717a; margin: 24px 0 0 0; font-size: 12px;">
            Falls du diese Registrierung nicht angefordert hast, ignoriere diese Email.
          </p>
        </div>
    `))
}

export async function sendRecoveryEmail(
  email: string,
  recoveryUrl: string,
  usableAt: number,
  cancelUrl: string,
) {
  const usableAtIso = `${new Date(usableAt).toISOString().replace('T', ' ').slice(0, 16)} UTC`

  // The mail also serves as the warning-broadcast: even if the user
  // didn't initiate the recovery, this is their notification + cancel
  // link. Keep the cancel CTA visually equal to the recovery CTA so a
  // confused-but-authentic owner can act without fumbling.
  await sendViaResend('recovery', email, 'Konto-Wiederherstellung angefordert — OpenApe', brandedHtml(520, `
        <div style="background: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 32px;">
          <h2 style="color: #f5f5f5; margin: 0 0 16px 0; font-size: 18px;">Wiederherstellung deines Kontos</h2>
          <p style="color: #a1a1aa; margin: 0 0 16px 0; font-size: 14px; line-height: 1.6;">
            Jemand hat angefordert, das Konto <strong style="color: #f5f5f5;">${email}</strong> wiederherzustellen.
          </p>
          <p style="color: #a1a1aa; margin: 0 0 24px 0; font-size: 14px; line-height: 1.6;">
            Wenn <strong>du</strong> das nicht warst: melde dich von einem deiner bestehenden Geräte an —
            das hebt die Wiederherstellung automatisch auf. Oder klicke direkt unten auf "Wiederherstellung abbrechen".
          </p>
          <div style="text-align: center; margin: 24px 0;">
            <a href="${cancelUrl}" style="display: inline-block; background: #18181b; color: #f5f5f5; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-weight: 600; font-size: 14px; border: 1px solid #f97316;">
              Wiederherstellung abbrechen
            </a>
          </div>
          <p style="color: #a1a1aa; margin: 32px 0 16px 0; font-size: 14px; line-height: 1.6;">
            Wenn du es <strong>warst</strong>: aus Sicherheitsgründen kannst du erst ab
            <strong style="color: #f5f5f5;">${usableAtIso}</strong> einen neuen Passkey hinterlegen
            (72-Stunden-Schutz). Bewahre diesen Link bis dahin auf.
          </p>
          <div style="text-align: center; margin: 24px 0;">
            <a href="${recoveryUrl}" style="display: inline-block; background: #f97316; color: #fff; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-weight: 600; font-size: 14px;">
              Passkey neu hinterlegen
            </a>
          </div>
          <p style="color: #71717a; margin: 24px 0 0 0; font-size: 12px;">
            Dieser Link ist bis ${usableAtIso} und 14 Tage darüber hinaus gültig.
          </p>
        </div>
    `))
}

/**
 * Recovery warning-broadcast mail (#462) for every address EVER linked
 * to the account — including former, since-replaced ones. Deliberately
 * contains warning + one-tap cancel ONLY: former addresses must never
 * receive a link that could complete the recovery (that link goes to
 * the current account address via `sendRecoveryEmail`).
 */
export async function sendRecoveryWarningEmail(
  to: string,
  accountEmail: string,
  usableAt: number,
  cancelUrl: string,
) {
  const usableAtIso = `${new Date(usableAt).toISOString().replace('T', ' ').slice(0, 16)} UTC`

  await sendViaResend('recovery warning', to, 'Warnung: Konto-Wiederherstellung angefordert — OpenApe', brandedHtml(520, `
        <div style="background: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 32px;">
          <h2 style="color: #f5f5f5; margin: 0 0 16px 0; font-size: 18px;">Wiederherstellung deines Kontos angefordert</h2>
          <p style="color: #a1a1aa; margin: 0 0 16px 0; font-size: 14px; line-height: 1.6;">
            Jemand hat angefordert, das Konto <strong style="color: #f5f5f5;">${accountEmail}</strong> wiederherzustellen.
            Diese Adresse war einmal mit dem Konto verknüpft, deshalb wirst du gewarnt.
          </p>
          <p style="color: #a1a1aa; margin: 0 0 24px 0; font-size: 14px; line-height: 1.6;">
            Ohne Abbruch kann die Wiederherstellung ab <strong style="color: #f5f5f5;">${usableAtIso}</strong>
            abgeschlossen werden. Wenn <strong>du</strong> das nicht warst, brich sie mit einem Klick ab —
            ganz ohne Anmeldung. Auch eine Anmeldung von einem deiner bestehenden Geräte bricht sie ab.
          </p>
          <div style="text-align: center; margin: 24px 0;">
            <a href="${cancelUrl}" style="display: inline-block; background: #f97316; color: #fff; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-weight: 600; font-size: 14px;">
              Wiederherstellung abbrechen
            </a>
          </div>
          <p style="color: #71717a; margin: 24px 0 0 0; font-size: 12px;">
            Diese Warnung enthält bewusst keinen Link zum Abschließen der Wiederherstellung.
          </p>
        </div>
    `))
}
