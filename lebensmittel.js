/* Lebensmittel-Datenbank für Nicos Kochbuch.
   Erster Baustein der eigenständigen App: Die Daten liegen lokal im Browser (IndexedDB) und brauchen
   weder Claude noch einen Server. Fehlt IndexedDB (privates Fenster, gesperrter Speicher), läuft alles
   im Arbeitsspeicher weiter, eigene Lebensmittel sind dann nach dem Neuladen wieder weg.

   Zwei Herkünfte, beide mit Nährwerten pro 100 g:
   - bls:   Bundeslebensmittelschlüssel 4.0 (Max Rubner-Institut, CC BY 4.0) aus bls.json, nur lesbar.
            Wird beim ersten Gebrauch eingelesen und in IndexedDB zwischengespeichert, damit er auch
            offline da ist. Ändert sich bls.json, wird der Zwischenspeicher still erneuert.
   - eigen: selbst angelegte Lebensmittel, etwa Markenprodukte mit den Werten von der Packung.

   Läuft im Browser (window.Lebensmittel) und in Node (require), dort für die Tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Lebensmittel = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
'use strict';

/* ---------- Begriffe ---------- */
const FORMAT = 'kochbuch-lebensmittel';
const FORMAT_VERSION = 1;
const DB_NAME = 'kochbuch';
const DB_VERSION = 1;
const NW_FELDER = ['kcal', 'protein', 'kh', 'zucker', 'fett', 'gesFett', 'ballaststoffe', 'salz', 'omega3'];
// Fehlen sie, zählen sie als 0. Ohne Kalorien wird nicht gespeichert.
const PFLICHT = ['protein', 'kh', 'fett'];
const FELD_NAME = {
  kcal: 'Kalorien', protein: 'Eiweiß', kh: 'Kohlenhydrate', zucker: 'Zucker', fett: 'Fett', gesFett: 'Gesättigte Fettsäuren',
  ballaststoffe: 'Ballaststoffe', salz: 'Salz', omega3: 'Omega-3', gProStk: 'Gramm pro Stück', gProEL: 'Gramm pro EL', dichte: 'Dichte'
};
// Abteilungen im Supermarkt, nach ihnen sortiert die Einkaufsliste
const KATEGORIEN = [
  ['obst-gemuese', 'Obst & Gemüse'],
  ['kuehl', 'Kühlregal'],
  ['brot', 'Brot & Backwaren'],
  ['trocken', 'Nudeln, Reis & Getreide'],
  ['konserven', 'Konserven & Gläser'],
  ['tk', 'Tiefkühl'],
  ['oel-gewuerze', 'Öl, Essig & Gewürze'],
  ['sonstiges', 'Sonstiges']
];
// Art für die Bewertung der Rezepte
const ARTEN = [
  ['gemuese', 'Gemüse'],
  ['obst', 'Obst'],
  ['huelsenfrucht', 'Hülsenfrüchte'],
  ['vollkorn', 'Vollkorn'],
  ['weissmehl', 'Weißmehl & Weißreis'],
  ['staerke', 'Kartoffeln & Stärke'],
  ['eiweiss', 'Eiweiß & Milchprodukte'],
  ['nuesse', 'Nüsse & Samen'],
  ['fett', 'Öl & Butter'],
  ['suess', 'Zucker, Sirup & Honig'],
  ['aromaten', 'Kräuter, Gewürze & Würze'],
  ['sonstiges', 'Sonstiges']
];
const ART_DEFAULT = { 'obst-gemuese': 'gemuese', 'kuehl': 'eiweiss', 'brot': 'weissmehl', 'trocken': 'sonstiges', 'konserven': 'sonstiges', 'tk': 'gemuese', 'oel-gewuerze': 'aromaten', 'sonstiges': 'sonstiges' };
const KAT_KEYS = new Set(KATEGORIEN.map(k => k[0]));
const ART_KEYS = new Set(ARTEN.map(k => k[0]));
// Hauptgruppen des BLS: Der Code beginnt mit ihrem Buchstaben, z. B. G = Gemüse
const HAUPTGRUPPEN = [
  ['B', 'Brot und Kleingebäck'],
  ['C', 'Getreide und Getreideerzeugnisse'],
  ['D', 'Kuchen, Kekse und Feingebäck'],
  ['E', 'Eier und Teigwaren'],
  ['F', 'Obst und Obsterzeugnisse'],
  ['G', 'Gemüse und Gemüseerzeugnisse'],
  ['H', 'Hülsenfrüchte, Nüsse und Samen'],
  ['K', 'Kartoffeln, Stärke und Pilze'],
  ['M', 'Milch, Milchprodukte und Käse'],
  ['N', 'Alkoholfreie Getränke'],
  ['P', 'Alkoholische Getränke'],
  ['Q', 'Öle und Fette'],
  ['R', 'Gewürze und Würzmittel'],
  ['S', 'Süßwaren, Zucker und Eis'],
  ['T', 'Fisch und Meeresfrüchte'],
  ['U', 'Fleisch von Rind, Kalb, Schwein und Lamm'],
  ['V', 'Wild, Geflügel und Innereien'],
  ['W', 'Wurst und Fleischwaren'],
  ['X', 'Gerichte: Salate, Suppen, Soßen, Beilagen'],
  ['Y', 'Gerichte: Fleisch, Fisch, Eier, Desserts']
];
const HAUPTGRUPPE_NAME = Object.fromEntries(HAUPTGRUPPEN);

