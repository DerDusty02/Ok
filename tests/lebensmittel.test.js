// Tests für die Lebensmittel-Datenbank. Aufruf: node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../lebensmittel.js');

const BLS_TEXT = fs.readFileSync(path.join(__dirname, '..', 'bls.json'), 'utf8');
const BLS_ANZAHL = JSON.parse(BLS_TEXT).daten.length;

function neueDb({ text = BLS_TEXT, speicher = L.ramSpeicher() } = {}) {
  const aufrufe = { bls: 0 };
  const db = L.erstellen({ speicher, blsText: async () => { aufrufe.bls++; if (text instanceof Error) throw text; return text; } });
  return { db, speicher, aufrufe };
}
const skyr = { name: 'Skyr', marke: 'Hofmolkerei', kategorie: 'kuehl', art: 'eiweiss', kcal: '63', protein: '11', kh: '4', zucker: '4', fett: '0,2', gesFett: '0,1', salz: '0,1', gProStk: '450', stkName: 'Becher' };

test('lädt den BLS und leitet Abteilung und Art ab', async () => {
  const { db } = neueDb();
  await db.laden();
  assert.equal(db.blsStatus, 'ok');
  assert.equal(db.anzahl.bls, BLS_ANZAHL);
  const hafer = db.get('bls:C133000');
  assert.equal(hafer.name, 'Hafer Flocken');
  assert.equal(hafer.herkunft, 'bls');
  assert.equal(hafer.kategorie, 'trocken');
  assert.equal(hafer.art, 'vollkorn');
  assert.equal(db.gruppeName(hafer), 'Getreide');
});

test('sucht wie bisher, mit Synonymen und Wortstämmen', async () => {
  const { db } = neueDb();
  await db.laden();
  const name = q => (db.suche(q, { max: 1 })[0] || {}).name || '';
  assert.match(name('Haferflocken'), /^Hafer Flocken/);
  assert.match(name('Brokkoli'), /Broccoli/);
  assert.match(name('Kirschtomaten'), /^Tomate/);
  assert.equal(db.suche('xyzabc').length, 0);
  // Fleisch und Fisch lassen sich ausblenden
  assert.ok(db.suche('Lachs', { max: 20 }).length > 0);
  assert.ok(db.suche('Lachs', { max: 20, veg: true }).every(o => !L.istFleisch(o)));
});

test('filtert nach Herkunft und Hauptgruppe', async () => {
  const { db } = neueDb();
  await db.laden();
  await db.speichern(skyr);
  assert.equal(db.liste().length, BLS_ANZAHL + 1);
  assert.equal(db.liste({ filter: 'eigen' }).length, 1);
  assert.equal(db.liste({ filter: 'bls' }).length, BLS_ANZAHL);
  const gemuese = db.liste({ filter: 'G' });
  assert.ok(gemuese.length > 100 && gemuese.every(o => o.code[0] === 'G'));
  assert.ok(db.liste({ filter: 'U', veg: true }).length === 0);
  // Eigene stehen vorne, danach alphabetisch
  assert.equal(db.liste()[0].name, 'Skyr');
  const namen = db.liste({ filter: 'F' }).map(o => o.name);
  assert.deepEqual(namen, [...namen].sort(new Intl.Collator('de').compare));
});

