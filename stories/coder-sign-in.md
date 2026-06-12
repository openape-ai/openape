---
id: coder-sign-in
status: documented
app: openape-coder
issue: 585
tests:
  - apps/openape-coder/tests/coder-sign-in.test.ts
guide: sign-in
---

> Red-Beweis (2026-06-11): 5 Tests (Kriterien 1-5) in
> `apps/openape-coder/tests/coder-sign-in.test.ts` failen am fehlenden
> Verhalten — die Routen-Stubs des App-Skeletts antworten 501 „Not
> implemented". Skelett baut, Lint + Typecheck grün. Der UI-Flow
> (Landing → Passkey-Anmeldung → leere Übersicht mit Anlegen-Knopf) wird
> in der green-Phase als eigener Schritt zur Story-Kit-Story (Guide),
> wie beim #462-Muster.

> Endpoint-Grün (2026-06-11, Etappe 2/4): alle App-Tests dieser Story sind
> grün — `requireUser` (Caller via SP-Cookie/Bearer, 401 ohne Leak) und die
> Projekt-Endpoints sind verdrahtet. Status bleibt bewusst `red`: green heißt
> im Kanon erst „Tests grün inkl. der UI-sichtbaren Flows"; der UI-Flow +
> Story-Kit-Guide folgen in Etappe 3.

# Anmelden bei coder.openape.ai

Als Projektbeteiligter möchte ich mich bei coder.openape.ai mit meiner
OpenApe-Identität anmelden (E-Mail-Domain + Passkey, wie bei troop/chat/org),
damit ich meine Projekte ohne neues Konto und ohne Passwort von jedem Gerät
erreiche — und damit Außenstehende weder Projekte noch Beteiligte zu sehen
bekommen.

## Akzeptanzkriterien

1. WENN ein Nutzer sich bei coder.openape.ai mit seiner OpenApe-Identität
   (E-Mail-Domain + Passkey) anmeldet, DANN MUSS er ohne Anlegen eines neuen
   Kontos und ohne Passwort angemeldet sein und seine Projektübersicht sehen.
2. WENN ein angemeldeter Nutzer in keinem Projekt Mitglied ist, DANN MUSS die
   App eine leere Übersicht mit der Möglichkeit zeigen, ein Projekt anzulegen —
   ohne Hinweis auf fremde Projekte oder Personen.
3. WENN ein nicht angemeldeter Besucher eine Projekt- oder Story-Adresse
   aufruft, DANN MUSS er zur Anmeldung geleitet werden, ohne dass die Antwort
   verrät, ob das Aufgerufene existiert.
4. Die App DARF NICHT gegenüber Nicht-Mitgliedern (auch angemeldeten)
   preisgeben, welche Projekte existieren oder welche Personen beteiligt
   sind — auch nicht über unterschiedliche Antworten für „existiert nicht"
   und „kein Zugriff".
5. WENN ein Nutzer sich abmeldet oder seine Sitzung abläuft, DANN MUSS jeder
   weitere Zugriff auf Projektinhalte eine erneute Anmeldung erfordern.

## Abhängigkeiten

- Neue SP-App `apps/openape-coder` (Muster plans/tasks: `@openape/nuxt-auth-sp`)
  mit eigener Datenbank (Drizzle + LibSQL)
- Deploy + DNS für `coder.openape.ai` (chatty: Image-Target, Port, nginx;
  DNS-TXT-Discovery-Eintrag)