/* ---------- Suche ---------- */
function normTxt(s) { return String(s || '').toLowerCase().replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function suchEintrag(o, text = o.name) {
  const n = normTxt(text);
  o.n = n; o.ns = n.replace(/[^a-z0-9]/g, ''); o.w = n.split(/[^a-z0-9]+/).filter(Boolean);
  o.w2 = o.w.slice(0, -1).map((x, i) => x + o.w[i + 1]);
  return o;
}
const SYN = {
  brokkoli: ['broccoli'], ei: ['huhnerei'], eier: ['huhnerei'], zwiebel: ['speisezwiebel'], zwiebeln: ['speisezwiebel'], paprika: ['gemusepaprika'],
  nudel: ['teigwaren'], nudeln: ['teigwaren'], pasta: ['teigwaren'], spaghetti: ['teigwaren'], penne: ['teigwaren'], fusilli: ['teigwaren'], makkaroni: ['teigwaren'],
  vollkornnudeln: ['vollkornteigwaren'], vollkornspaghetti: ['vollkornteigwaren'], vollkornpasta: ['vollkornteigwaren'],
  vollkornreis: ['reis unpoliert'], naturreis: ['reis unpoliert'], basmati: ['reis poliert'], basmatireis: ['reis poliert'],
  wrap: ['weizentortilla'], wraps: ['weizentortilla'], tortilla: ['weizentortilla'], tortillas: ['weizentortilla'],
  hafermilch: ['haferdrink'], sojamilch: ['sojadrink'], mandelmilch: ['mandeldrink'],
  frischkase: ['frischkasezubereitung'], bruhe: ['bouillon'], kartoffeln: ['kartoffel']
};
const ZUB = ['gekocht', 'gebraten', 'gebacken', 'gedunstet', 'gegrillt', 'geschmort', 'getrocknet', 'tiefgefroren', 'konserve', 'gegart', 'frittiert', 'gedampft', 'gargezogen', 'abgetropft'];
const FLEISCH = /(fleisch|speck|schinken|hahnchen|huhn|pute|rind|schwein|kalb|lamm|hammel|wurst|salami|fisch|lachs|thunfisch|hering|garnele|krabbe|muschel|gelatine)/;
const KEIN_FLEISCH = /(vegetarisch|vegan|fruchtfleisch|fleischtomate|huhnerei)/;
function istFleisch(o) { return !!o.code && (/^[TUVW]/.test(o.code) || /^Y[0-6]/.test(o.code) || (FLEISCH.test(o.n) && !KEIN_FLEISCH.test(o.n))); }
// Vorsilben, die am Lebensmittel nichts ändern: Babyspinat → Spinat, Kirschtomaten → Tomaten
const VORSILBEN = ['baby', 'kirsch', 'cocktail', 'cherry', 'rispen', 'strauch', 'natur', 'bio', 'mini', 'jung', 'frisch'];
function stammVarianten(t) {
  const basis = [t];
  for (const p of VORSILBEN) if (t.startsWith(p) && t.length - p.length >= 4) basis.push(t.slice(p.length));
  const v = new Set();
  for (const b of basis) {
    v.add(b); (SYN[b] || []).forEach(x => v.add(x));
    if (b.length >= 4) for (const suf of ['en', 'n', 'e', 's']) if (b.endsWith(suf) && b.length - suf.length >= 3) { const st = b.slice(0, -suf.length); v.add(st); (SYN[st] || []).forEach(x => v.add(x)); }
  }
  return [...v];
}
// Beiwörter, die fehlen dürfen, wenn sonst nichts passt: „Tofu natur“ findet Tofu, „Rote Zwiebel“ findet Zwiebel
const SCHWACH = new Set(['natur', 'light', 'leicht', 'bio', 'frisch', 'frische', 'frischer', 'rot', 'rote', 'roter', 'rotes', 'grun', 'grune', 'gruner', 'gelb', 'gelbe', 'weiss', 'weisse', 'schwarz', 'schwarze', 'klein', 'kleine', 'gross', 'grosse', 'fein', 'mild', 'extra', 'griechisch', 'griechische', 'griechischer', 'gehackt', 'gehackte', 'passiert', 'passierte', 'geschalt', 'geschalte', 'abgetropft', 'ungesusst', 'vegan', 'vegane', 'veganer', 'vegetarisch', 'vegetarische', 'mager', 'tk']);
function sucheIn(items, query, opts = {}) {
  const toks = normTxt(query).split(/[^a-z0-9]+/).filter(t => t.length >= 2);
  if (!toks.length) return [];
  const res = sucheLauf(items, toks, opts, false);
  return res.length || !toks.some(t => SCHWACH.has(t)) ? res : sucheLauf(items, toks, opts, true);
}
function sucheLauf(items, toks, { max = 8, veg = false } = {}, locker) {
  const tv = toks.map(stammVarianten);
  const zubQ = toks.some(t => t.length >= 4 && ZUB.some(z => z.startsWith(t.slice(0, 5))));
  const out = [];
  for (const it of items) {
    if (veg && istFleisch(it)) continue;
    let s = 0, treffer = 0, ok = true;
    for (const [ti, vars] of tv.entries()) {
      let best = 0;
      for (const v of vars) {
        const vk = v.replace(/[^a-z0-9]/g, '');
        if (it.w.includes(v) || it.w2.includes(vk)) { best = 5.5; break; }
        if (it.w.some(w => w.startsWith(v)) || (vk.length >= 4 && it.ns.startsWith(vk))) best = Math.max(best, 3);
        else if (vk.length >= 4 && (it.n.includes(v) || it.ns.includes(vk))) best = Math.max(best, 1.5);
      }
      if (best) { treffer++; s += best; }
      else if (locker && SCHWACH.has(toks[ti])) s -= 1.5;
      else { ok = false; break; }
    }
    if (!ok || !treffer) continue;
    if (tv.some(vars => vars.some(v => it.n.startsWith(v) || it.ns.startsWith(v.replace(/[^a-z0-9]/g, ''))))) s += 2;
    if (!zubQ) { if (it.w.includes('roh')) s += 1.5; if (it.w.some(w => ZUB.includes(w))) s -= 0.8; }
    if (it.code) { const g = it.code[0]; if (g === 'X' || g === 'Y') s -= 2.5; else if (g === 'D' || g === 'N' || g === 'P') s -= 1; }
    // Selbst angelegte Lebensmittel hat man mit Absicht eingetragen, sie kommen etwas weiter nach oben
    if (it.herkunft === 'eigen') s += 1;
    s -= it.n.length * 0.012;
    if (s >= 1) out.push([s, it]);
  }
  out.sort((a, b) => b[0] - a[0]);
  return out.slice(0, max).map(x => x[1]);
}

/* ---------- BLS-Zuordnung ---------- */
// Abteilung und Art aus BLS-Code und Namen ableiten. Erwartet die Suchfelder von suchEintrag.
function blsZuordnung(o) {
  const g1 = o.code[0], g2 = o.code.slice(0, 2), nm = o.n;
  const has = (...w) => w.some(x => nm.includes(x));
  let kategorie = 'sonstiges', art = 'sonstiges', basic = false, zz = false, trocken = false;
  switch (g1) {
    case 'B': kategorie = 'brot'; art = (g2 === 'B1' || g2 === 'B4' || has('vollkorn')) ? 'vollkorn' : 'weissmehl'; break;
    case 'C':
      kategorie = 'trocken';
      if (has('drink')) { kategorie = 'kuehl'; art = 'sonstiges'; }
      else if (g2 === 'C6') art = 'sonstiges';
      else if (has('vollkorn', 'ganzes korn', 'flocken', 'kleie', 'quinoa', 'amaranth', 'buchweizen', 'hirse', 'unpoliert', 'bulgur', 'grunkern')) art = 'vollkorn';
      else art = 'weissmehl';
      if (has('gesusst', 'zucker')) zz = true;
      break;
    case 'D': kategorie = 'brot'; zz = true; break;
    case 'E':
      if (g2 === 'E1') { kategorie = 'kuehl'; art = 'eiweiss'; }
      else { kategorie = 'trocken'; art = (g2 === 'E5' || g2 === 'E7' || has('vollkorn')) ? 'vollkorn' : 'weissmehl'; }
      break;
    case 'F':
      kategorie = 'obst-gemuese'; art = 'obst';
      if (g2 === 'F8' || g2 === 'F9') art = 'sonstiges';
      if (has('saft', 'nektar', 'sirup')) { art = 'sonstiges'; kategorie = 'sonstiges'; zz = true; }
      if (has('gezuckert', 'gesusst', 'konfiture', 'marmelade', 'kandiert')) zz = true;
      if (has('zitrone', 'limette') && !has('saft')) art = 'aromaten';
      if (has('konserve')) kategorie = 'konserven';
      if (has('getrocknet')) kategorie = 'trocken';
      if (has('tiefgefroren')) kategorie = 'tk';
      break;
    case 'G':
      kategorie = 'obst-gemuese'; art = g2 === 'G9' ? 'sonstiges' : 'gemuese';
      if (has('petersilienblatt', 'schnittlauch', 'basilikum', 'dill', 'koriander', 'minze', 'rosmarin', 'thymian', 'salbei', 'kresse', 'knoblauch', 'kerbel', 'liebstockel', 'estragon', 'barlauch', 'majoran')) art = 'aromaten';
      if (has('saft')) art = 'sonstiges';
      if (g2 === 'G7' && has('reif')) { art = 'huelsenfrucht'; kategorie = 'trocken'; trocken = !has('gekocht', 'gegart', 'konserve', 'mehl'); }
      if (has('konserve')) kategorie = 'konserven';
      if (has('getrocknet')) kategorie = 'trocken';
      if (has('tiefgefroren')) kategorie = 'tk';
      break;
    case 'H':
      if (g2 === 'H7' || g2 === 'H9') { art = 'huelsenfrucht'; kategorie = g2 === 'H9' ? 'konserven' : 'trocken'; trocken = g2 === 'H7' && !has('gekocht', 'gegart', 'konserve', 'mehl'); }
      else if (g2 === 'H6') { art = 'gemuese'; kategorie = 'obst-gemuese'; }
      else if (has('tofu', 'tempeh', 'seitan', 'drink', 'joghurtalternative')) { art = (+o.protein || 0) >= 2.5 ? 'eiweiss' : 'sonstiges'; kategorie = 'kuehl'; }
      else { art = 'nuesse'; kategorie = 'trocken'; }
      break;
    case 'K':
      if (g2 === 'K7' || g2 === 'K8') { art = 'gemuese'; kategorie = 'obst-gemuese'; }
      else { art = 'staerke'; kategorie = (g2 === 'K1' || g2 === 'K4') ? 'obst-gemuese' : 'kuehl'; }
      if (has('tiefgefroren')) kategorie = 'tk';
      if (has('pulver', 'trockenprodukt')) kategorie = 'trocken';
      break;
    case 'M':
      kategorie = has('pulver') ? 'trocken' : 'kuehl';
      art = ((+o.fett || 0) >= 20 && (+o.protein || 0) < 8) ? 'fett' : 'eiweiss';
      if (has('gesusst', 'fruchtzubereitung')) zz = true;
      break;
    case 'N': if (g2 === 'N2' || g2 === 'N3') zz = true; break;
    case 'Q':
      art = 'fett'; kategorie = (g2 === 'Q4' || g2 === 'Q6') ? 'kuehl' : (g2 === 'Q9' ? 'konserven' : 'oel-gewuerze');
      basic = g2 === 'Q1' || g2 === 'Q2' || g2 === 'Q3';
      break;
    case 'R':
      kategorie = 'oel-gewuerze'; art = 'aromaten'; basic = true;
      if (has('ketchup')) zz = true;
      if (has('passiert', 'tomatenpuree')) { art = 'gemuese'; kategorie = 'konserven'; basic = false; }
      if (has('roh')) { kategorie = 'obst-gemuese'; basic = false; }
      break;
    case 'S':
      art = g2 === 'S1' ? 'suess' : 'sonstiges'; zz = g2 !== 'S1';
      kategorie = g2 === 'S2' ? 'tk' : (g2 === 'S1' ? 'oel-gewuerze' : 'sonstiges');
      basic = g2 === 'S1' && has('zucker');
      break;
    case 'T': case 'U': case 'V': case 'W': kategorie = has('tiefgefroren') ? 'tk' : 'kuehl'; art = 'eiweiss'; break;
    default: break;
  }
  return { kategorie, art, basic, zuckerZugesetzt: zz, trocken };
}
function kurzName(name) {
  return String(name).replace(/\s*\([^)]*\)/g, '').replace(/,?\s+roh$/i, '').replace(/\s{2,}/g, ' ').replace(/[,\s]+$/, '').trim();
}

