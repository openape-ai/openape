/* Selbstcheck der Fachlogik in data.js (ohne Browser):  node check-logik.mjs */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

global.window = {};
new Function(readFileSync(new URL('./data.js', import.meta.url), 'utf8'))();
const CRM = window.CRM;

const v = CRM.vorgang('v2');
const vertrag = CRM.angebotAnlegen(v,
  [{ produktId: 'p1', preis: 490, rabatt: 0, abrechnung: 'monatlich' },
   { produktId: 'p3', preis: 2400, rabatt: 0, abrechnung: 'einmalig' }],
  'EUR', '2026-09-15', 12);

assert.equal(vertrag.status, 'offen', 'Angebot legt Vertrag im Status offen an');
assert.equal(CRM.vertragsArt(vertrag), 'gemischt', 'laufend + einmalig ergibt gemischt');
assert.equal(CRM.vertragsende(vertrag), '2027-09-15', 'Vertragsende = Start + Mindestlaufzeit');
assert.equal(CRM.vertragsende({ startdatum: '2026-01-01', mindestlaufzeit: null }), null,
  'ohne Mindestlaufzeit kein berechnetes Enddatum');

CRM.angebotSignieren(v, vertrag);
assert.equal(vertrag.status, 'aktiv', 'Signatur aktiviert den Vertrag');
assert.ok(vertrag.signiertesPdf, 'signiertes PDF haengt am Vertrag');
assert.equal(CRM.threads[0].quelle, 'automatisch', 'Signatur erzeugt Thread im Support-Posteingang');

const r = CRM.setzeStufe(v, 'gewonnen');
assert.ok(r.konvertiert && v.phase === 'kunde' && v.stufe === 'onboarding',
  'Endmarker fuehrt den Vorgang automatisch in die naechste Phase, erste Stufe');
assert.equal(CRM.setzeStufe(v, 'zahlend').konvertiert, false, 'normale Stufe konvertiert nicht');

assert.ok(CRM.suche('kepler').some((t) => t.typ === 'Firma'), 'Suche findet Firmen');
assert.ok(CRM.suche('revisionssicher').some((t) => t.typ === 'Vorgang'), 'Suche greift auf Notiz-Volltext');

console.log('data.js: alle Zusicherungen ok');
