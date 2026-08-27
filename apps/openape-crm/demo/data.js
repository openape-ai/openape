/* Gemeinsame Demo-Daten + Fachlogik fuer alle drei Design-Varianten.
   Quelle: CRM_Anforderungsspezifikation.docx v1.0 (26.08.2026) */

const PIPELINES = {
  lead: {
    label: 'Lead',
    stufen: [
      { id: 'kalt', label: 'Kalter Lead' },
      { id: 'warm', label: 'Warmer Lead' },
      { id: 'kontaktiert', label: 'Kontaktiert' },
      { id: 'konvertiert', label: 'Zu Deal konvertiert', endmarker: 'deal' },
      { id: 'disqualifiziert', label: 'Disqualifiziert', endstufe: true },
      { id: 'blacklist', label: 'Blacklist', endstufe: true },
    ],
  },
  deal: {
    label: 'Deal',
    stufen: [
      { id: 'inbound', label: 'Inbound' },
      { id: 'termin', label: 'Termin vereinbart' },
      { id: 'demo', label: 'Demo durchgeführt' },
      { id: 'followup', label: 'Follow-up-Phase' },
      { id: 'angebot', label: 'Angebotsphase' },
      { id: 'gewonnen', label: 'Gewonnen', endmarker: 'kunde' },
      { id: 'spaet', label: 'Abschluss spät oder unwahrscheinlich' },
      { id: 'verloren', label: 'Final verloren', endstufe: true },
    ],
  },
  kunde: {
    label: 'Kunde',
    stufen: [
      { id: 'onboarding', label: 'Onboarding' },
      { id: 'zahlend', label: 'Zahlender Kunde' },
      { id: 'abwehr', label: 'Kündigungsabwehr' },
      { id: 'gekuendigt', label: 'Final gekündigt', endstufe: true },
    ],
  },
};

const WAEHRUNGEN = ['EUR', 'CHF', 'USD', 'GBP', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'CAD', 'AUD', 'JPY'];

const ABRECHNUNG = [
  { id: 'monatlich', label: 'monatlich' },
  { id: 'jaehrlich', label: 'jährlich' },
  { id: 'einmalig', label: 'einmalig' },
  { id: 'verwendung', label: 'nach Verwendung' },
];

const USERS = [
  { id: 'u1', name: 'Patrick Hofmann', kuerzel: 'PH' },
  { id: 'u2', name: 'Sandra Weiss', kuerzel: 'SW' },
  { id: 'u3', name: 'Tobias Lenz', kuerzel: 'TL' },
];

const PRODUKTE = [
  { id: 'p1', name: 'OpenApe Platform – Basis', standardpreis: 490, standardAbrechnung: 'monatlich', beschreibung: 'Kernplattform, bis 25 Nutzer' },
  { id: 'p2', name: 'OpenApe Platform – Enterprise', standardpreis: 1490, standardAbrechnung: 'monatlich', beschreibung: 'Unbegrenzte Nutzer, SSO, SLA' },
  { id: 'p3', name: 'Onboarding & Setup', standardpreis: 2400, standardAbrechnung: 'einmalig', beschreibung: 'Einrichtung, Datenmigration, Schulung' },
  { id: 'p4', name: 'Zusatzmodul Dokumentensafe', standardpreis: 180, standardAbrechnung: 'monatlich', beschreibung: 'Revisionssichere Ablage' },
  { id: 'p5', name: 'Support-Kontingent', standardpreis: 140, standardAbrechnung: 'verwendung', beschreibung: 'Abrechnung je angefangene Stunde' },
];

const FIRMEN = [
  { id: 'f1', name: 'Brunner Consulting GmbH', website: 'brunner-consulting.at', adresse: 'Mariahilfer Straße 88', plz: '1070', ort: 'Wien', land: 'Österreich' },
  { id: 'f2', name: 'Hofstätter Bau AG', website: 'hofstaetter-bau.at', adresse: 'Industriestraße 4', plz: '4020', ort: 'Linz', land: 'Österreich' },
  { id: 'f3', name: 'Nordlicht Medien GmbH', website: 'nordlicht.de', adresse: 'Elbchaussee 210', plz: '22605', ort: 'Hamburg', land: 'Deutschland' },
  { id: 'f4', name: 'Alpenquell Getränke AG', website: 'alpenquell.ch', adresse: 'Seestrasse 12', plz: '8002', ort: 'Zürich', land: 'Schweiz' },
  { id: 'f5', name: 'Kepler Labs GmbH', website: 'keplerlabs.io', adresse: 'Neubaugasse 3', plz: '1070', ort: 'Wien', land: 'Österreich' },
  { id: 'f6', name: 'Sturmberg Logistik KG', website: 'sturmberg-log.at', adresse: 'Hafenweg 19', plz: '5020', ort: 'Salzburg', land: 'Österreich' },
  { id: 'f7', name: 'Veritas Rechtsanwälte', website: 'veritas-ra.at', adresse: 'Schottenring 22', plz: '1010', ort: 'Wien', land: 'Österreich' },
];