/* ---------- Prüfen ---------- */
function zahl(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  const s = String(v).trim().replace(',', '.');
  if (!s) return null;
  return /^-?(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : NaN;
}
const deZahl = x => String(x).replace('.', ',');
const text = (v, max) => String(v == null ? '' : v).trim().replace(/\s+/g, ' ').slice(0, max);
// Prüfziffer von EAN-8, UPC-A, EAN-13 und GTIN-14
function gtinGueltig(code) {
  const s = String(code == null ? '' : code);
  if (!/^(\d{8}|\d{12,14})$/.test(s)) return false;
  let summe = 0;
  for (let i = s.length - 2, f = 3; i >= 0; i--, f = 4 - f) summe += +s[i] * f;
  return (10 - summe % 10) % 10 === +s[s.length - 1];
}
// Führende Nullen ändern nichts: UPC-A 012345678905 ist dasselbe Produkt wie EAN-13 0012345678905
const gtinSchluessel = c => String(c || '').replace(/^0+/, '');
const titel = o => o.marke ? `${o.name} (${o.marke})` : o.name;
const schluessel = o => normTxt(o.name).trim() + '|' + normTxt(o.marke || '').trim();
const iso = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;

// Prüft die Angaben zu einem eigenen Lebensmittel und gibt sie bereinigt zurück.
// Zahlen dürfen als Text mit Komma kommen, wie aus dem Formular. Fehlertexte sind für die Oberfläche gedacht.
function pruefen(roh) {
  if (!roh || typeof roh !== 'object') throw new Error('Das ist kein Lebensmittel.');
  const name = text(roh.name, 120);
  if (!name) throw new Error('Gib dem Lebensmittel einen Namen.');
  const lm = { name };
  const marke = text(roh.marke, 60);
  if (marke) lm.marke = marke;
  let barcode = String(roh.barcode == null ? '' : roh.barcode).replace(/[\s-]/g, '');
  if (barcode) {
    if (!/^(\d{8}|\d{12,14})$/.test(barcode)) throw new Error('Ein Barcode hat 8 oder 13 Ziffern.');
    if (!gtinGueltig(barcode)) throw new Error('Die Prüfziffer des Barcodes stimmt nicht. Vertippt?');
    if (barcode.length === 12) barcode = '0' + barcode;
    if (barcode.length === 14 && barcode[0] === '0') barcode = barcode.slice(1);
    lm.barcode = barcode;
  }
  const basis = text(roh.basis, 10);
  if (/^[A-Z][0-9A-Z]{6}$/.test(basis)) lm.basis = basis;
  lm.kategorie = KAT_KEYS.has(roh.kategorie) ? roh.kategorie : 'sonstiges';
  lm.art = ART_KEYS.has(roh.art) ? roh.art : (ART_DEFAULT[lm.kategorie] || 'sonstiges');
  for (const k of NW_FELDER) {
    const v = zahl(roh[k]);
    if (v === null) {
      if (k === 'kcal') throw new Error('Trag die Kalorien pro 100 g ein, sie stehen auf der Packung.');
      if (PFLICHT.includes(k)) lm[k] = 0;
      continue;
    }
    if (Number.isNaN(v)) throw new Error(`${FELD_NAME[k]}: „${text(roh[k], 20)}“ ist keine Zahl.`);
    if (v < 0) throw new Error(`${FELD_NAME[k]} kann nicht negativ sein.`);
    if (k === 'kcal' && v > 1000) throw new Error('Mehr als 1000 kcal pro 100 g gibt es nicht. Stimmt der Wert?');
    if (k !== 'kcal' && v > 100) throw new Error(`${FELD_NAME[k]}: Mehr als 100 g in 100 g geht nicht.`);
    lm[k] = v;
  }
  // Etwas Spielraum, weil Packungs- und Tabellenwerte gerundet sind
  if ((lm.gesFett || 0) > lm.fett + 0.5) throw new Error('Es sind mehr gesättigte Fettsäuren als Fett eingetragen.');
  if ((lm.zucker || 0) > lm.kh + 0.5) throw new Error('Es ist mehr Zucker als Kohlenhydrate eingetragen.');
  if (lm.protein + lm.kh + lm.fett + (lm.ballaststoffe || 0) > 110) throw new Error('Eiweiß, Kohlenhydrate, Fett und Ballaststoffe ergeben zusammen mehr als 100 g.');
  for (const [k, min, max] of [['gProStk', 0.1, 10000], ['gProEL', 0.5, 100], ['dichte', 0.2, 3]]) {
    const v = zahl(roh[k]);
    if (v === null || v === 0) continue;
    if (Number.isNaN(v) || v < min || v > max) throw new Error(`${FELD_NAME[k]}: Bitte eine Zahl zwischen ${deZahl(min)} und ${deZahl(max)}.`);
    lm[k] = v;
  }
  const sn = text(roh.stkName, 20);
  if (sn) lm.stkName = sn;
  // Woher die Werte stammen, z. B. „Open Food Facts · 4001234567890“
  const quelle = text(roh.quelle, 140);
  if (quelle) lm.quelle = quelle;
  for (const k of ['basic', 'zuckerZugesetzt', 'trocken']) if (roh[k] === true) lm[k] = true;
  return lm;
}

/* ---------- Speicher ---------- */
// Alle Speicher haben dieselben vier Befehle. Tabellen: lebensmittel (eigene), katalog (zwischengespeicherte Kataloge).
function ramSpeicher() {
  const tab = { lebensmittel: new Map(), katalog: new Map() };
  const kopie = o => o == null ? o : JSON.parse(JSON.stringify(o));
  return {
    persistent: false,
    async alle(t) { return [...tab[t].values()].map(kopie); },
    async lesen(t, id) { return kopie(tab[t].get(id)); },
    async schreiben(t, liste) { for (const o of liste) tab[t].set(o.id, kopie(o)); },
    async loeschen(t, id) { tab[t].delete(id); }
  };
}
function idbSpeicher({ name = DB_NAME, idb = typeof indexedDB !== 'undefined' ? indexedDB : null, timeout = 4000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!idb) return reject(new Error('IndexedDB fehlt'));
    const uhr = setTimeout(() => reject(new Error('IndexedDB antwortet nicht')), timeout);
    let req;
    try { req = idb.open(name, DB_VERSION); } catch (e) { clearTimeout(uhr); return reject(e); }
    req.onupgradeneeded = e => {
      const db = req.result;
      // Version 1: eigene Lebensmittel und Kataloge. Spätere Schritte (Rezepte, Wochenplan) kommen als neue Versionen dazu.
      if (e.oldVersion < 1) {
        db.createObjectStore('lebensmittel', { keyPath: 'id' });
        db.createObjectStore('katalog', { keyPath: 'id' });
      }
    };
    req.onerror = () => { clearTimeout(uhr); reject(req.error); };
    req.onsuccess = () => {
      clearTimeout(uhr);
      const db = req.result;
      // Öffnet ein anderer Tab eine neuere Version, gibt dieser Tab die Datenbank frei
      db.onversionchange = () => db.close();
      const tx = (t, modus, fn) => new Promise((res, rej) => {
        const x = db.transaction(t, modus);
        const r = fn(x.objectStore(t));
        x.oncomplete = () => res(r ? r.result : undefined);
        x.onerror = () => rej(x.error);
        x.onabort = () => rej(x.error || new Error('Abgebrochen'));
      });
      resolve({
        persistent: true,
        alle: t => tx(t, 'readonly', s => s.getAll()),
        lesen: (t, id) => tx(t, 'readonly', s => s.get(id)),
        schreiben: (t, liste) => tx(t, 'readwrite', s => { liste.forEach(o => s.put(o)); }),
        loeschen: (t, id) => tx(t, 'readwrite', s => { s.delete(id); })
      });
    };
  });
}
function speicherFehler(e) {
  const voll = e && (e.name === 'QuotaExceededError' || e.code === 22);
  const f = new Error(voll ? 'Der Speicher auf diesem Gerät ist voll.' : 'Speichern hat nicht geklappt. Versuch es gleich noch einmal.');
  f.cause = e;
  return f;
}
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36) + '-' + s.length;
}