test('legt eigene Lebensmittel an, ändert und löscht sie', async () => {
  const { db, speicher } = neueDb();
  let meldungen = 0;
  db.abonnieren(() => meldungen++);
  const neu = await db.speichern(skyr);
  assert.match(neu.id, /^eigen:skyr-[a-z0-9]{1,4}$/);
  assert.equal(neu.fett, 0.2);
  assert.equal(neu.gProStk, 450);
  assert.equal(neu.herkunft, 'eigen');
  assert.ok(neu.erstellt && neu.geaendert);
  assert.equal(db.suche('skyr hofmolkerei')[0].id, neu.id);

  const gespeichert = await speicher.lesen('lebensmittel', neu.id);
  assert.equal(gespeichert.name, 'Skyr');
  assert.equal(gespeichert.n, undefined, 'Suchfelder landen nicht im Speicher');

  const geaendert = await db.speichern({ ...skyr, kcal: '65' }, neu.id);
  assert.equal(geaendert.kcal, 65);
  assert.equal(geaendert.erstellt, neu.erstellt);
  assert.equal(db.anzahl.eigen, 1);

  await assert.rejects(db.speichern({ ...skyr, kcal: 70 }), /gibt es schon/);
  await db.speichern({ ...skyr, marke: 'Andere Molkerei' });
  assert.equal(db.anzahl.eigen, 2);

  await db.loeschen(neu.id);
  assert.equal(db.get(neu.id), null);
  assert.equal(await speicher.lesen('lebensmittel', neu.id), undefined);
  await assert.rejects(db.loeschen('bls:C133000'), /lassen sich nicht löschen/);
  assert.equal(meldungen, 4);
});

test('eigene Lebensmittel bleiben im Speicher und kommen beim nächsten Start wieder', async () => {
  const speicher = L.ramSpeicher();
  const a = neueDb({ speicher });
  const neu = await a.db.speichern(skyr);
  const b = neueDb({ speicher });
  assert.equal(b.db.liste({ filter: 'eigen' }).length, 0, 'vor dem Öffnen noch leer');
  await b.db.oeffnen();
  assert.equal(b.db.get(neu.id).name, 'Skyr');
  assert.equal(b.db.liste({ filter: 'eigen' }).length, 1, 'die Liste kennt sie nach dem Öffnen');
});

test('prüft die Eingaben', () => {
  assert.throws(() => L.pruefen({ kcal: 100 }), /Namen/);
  assert.throws(() => L.pruefen({ name: 'X' }), /Kalorien/);
  assert.throws(() => L.pruefen({ name: 'X', kcal: 'viel' }), /keine Zahl/);
  assert.throws(() => L.pruefen({ name: 'X', kcal: 100, fett: -1 }), /negativ/);
  assert.throws(() => L.pruefen({ name: 'X', kcal: 100, protein: 120 }), /100 g/);
  assert.throws(() => L.pruefen({ name: 'X', kcal: 1200 }), /1000 kcal/);
  assert.throws(() => L.pruefen({ name: 'X', kcal: 100, fett: 2, gesFett: 5 }), /gesättigte/);
  assert.throws(() => L.pruefen({ name: 'X', kcal: 100, kh: 2, zucker: 5 }), /Zucker/);
  assert.throws(() => L.pruefen({ name: 'X', kcal: 100, protein: 40, kh: 40, fett: 40 }), /zusammen/);
  assert.throws(() => L.pruefen({ name: 'X', kcal: 100, barcode: '12ab' }), /Barcode/);
  assert.throws(() => L.pruefen({ name: 'X', kcal: 100, dichte: 9 }), /Dichte/);
  const lm = L.pruefen({ name: '  Linsen   rot ', kcal: '330', kategorie: 'trocken', art: 'unbekannt', trocken: true, basic: 'ja', barcode: '4006040 001234' });
  assert.deepEqual(lm, { name: 'Linsen rot', barcode: '4006040001234', kategorie: 'trocken', art: 'sonstiges', kcal: 330, protein: 0, kh: 0, fett: 0, trocken: true });
});

test('jeder BLS-Eintrag lässt sich als eigenes Lebensmittel übernehmen', async () => {
  const { db } = neueDb();
  await db.laden();
  for (const o of db.liste({ filter: 'bls' })) {
    assert.doesNotThrow(() => L.pruefen({ ...o, name: L.kurzName(o.name) || o.name, basis: o.code }), o.code);
  }
});