const PERSONEN = [
  { id: 'k1', vorname: 'Michael', nachname: 'Brunner', geschlecht: 'männlich', titel: 'Mag.', emails: ['m.brunner@brunner-consulting.at'], telefone: ['+43 1 555 8820'], firmaId: 'f1' },
  { id: 'k2', vorname: 'Lena', nachname: 'Kastner', geschlecht: 'weiblich', titel: '', emails: ['l.kastner@brunner-consulting.at'], telefone: [], firmaId: 'f1' },
  { id: 'k3', vorname: 'Georg', nachname: 'Hofstätter', geschlecht: 'männlich', titel: 'Ing.', emails: ['g.hofstaetter@hofstaetter-bau.at'], telefone: ['+43 732 44 12 90'], firmaId: 'f2' },
  { id: 'k4', vorname: 'Anke', nachname: 'Sölden', geschlecht: 'weiblich', titel: 'Dr.', emails: ['a.soelden@nordlicht.de', 'anke@nordlicht.de'], telefone: ['+49 40 998 220'], firmaId: 'f3' },
  { id: 'k5', vorname: 'Reto', nachname: 'Amrein', geschlecht: 'männlich', titel: '', emails: ['r.amrein@alpenquell.ch'], telefone: ['+41 44 220 11 08'], firmaId: 'f4' },
  { id: 'k6', vorname: 'Julia', nachname: 'Pfeiffer', geschlecht: 'weiblich', titel: 'DI', emails: ['julia@keplerlabs.io'], telefone: ['+43 660 20 33 141'], firmaId: 'f5' },
  { id: 'k7', vorname: 'Marek', nachname: 'Sturm', geschlecht: 'männlich', titel: '', emails: ['m.sturm@sturmberg-log.at'], telefone: [], firmaId: 'f6' },
  { id: 'k8', vorname: 'Carolin', nachname: 'Vogl', geschlecht: 'weiblich', titel: 'Mag.', emails: ['c.vogl@veritas-ra.at'], telefone: ['+43 1 401 20'], firmaId: 'f7' },
  { id: 'k9', vorname: 'Stefan', nachname: 'Radlmayr', geschlecht: 'männlich', titel: '', emails: ['s.radlmayr@keplerlabs.io'], telefone: [], firmaId: 'f5' },
];