/* ---------- Datenbank ---------- */
// speicher: fertiger Speicher (oder Promise darauf), ohne Angabe IndexedDB und notfalls RAM.
// blsText: liefert den Inhalt von bls.json als Text, ohne Angabe per fetch neben der Seite.
function erstellen({ speicher, blsText, timeout } = {}) {
  const ladeBls = blsText || (() => fetch('bls.json').then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); }));
  const coll = new Intl.Collator('de');
  const st = {
    sp: null, offen: null, lauf: null, persistAngefragt: false,
    eigene: new Map(), eigeneSortiert: null,
    bls: [], blsSortiert: [], blsIndex: new Map(), gruppen: {}, quelle: '', signatur: '', blsStatus: 'leer',
    hoerer: new Set()
  };
  const melden = () => { st.eigeneSortiert = null; for (const f of st.hoerer) { try { f(); } catch (e) { console.error(e); } } };
  const eintragEigen = o => suchEintrag({ ...o, herkunft: 'eigen' }, [titel(o), o.barcode].filter(Boolean).join(' '));
  const sauber = o => { const c = { ...o }; for (const k of ['herkunft', 'n', 'ns', 'w', 'w2']) delete c[k]; return c; };
  const sortiere = arr => arr.sort((a, b) => coll.compare(a.name, b.name) || coll.compare(a.marke || '', b.marke || ''));
  const eigeneListe = () => st.eigeneSortiert || (st.eigeneSortiert = sortiere([...st.eigene.values()]));

  function oeffnen() {
    if (st.offen) return st.offen;
    st.offen = (async () => {
      try { st.sp = await (speicher || idbSpeicher({ timeout })); }
      catch (e) { st.sp = ramSpeicher(); }
      try { for (const o of await st.sp.alle('lebensmittel')) if (o && o.id && o.name) st.eigene.set(o.id, eintragEigen(o)); }
      catch (e) { /* unlesbarer Speicher: leer weitermachen */ }
      st.eigeneSortiert = null;
    })();
    return st.offen;
  }

  function katalogAnwenden(k) {
    const sp = k.spalten;
    st.bls = k.daten.map(a => {
      const o = { herkunft: 'bls' };
      sp.forEach((f, i) => { if (a[i] != null) o[f] = a[i]; });
      o.id = 'bls:' + o.code;
      return Object.assign(suchEintrag(o), blsZuordnung(o));
    });
    st.blsSortiert = sortiere([...st.bls]);
    st.blsIndex = new Map(st.bls.map(o => [o.id, o]));
    st.gruppen = k.gruppen || {}; st.quelle = k.quelle || ''; st.signatur = k.signatur;
    st.blsStatus = 'ok';
  }
  // Holt bls.json und übernimmt sie, wenn sie sich geändert hat. Gibt zurück, ob etwas neu ist.
  async function blsHolen() {
    const txt = await ladeBls();
    const sig = hash(txt);
    if (sig === st.signatur) return false;
    const j = JSON.parse(txt);
    if (!j || !Array.isArray(j.spalten) || !Array.isArray(j.daten) || !j.spalten.includes('code')) throw new Error('bls.json hat ein unbekanntes Format');
    const k = { id: 'bls', signatur: sig, quelle: j.quelle || '', spalten: j.spalten, gruppen: j.gruppen || {}, daten: j.daten, geladen: new Date().toISOString() };
    katalogAnwenden(k);
    try { await st.sp.schreiben('katalog', [k]); } catch (e) { /* nur Zwischenspeicher */ }
    return true;
  }
  // Lädt eigene Lebensmittel und den BLS. Schlägt der BLS fehl, steht blsStatus auf 'fehler'
  // und eigene Lebensmittel sind trotzdem da. Der nächste Aufruf versucht es dann noch einmal.
  function laden() {
    if (st.lauf) return st.lauf;
    st.lauf = (async () => {
      await oeffnen();
      if (st.blsStatus === 'ok') return;
      st.blsStatus = 'laedt';
      let k = null;
      try { k = await st.sp.lesen('katalog', 'bls'); } catch (e) { k = null; }
      if (k && Array.isArray(k.daten) && Array.isArray(k.spalten)) {
        katalogAnwenden(k);
        blsHolen().then(neu => { if (neu) melden(); }).catch(() => {});
        return;
      }
      try { await blsHolen(); }
      catch (e) { st.blsStatus = 'fehler'; st.lauf = null; }
    })();
    return st.lauf;
  }

  function dauerhaftAnfragen() {
    // Bittet den Browser, eigene Daten nicht bei Platzmangel zu löschen. Erst beim ersten Speichern, weil Firefox nachfragt.
    if (st.persistAngefragt || !st.sp.persistent) return;
    st.persistAngefragt = true;
    try { if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) {}
  }
  function neueId(name) {
    const base = 'eigen:' + (normTxt(name).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'lebensmittel');
    let id;
    do id = base + '-' + Math.random().toString(36).slice(2, 6); while (st.eigene.has(id));
    return id;
  }
  function doppelt(lm, id) {
    const k = schluessel(lm);
    for (const e of st.eigene.values()) if (e.id !== id && schluessel(e) === k) return e;
    return null;
  }
  function perBarcode(code) {
    const k = gtinSchluessel(code);
    if (!k) return null;
    for (const e of st.eigene.values()) if (e.barcode && gtinSchluessel(e.barcode) === k) return e;
    return null;
  }

  // Legt ein eigenes Lebensmittel an oder ändert es (mit id). Gibt den gespeicherten Eintrag zurück.
  async function speichern(daten, id = null) {
    await oeffnen();
    const lm = pruefen(daten);
    const alt = id ? st.eigene.get(id) : null;
    if (id && !alt) throw new Error('Dieses Lebensmittel gibt es nicht mehr.');
    if (doppelt(lm, id)) throw new Error(`„${titel(lm)}“ gibt es schon.`);
    const gleicherCode = lm.barcode && perBarcode(lm.barcode);
    if (gleicherCode && gleicherCode.id !== id) throw new Error(`Diesen Barcode hat schon „${titel(gleicherCode)}“.`);
    const jetzt = new Date().toISOString();
    const rec = { id: id || neueId(lm.name), ...lm, erstellt: alt ? alt.erstellt : jetzt, geaendert: jetzt };
    try { await st.sp.schreiben('lebensmittel', [rec]); } catch (e) { throw speicherFehler(e); }
    st.eigene.set(rec.id, eintragEigen(rec));
    dauerhaftAnfragen();
    melden();
    return st.eigene.get(rec.id);
  }
  async function loeschen(id) {
    await oeffnen();
    if (!st.eigene.has(id)) throw new Error(String(id).startsWith('bls:') ? 'Einträge aus dem BLS lassen sich nicht löschen.' : 'Dieses Lebensmittel gibt es nicht mehr.');
    try { await st.sp.loeschen('lebensmittel', id); } catch (e) { throw speicherFehler(e); }
    st.eigene.delete(id);
    melden();
  }

  // Sicherung der eigenen Lebensmittel. Der BLS gehört nicht dazu, er kommt immer aus bls.json.
  function exportieren() {
    const lebensmittel = eigeneListe().map(sauber);
    return { format: FORMAT, version: FORMAT_VERSION, exportiert: new Date().toISOString(), anzahl: lebensmittel.length, lebensmittel };
  }
  // Führt eine Sicherung mit den vorhandenen Lebensmitteln zusammen. Bei gleicher id gewinnt der jüngere Stand.
  async function importieren(eingabe) {
    await oeffnen();
    let d = eingabe;
    if (typeof d === 'string') {
      try { d = JSON.parse(d); } catch (e) { throw new Error('Die Datei ist kein gültiges JSON.'); }
    }
    const liste = Array.isArray(d) ? d : (d && d.format === FORMAT && Array.isArray(d.lebensmittel) ? d.lebensmittel : null);
    if (!liste) throw new Error('In der Datei stehen keine Lebensmittel aus dem Kochbuch.');
    if (d && d.version > FORMAT_VERSION) throw new Error('Die Sicherung stammt aus einer neueren Version des Kochbuchs.');
    const erg = { neu: 0, aktualisiert: 0, unveraendert: 0, fehler: [] };
    const schreiben = [];
    const namen = new Map([...st.eigene.values()].map(e => [schluessel(e), e.id]));
    const codes = new Map([...st.eigene.values()].filter(e => e.barcode).map(e => [gtinSchluessel(e.barcode), e.id]));
    for (const roh of liste) {
      let lm;
      try { lm = pruefen(roh); }
      catch (e) { erg.fehler.push({ name: text(roh && roh.name, 120) || '(ohne Namen)', grund: e.message }); continue; }
      const id = typeof roh.id === 'string' && /^eigen:[a-z0-9-]{1,80}$/.test(roh.id) ? roh.id : neueId(lm.name);
      const k = schluessel(lm);
      const zeit = iso(roh.geaendert) || new Date().toISOString();
      const rec = { id, ...lm, erstellt: iso(roh.erstellt) || zeit, geaendert: zeit };
      const finde = x => schreiben.find(r => r.id === x) || st.eigene.get(x);
      const gleich = e => JSON.stringify(pruefen(e)) === JSON.stringify(lm);
      const alt = finde(id);
      if (alt && (gleich(alt) || zeit <= alt.geaendert)) { erg.unveraendert++; continue; }
      const anderer = namen.get(k);
      if (anderer && anderer !== id) {
        if (gleich(finde(anderer))) erg.unveraendert++;
        else erg.fehler.push({ name: titel(lm), grund: 'Gibt es schon mit anderen Werten.' });
        continue;
      }
      const bk = lm.barcode ? gtinSchluessel(lm.barcode) : '';
      const andererCode = bk && codes.get(bk);
      if (andererCode && andererCode !== id) {
        erg.fehler.push({ name: titel(lm), grund: `Den Barcode hat schon „${titel(finde(andererCode))}“.` });
        continue;
      }
      if (alt) {
        erg.aktualisiert++;
        if (namen.get(schluessel(alt)) === id) namen.delete(schluessel(alt));
        if (alt.barcode && codes.get(gtinSchluessel(alt.barcode)) === id) codes.delete(gtinSchluessel(alt.barcode));
      } else erg.neu++;
      const i = schreiben.findIndex(r => r.id === id);
      if (i >= 0) schreiben[i] = rec; else schreiben.push(rec);
      namen.set(k, id);
      if (bk) codes.set(bk, id);
    }
    if (schreiben.length) {
      try { await st.sp.schreiben('lebensmittel', schreiben); } catch (e) { throw speicherFehler(e); }
      for (const rec of schreiben) st.eigene.set(rec.id, eintragEigen(rec));
      dauerhaftAnfragen();
      melden();
    }
    return erg;
  }

  // filter: '' alle, 'eigen', 'bls' oder Buchstabe einer BLS-Hauptgruppe. veg blendet Fleisch und Fisch aus.
  // Alphabetisch, eigene vorneweg. Die Suche geht den BLS in der Reihenfolge der Datei durch,
  // damit gleich gute Treffer so sortiert sind wie dort.
  function liste({ filter = '', veg = false } = {}, bls = st.blsSortiert) {
    let arr = filter === 'eigen' ? eigeneListe() : (filter ? bls : [...eigeneListe(), ...bls]);
    if (filter && filter !== 'eigen' && filter !== 'bls') arr = arr.filter(o => o.code[0] === filter);
    return veg ? arr.filter(o => !istFleisch(o)) : arr;
  }

  return {
    oeffnen, laden, speichern, loeschen, exportieren, importieren,
    liste: opts => liste(opts),
    get persistent() { return !!(st.sp && st.sp.persistent); },
    get blsStatus() { return st.blsStatus; },
    get blsQuelle() { return st.quelle; },
    get anzahl() { return { eigen: st.eigene.size, bls: st.bls.length }; },
    get: id => st.eigene.get(id) || st.blsIndex.get(id) || null,
    // Eigenes Lebensmittel mit diesem Barcode, sonst null
    perBarcode,
    suche: (q, { max = 8, veg = false, filter = '' } = {}) => sucheIn(liste({ filter, veg }, st.bls), q, { max }),
    // Untergruppe aus dem BLS, z. B. „Vollkornbrot“
    gruppeName: o => o && o.code ? (st.gruppen[o.code.slice(0, 2)] || HAUPTGRUPPE_NAME[o.code[0]] || '') : '',
    abonnieren(fn) { st.hoerer.add(fn); return () => st.hoerer.delete(fn); }
  };
}

return {
  erstellen, ramSpeicher, idbSpeicher, pruefen, titel, gtinGueltig,
  normTxt, suchEintrag, sucheIn, istFleisch, blsZuordnung, kurzName,
  KATEGORIEN, ARTEN, ART_DEFAULT, HAUPTGRUPPEN, NW_FELDER, FORMAT
};
});