test('Export und Import führen Stände zusammen', async () => {
  const a = neueDb();
  const s1 = await a.db.speichern(skyr);
  await a.db.speichern({ name: 'Tahini', kcal: 640, protein: 20, kh: 10, fett: 55 });
  const sicherung = JSON.parse(JSON.stringify(a.db.exportieren()));
  assert.equal(sicherung.format, L.FORMAT);
  assert.equal(sicherung.anzahl, 2);
  assert.ok(sicherung.lebensmittel.every(o => o.n === undefined && o.herkunft === undefined));

  const b = neueDb();
  assert.deepEqual(await b.db.importieren(JSON.stringify(sicherung)), { neu: 2, aktualisiert: 0, unveraendert: 0, fehler: [] });
  assert.equal(b.db.get(s1.id).name, 'Skyr');
  // Zweimal importieren ändert nichts
  assert.deepEqual(await b.db.importieren(sicherung), { neu: 0, aktualisiert: 0, unveraendert: 2, fehler: [] });

  // Jüngerer Stand gewinnt, älterer bleibt liegen
  const spaeter = new Date(Date.now() + 60000).toISOString();
  const frueher = '2020-01-01T00:00:00.000Z';
  const r1 = await b.db.importieren([{ ...sicherung.lebensmittel.find(o => o.id === s1.id), kcal: 99, geaendert: spaeter }]);
  assert.equal(r1.aktualisiert, 1);
  assert.equal(b.db.get(s1.id).kcal, 99);
  const r2 = await b.db.importieren([{ ...sicherung.lebensmittel.find(o => o.id === s1.id), kcal: 11, geaendert: frueher }]);
  assert.equal(r2.unveraendert, 1);
  assert.equal(b.db.get(s1.id).kcal, 99);

  // Gleicher Name unter anderer id: gleiche Werte zählen als vorhanden, andere als Konflikt
  const r3 = await b.db.importieren([{ name: 'Tahini', kcal: 640, protein: 20, kh: 10, fett: 55 }, { name: 'Tahini', kcal: 600 }, { name: '', kcal: 1 }]);
  assert.equal(r3.unveraendert, 1);
  assert.deepEqual(r3.fehler.map(f => f.grund), ['Gibt es schon mit anderen Werten.', 'Gib dem Lebensmittel einen Namen.']);

  await assert.rejects(b.db.importieren('{kaputt'), /kein gültiges JSON/);
  await assert.rejects(b.db.importieren({ format: 'etwas anderes' }), /keine Lebensmittel/);
});

test('ohne bls.json bleiben eigene Lebensmittel nutzbar', async () => {
  const { db, aufrufe } = neueDb({ text: new Error('offline') });
  await db.speichern(skyr);
  await db.laden();
  assert.equal(db.blsStatus, 'fehler');
  assert.equal(db.suche('Skyr').length, 1);
  await db.laden();
  assert.equal(aufrufe.bls, 2, 'versucht es beim nächsten Mal wieder');
});

test('der BLS kommt aus dem Zwischenspeicher und wird erneuert, wenn sich bls.json ändert', async () => {
  const speicher = L.ramSpeicher();
  const a = neueDb({ speicher });
  await a.db.laden();
  const k = await speicher.lesen('katalog', 'bls');
  assert.equal(k.daten.length, BLS_ANZAHL);

  // Ohne Netz: Der Zwischenspeicher reicht
  const b = neueDb({ speicher, text: new Error('offline') });
  await b.db.laden();
  assert.equal(b.db.blsStatus, 'ok');
  assert.equal(b.db.anzahl.bls, BLS_ANZAHL);

  // Neue bls.json: wird im Hintergrund übernommen und gemeldet
  const j = JSON.parse(BLS_TEXT);
  j.daten = j.daten.slice(0, 10);
  let liefern;
  const datei = new Promise(res => { liefern = res; });
  const c = L.erstellen({ speicher, blsText: () => datei });
  const gemeldet = new Promise(res => c.abonnieren(res));
  await c.laden();
  assert.equal(c.anzahl.bls, BLS_ANZAHL, 'zuerst der Zwischenspeicher');
  liefern(JSON.stringify(j));
  await gemeldet;
  assert.equal(c.anzahl.bls, 10);
  assert.equal((await speicher.lesen('katalog', 'bls')).daten.length, 10);
});