const VORGAENGE = [
  {
    id: 'v1', firmaId: 'f5', personIds: ['k6', 'k9'], phase: 'kunde', stufe: 'zahlend',
    titel: 'Kepler Labs – Plattform Enterprise',
    dokumente: [{ name: 'Kickoff-Protokoll.pdf', groesse: '340 KB', datum: '2026-05-12' }],
    vertraege: [
      { id: 'c1', status: 'aktiv', startdatum: '2026-06-01', mindestlaufzeit: 24, waehrung: 'EUR', signiertesPdf: 'Vertrag-KeplerLabs-signiert.pdf',
        positionen: [
          { produktId: 'p2', preis: 1290, rabatt: 200, abrechnung: 'monatlich' },
          { produktId: 'p3', preis: 2400, rabatt: 0, abrechnung: 'einmalig' },
        ] },
      { id: 'c2', status: 'aktiv', startdatum: '2026-08-01', mindestlaufzeit: 12, waehrung: 'EUR', signiertesPdf: 'Upsell-Dokumentensafe-signiert.pdf',
        positionen: [{ produktId: 'p4', preis: 180, rabatt: 0, abrechnung: 'monatlich' }] },
    ],
    historie: [
      { typ: 'mail', ts: '2026-08-24 09:12', autor: 'PH', titel: 'Upsell Dokumentensafe – Rechnung folgt', text: 'Danke für die schnelle Signatur. Die erste Rechnung geht Anfang September raus.' },
      { typ: 'dokument', ts: '2026-08-22 16:40', autor: 'System', titel: 'Upsell-Dokumentensafe-signiert.pdf abgelegt', text: 'Vertrag von „offen“ auf „aktiv laufend“ gewechselt.' },
      { typ: 'notiz', ts: '2026-08-14 11:05', autor: 'SW', titel: 'Interesse an Dokumentensafe', text: 'Julia fragt nach revisionssicherer Ablage für die Laborberichte. Upsell als zusätzlicher Vertrag am bestehenden Vorgang.' },
      { typ: 'termin', ts: '2026-06-03 10:00', autor: 'PH', titel: 'Onboarding-Workshop (Teams)', text: 'Teams-Link automatisch erzeugt, 90 Minuten.' },
      { typ: 'dokument', ts: '2026-05-28 14:22', autor: 'System', titel: 'Vertrag-KeplerLabs-signiert.pdf abgelegt', text: 'Signatur durch Kunde (EES).' },
    ],
  },
  {
    id: 'v2', firmaId: 'f1', personIds: ['k1', 'k2'], phase: 'deal', stufe: 'angebot',
    titel: 'Brunner Consulting – Basis + Onboarding',
    dokumente: [{ name: 'Anforderungen-Brunner.docx', groesse: '88 KB', datum: '2026-08-11' }],
    vertraege: [
      { id: 'c3', status: 'offen', startdatum: '2026-09-15', mindestlaufzeit: 12, waehrung: 'EUR', signiertesPdf: null,
        positionen: [
          { produktId: 'p1', preis: 490, rabatt: 40, abrechnung: 'monatlich' },
          { produktId: 'p3', preis: 2400, rabatt: 400, abrechnung: 'einmalig' },
        ] },
    ],
    historie: [
      { typ: 'mail', ts: '2026-08-26 08:30', autor: 'PH', titel: 'Angebot AG-2026-041 versendet', text: 'Signaturlink verschickt, Lizenzvertrag als PDF angehängt.' },
      { typ: 'aufgabe', ts: '2026-08-26 08:31', autor: 'PH', titel: 'Nachfassen Angebot Brunner', text: 'Fällig 02.09.2026 · Verantwortlich Patrick Hofmann' },
      { typ: 'notiz', ts: '2026-08-20 15:10', autor: 'SW', titel: 'Budget bestätigt', text: 'Michael hat intern 8k Jahresbudget freigegeben, Rabatt auf Onboarding zugesagt.' },
      { typ: 'termin', ts: '2026-08-13 14:00', autor: 'SW', titel: 'Demo durchgeführt', text: 'Beide Ansprechpartner dabei, Fokus auf Vorgangs-Historie.' },
      { typ: 'mail', ts: '2026-08-05 09:44', autor: 'M. Brunner', titel: 'Re: Terminvorschlag', text: 'Passt uns am 13.8. um 14 Uhr – bitte Teams-Link.' },
    ],
  },
  {
    id: 'v3', firmaId: 'f3', personIds: ['k4'], phase: 'deal', stufe: 'demo',
    titel: 'Nordlicht Medien – Enterprise-Evaluierung',
    dokumente: [], vertraege: [],
    historie: [
      { typ: 'termin', ts: '2026-08-25 11:00', autor: 'TL', titel: 'Demo durchgeführt', text: 'Sehr interessiert an Support-Threads, will Angebot bis KW 36.' },
      { typ: 'notiz', ts: '2026-08-18 09:15', autor: 'TL', titel: 'Zwei Standorte', text: 'Hamburg und Berlin, ca. 40 Nutzer → Enterprise.' },
      { typ: 'mail', ts: '2026-08-10 17:02', autor: 'A. Sölden', titel: 'Anfrage über Webformular', text: 'Wir suchen ein CRM mit Outlook-Anbindung für 40 Mitarbeitende.' },
    ],
  },
  {
    id: 'v4', firmaId: 'f2', personIds: ['k3'], phase: 'deal', stufe: 'followup',
    titel: 'Hofstätter Bau – Basis',
    dokumente: [], vertraege: [],
    historie: [
      { typ: 'notiz', ts: '2026-08-19 10:30', autor: 'PH', titel: 'Entscheidung vertagt', text: 'Wartet auf Abschluss des Geschäftsjahres, Wiedervorlage Mitte September.' },
      { typ: 'termin', ts: '2026-07-30 09:00', autor: 'PH', titel: 'Demo durchgeführt', text: '' },
    ],
  },
  {
    id: 'v5', firmaId: 'f4', personIds: ['k5'], phase: 'deal', stufe: 'termin',
    titel: 'Alpenquell – Erstgespräch',
    dokumente: [], vertraege: [],
    historie: [
      { typ: 'termin', ts: '2026-09-02 15:00', autor: 'SW', titel: 'Erstgespräch (Teams)', text: 'Einladung über Outlook versendet.' },
      { typ: 'mail', ts: '2026-08-21 13:20', autor: 'SW', titel: 'Terminvorschläge', text: 'Drei Slots vorgeschlagen, CHF als Währung angefragt.' },
    ],
  },
  {
    id: 'v6', firmaId: 'f6', personIds: ['k7'], phase: 'lead', stufe: 'kontaktiert',
    titel: 'Sturmberg Logistik',
    dokumente: [], vertraege: [],
    historie: [
      { typ: 'mail', ts: '2026-08-23 08:05', autor: 'TL', titel: 'Erstkontakt', text: 'Kurzvorstellung versendet, noch keine Antwort.' },
    ],
  },
  {
    id: 'v7', firmaId: 'f7', personIds: ['k8'], phase: 'lead', stufe: 'warm',
    titel: 'Veritas Rechtsanwälte',
    dokumente: [], vertraege: [],
    historie: [
      { typ: 'notiz', ts: '2026-08-26 12:00', autor: 'PH', titel: 'Empfehlung', text: 'Über Kepler Labs empfohlen, kennt das Produkt bereits.' },
    ],
  },
  {
    id: 'v8', firmaId: 'f3', personIds: ['k4'], phase: 'kunde', stufe: 'onboarding',
    titel: 'Nordlicht Medien – Pilotstandort',
    dokumente: [], vertraege: [
      { id: 'c4', status: 'aktiv', startdatum: '2026-08-15', mindestlaufzeit: null, waehrung: 'EUR', signiertesPdf: 'Pilot-Nordlicht-signiert.pdf',
        positionen: [{ produktId: 'p5', preis: 140, rabatt: 0, abrechnung: 'verwendung' }] },
    ],
    historie: [
      { typ: 'aufgabe', ts: '2026-08-26 09:00', autor: 'TL', titel: 'Datenimport CSV vorbereiten', text: 'Fällig 30.08.2026 · Verantwortlich Tobias Lenz' },
    ],
  },
];

