# Vision — OpenApe Identity (Pilot-Scope: openape-free-idp)

> Dieses Dokument ist der komprimierte Kanon. Es wird ausschließlich vom
> `story-consistency`-Agent fortgeschrieben (Single Writer) und ist Pflicht-Kontext
> für jeden Agent-Lauf im Story-Workflow. Hand-Seed: 2026-06-10.

## Was die App ist

`id.openape.ai` (openape-free-idp) ist ein kostenloser DDISA-Identity-Provider: Nutzer
melden sich überall im offenen Web mit ihrer E-Mail-Domain und einem Passkey an — ohne
Passwort, ohne per-App-Konto. Service Provider entdecken den IdP per DNS-TXT-Record und
holen sich Autorisierung über Grants. Der IdP ist der Ort, an dem die Identität des
Nutzers wohnt; entsprechend konservativ ist jede Änderung an Auth-Flows.

## Was die App nicht ist

Kein Social Login, kein Passwort-Manager, kein Session-Broker für Dritte. Recovery ist
**permission-to-enrol** (Erlaubnis, einen neuen Passkey zu registrieren), niemals eine
Session. Es gibt keine stillen Admin-Hintertüren in Nutzer-Accounts.

## Sicherheits-Philosophie

Passkeys statt Passwörter; jede sicherheitsrelevante Aktion ist laut (Benachrichtigung,
Audit) statt still; zeitliche Hürden (Cooldowns) schützen aktive Nutzer, ohne verwaiste
Accounts dauerhaft auszusperren; ein einzelner kompromittierter Kanal (z. B. ein Postfach)
darf nie ausreichen, um einen Account geräuschlos zu übernehmen.

## Fähigkeiten (vom Konsistenz-Agent gepflegt)

- Passkey-Sign-in/Sign-up, DDISA-Discovery, Consent + Grants (Bestand, v1)
- Account-Recovery v1: 72h-Mail-Hold mit Abbruch bei Login (Bestand, #297/PR #460)
- (Bestand, #462) Adaptive Recovery-Wartefrist nach Konto-Aktivität (72h inaktiv / 7d aktiv / bis 14d Urlaubs-Schalter)
- (Bestand, #462) Recovery-Warnung auf allen Kanälen (Push + alle je verknüpften E-Mail-Adressen) mit Ein-Tap-Abbruch
- (Bestand, #462) Sichtbares Audit aller Recovery-Ereignisse in den Konto-Einstellungen