const AUFGABEN = [
  { id: 't1', titel: 'Nachfassen Angebot Brunner', beschreibung: 'Angebot AG-2026-041 telefonisch nachfassen.', faellig: '2026-09-02', verantwortlich: 'u1', status: 'offen', vorgangId: 'v2' },
  { id: 't2', titel: 'Datenimport CSV vorbereiten', beschreibung: 'Kontaktliste von Nordlicht säubern und importieren.', faellig: '2026-08-30', verantwortlich: 'u3', status: 'offen', vorgangId: 'v8' },
  { id: 't3', titel: 'Angebot Nordlicht erstellen', beschreibung: 'Enterprise + Onboarding, 40 Nutzer.', faellig: '2026-09-04', verantwortlich: 'u3', status: 'offen', vorgangId: 'v3' },
  { id: 't4', titel: 'Wiedervorlage Hofstätter', beschreibung: 'Nach Geschäftsjahresabschluss erneut anrufen.', faellig: '2026-09-15', verantwortlich: 'u1', status: 'offen', vorgangId: 'v4' },
  { id: 't5', titel: 'Teams-Termin Alpenquell bestätigen', beschreibung: '', faellig: '2026-08-28', verantwortlich: 'u2', status: 'offen', vorgangId: 'v5' },
  { id: 't6', titel: 'Onboarding-Workshop nachbereiten', beschreibung: 'Protokoll versenden.', faellig: '2026-06-04', verantwortlich: 'u1', status: 'erledigt', vorgangId: 'v1' },
];

const THREADS = [
  { id: 's1', betreff: 'Signiertes Angebot AG-2026-039 – Kepler Labs', status: 'abgeschlossen', vorgangId: 'v1', quelle: 'automatisch',
    nachrichten: [{ von: 'system@openape.ai', ts: '2026-08-22 16:40', text: 'Das Angebot AG-2026-039 wurde von Julia Pfeiffer signiert. Das signierte PDF liegt am Vertrag.' }] },
  { id: 's2', betreff: 'Frage zur Rechnungsstellung', status: 'warten_uns', vorgangId: 'v1', quelle: 'mail',
    nachrichten: [
      { von: 'julia@keplerlabs.io', ts: '2026-08-25 10:12', text: 'Können wir die Rechnung künftig auf eine Sammel-PDF pro Quartal umstellen?' },
      { von: 'support@openape.ai', ts: '2026-08-25 11:30', text: 'Ich prüfe das mit der Buchhaltung und melde mich morgen.' },
    ] },
  { id: 's3', betreff: 'CRM mit Outlook-Anbindung gesucht', status: 'warten_kunde', vorgangId: 'v3', quelle: 'webformular',
    nachrichten: [
      { von: 'a.soelden@nordlicht.de', ts: '2026-08-10 17:02', text: 'Wir suchen ein CRM mit Outlook-Anbindung für 40 Mitarbeitende. Bitte um Rückmeldung.' },
      { von: 'support@openape.ai', ts: '2026-08-11 08:20', text: 'Gerne – passt Ihnen ein Termin nächste Woche für eine Demo?' },
    ] },
  { id: 's4', betreff: 'Anfrage Testzugang', status: 'neu', vorgangId: null, quelle: 'webformular',
    nachrichten: [{ von: 'office@thalhammer-immo.at', ts: '2026-08-26 14:48', text: 'Guten Tag, wir hätten Interesse an einem Testzugang für drei Personen. Thalhammer Immobilien GmbH, +43 1 202 44.' }] },
  { id: 's5', betreff: 'Login funktioniert nicht mehr', status: 'neu', vorgangId: null, quelle: 'mail',
    nachrichten: [{ von: 'buchhaltung@sturmberg-log.at', ts: '2026-08-26 07:55', text: 'Seit heute früh kommen wir nicht mehr in den Kundenbereich.' }] },
];

const THREAD_STATUS = {
  neu: 'Neu',
  warten_kunde: 'Beantwortet – warten auf Kunde',
  warten_uns: 'Beantwortet – warten auf uns',
  abgeschlossen: 'Abgeschlossen',
};

const VERTRAG_STATUS = {
  offen: 'offen',
  aktiv: 'aktiv laufend',
  fertig: 'fertig abgeschlossen',
  gekuendigt: 'gekündigt',
};

/* ---------- Fachlogik ---------- */

const CRM = {
  pipelines: PIPELINES, waehrungen: WAEHRUNGEN, abrechnung: ABRECHNUNG, users: USERS,
  produkte: PRODUKTE, firmen: FIRMEN, personen: PERSONEN, vorgaenge: VORGAENGE,
  aufgaben: AUFGABEN, threads: THREADS, threadStatus: THREAD_STATUS, vertragStatus: VERTRAG_STATUS,

  firma: (v) => FIRMEN.find((f) => f.id === v.firmaId),
  personenVon: (v) => v.personIds.map((id) => PERSONEN.find((p) => p.id === id)),
  produkt: (id) => PRODUKTE.find((p) => p.id === id),
  user: (id) => USERS.find((u) => u.id === id),
  vorgang: (id) => VORGAENGE.find((v) => v.id === id),
  stufe: (phase, id) => PIPELINES[phase].stufen.find((s) => s.id === id),
  name: (p) => [p.titel, p.vorname, p.nachname].filter(Boolean).join(' '),
  initialen: (p) => ((p.vorname || '')[0] || '') + ((p.nachname || '')[0] || ''),

  geld(betrag, waehrung = 'EUR') {
    return new Intl.NumberFormat('de-AT', { style: 'currency', currency: waehrung, maximumFractionDigits: 0 }).format(betrag);
  },

  datum(iso) {
    if (!iso) return '—';
    const [d] = iso.split(' ');
    const [y, m, day] = d.split('-');
    return `${day}.${m}.${y}`;
  },

  /* Vertragsende = Startdatum + Mindestlaufzeit, nur wenn Mindestlaufzeit gesetzt (Spec 3.4) */
  vertragsende(vertrag) {
    if (!vertrag.mindestlaufzeit) return null;
    const d = new Date(vertrag.startdatum);
    d.setMonth(d.getMonth() + vertrag.mindestlaufzeit);
    return d.toISOString().slice(0, 10);
  },

  positionsSumme: (pos) => pos.preis - (pos.rabatt || 0),

  /* Laufend/einmalig wird abgeleitet, nicht gespeichert (Spec 3.5 / A3) */
  vertragsArt(vertrag) {
    const arten = new Set(vertrag.positionen.map((p) => (p.abrechnung === 'einmalig' ? 'einmalig' : 'laufend')));
    return arten.size > 1 ? 'gemischt' : [...arten][0];
  },

  vertragsWert(vertrag) {
    return vertrag.positionen.reduce((s, p) => s + CRM.positionsSumme(p), 0);
  },

  /* Endmarker-Stufen ueberfuehren den Vorgang automatisch in die naechste Phase (Spec 4) */
  setzeStufe(vorgang, stufeId) {
    const stufe = CRM.stufe(vorgang.phase, stufeId);
    if (stufe.endmarker) {
      const zielPhase = stufe.endmarker;
      vorgang.phase = zielPhase;
      vorgang.stufe = PIPELINES[zielPhase].stufen[0].id;
      CRM.log(vorgang, 'notiz', `Automatisch in Phase „${PIPELINES[zielPhase].label}“ überführt`,
        `Endmarker „${stufe.label}“ erreicht → Landestufe „${PIPELINES[zielPhase].stufen[0].label}“.`);
      return { konvertiert: true, phase: zielPhase };
    }
    vorgang.stufe = stufeId;
    return { konvertiert: false };
  },

  log(vorgang, typ, titel, text) {
    const now = new Date('2026-08-27T09:30:00');
    const ts = `${now.toISOString().slice(0, 10)} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    vorgang.historie.unshift({ typ, ts, autor: 'PH', titel, text });
  },

  /* Angebot signiert → Vertrag aktiv + PDF + Support-Thread (Spec 6.4, Schritte 8/9) */
  angebotAnlegen(vorgang, positionen, waehrung, startdatum, mindestlaufzeit) {
    const vertrag = {
      id: 'c' + (VORGAENGE.reduce((n, v) => n + v.vertraege.length, 0) + 1),
      status: 'offen', startdatum, mindestlaufzeit, waehrung, signiertesPdf: null, positionen,
    };
    vorgang.vertraege.push(vertrag);
    CRM.log(vorgang, 'mail', 'Angebot versendet', `Signaturlink an ${CRM.personenVon(vorgang)[0].emails[0]}, Vertrag im Status „offen“ angelegt.`);
    return vertrag;
  },

  angebotSignieren(vorgang, vertrag) {
    vertrag.status = 'aktiv';
    vertrag.signiertesPdf = `Vertrag-${CRM.firma(vorgang).name.split(' ')[0]}-signiert.pdf`;
    CRM.log(vorgang, 'dokument', `${vertrag.signiertesPdf} abgelegt`, 'Einfache elektronische Signatur (EES) durch den Kunden. Vertrag „offen“ → „aktiv laufend“.');
    THREADS.unshift({
      id: 's' + (THREADS.length + 1), betreff: `Signiertes Angebot – ${CRM.firma(vorgang).name}`,
      status: 'neu', vorgangId: vorgang.id, quelle: 'automatisch',
      nachrichten: [{ von: 'system@openape.ai', ts: '2026-08-27 09:30', text: `Das Angebot wurde signiert. Das PDF liegt am Vertrag ${vertrag.id}.` }],
    });
  },

  suche(q) {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const treffer = [];
    VORGAENGE.forEach((v) => {
      const hay = [v.titel, CRM.firma(v).name, ...CRM.personenVon(v).flatMap((p) => [CRM.name(p), ...p.emails]),
        ...v.historie.map((h) => h.titel + ' ' + h.text)].join(' ').toLowerCase();
      if (hay.includes(s)) treffer.push({ typ: 'Vorgang', id: v.id, label: v.titel, sub: `${PIPELINES[v.phase].label} · ${CRM.stufe(v.phase, v.stufe).label}` });
    });
    PERSONEN.forEach((p) => {
      if ((CRM.name(p) + ' ' + p.emails.join(' ')).toLowerCase().includes(s)) {
        treffer.push({ typ: 'Person', id: p.id, label: CRM.name(p), sub: p.emails[0] });
      }
    });
    FIRMEN.forEach((f) => {
      if (f.name.toLowerCase().includes(s)) treffer.push({ typ: 'Firma', id: f.id, label: f.name, sub: `${f.plz} ${f.ort}` });
    });
    return treffer.slice(0, 12);
  },
};

window.CRM = CRM;
