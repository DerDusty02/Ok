/* Barcodes für Nicos Kochbuch: lesen und Produkte nachschlagen.

   Lesen: Chrome auf Android und macOS hat einen eingebauten Barcode-Leser (BarcodeDetector). Wo er fehlt,
   etwa in Chrome und Edge unter Windows, in Firefox und Safari, lädt das Modul beim ersten Scan die
   Bibliothek barcode-detector mit ZXing aus vendor/ (rund 1 MB, danach im Browser-Cache).
   Gelesen werden die Strichcodes auf Lebensmitteln: EAN-13, EAN-8, UPC-A und UPC-E.

   Nachschlagen: Open Food Facts, eine freie Produktdatenbank (Lizenz ODbL) mit vielen Produkten aus
   deutschen Supermärkten. Braucht Internet. Gefundene Produkte speichert das Kochbuch als eigene
   Lebensmittel, danach sind sie auch offline da.

   Läuft im Browser (window.Barcode) und in Node (require), dort für die Tests. */
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(root, node ? require('./lebensmittel.js') : root.Lebensmittel);
  if (node) module.exports = api;
  else root.Barcode = api;
})(typeof self !== 'undefined' ? self : globalThis, function (root, Lebensmittel) {
'use strict';

const FORMATE = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
const OFF_URL = 'https://world.openfoodfacts.org';
const OFF_FELDER = ['code', 'product_name', 'product_name_de', 'generic_name', 'generic_name_de', 'brands', 'product_quantity', 'product_quantity_unit', 'nutriments', 'categories_tags', 'ingredients_tags'].join(',');
// Ordner dieser Datei, damit vendor/ auch gefunden wird, wenn die App nicht im Wurzelverzeichnis liegt
const BASIS = (() => { try { return new URL('.', document.currentScript.src).href; } catch (e) { return ''; } })();

/* ---------- Codes ---------- */
// UPC-E ist ein gekürzter UPC-A: zurück auf zwölf Stellen bringen
function upcE(code) {
  if (!/^[01]\d{7}$/.test(code)) return null;
  const d = code.slice(1, 7);
  let mitte;
  switch (d[5]) {
    case '0': case '1': case '2': mitte = d.slice(0, 2) + d[5] + '0000' + d.slice(2, 5); break;
    case '3': mitte = d.slice(0, 3) + '00000' + d.slice(3, 5); break;
    case '4': mitte = d.slice(0, 4) + '00000' + d[4]; break;
    default: mitte = d.slice(0, 5) + '0000' + d[5];
  }
  return code[0] + mitte + code[7];
}
// Bringt einen gelesenen oder eingetippten Code in die Form, unter der Produkte gespeichert werden:
// EAN-13 (UPC-A bekommt eine 0 davor) oder EAN-8. Falsche Prüfziffer oder Länge ergibt null.
function normieren(roh, format = '') {
  let c = String(roh == null ? '' : roh).replace(/[\s-]/g, '');
  if (!/^\d+$/.test(c)) return null;
  if (format === 'upc_e' || (!format && c.length === 8 && !Lebensmittel.gtinGueltig(c) && upcE(c))) c = upcE(c) || '';
  if (c.length === 12) c = '0' + c;
  if (c.length === 14 && c[0] === '0') c = c.slice(1);
  if (c.length !== 8 && c.length !== 13) return null;
  return Lebensmittel.gtinGueltig(c) ? c : null;
}

/* ---------- Open Food Facts ---------- */
const r2 = v => Math.round(v * 100) / 100;
function wert(n, k) { const v = Number(n[k]); return n[k] !== '' && n[k] != null && Number.isFinite(v) && v >= 0 ? v : null; }
const NAEHRSTOFFE = { protein: 'proteins_100g', kh: 'carbohydrates_100g', zucker: 'sugars_100g', fett: 'fat_100g', gesFett: 'saturated-fat_100g', ballaststoffe: 'fiber_100g', salz: 'salt_100g', omega3: 'omega-3-fat_100g' };
// Zutaten, deren Zucker als zugesetzt zählt
const ZUCKER = new Set(['sugar', 'cane-sugar', 'brown-sugar', 'raw-cane-sugar', 'glucose', 'dextrose', 'fructose', 'glucose-syrup', 'glucose-fructose-syrup', 'fructose-glucose-syrup', 'invert-sugar', 'invert-sugar-syrup', 'sugar-syrup', 'caramelised-sugar-syrup', 'honey', 'maple-syrup', 'agave-syrup', 'rice-syrup'].map(x => 'en:' + x));

// Abteilung, Art und Merkmale aus den Kategorien von Open Food Facts ableiten. Die Kategorien sind
// hierarchisch, ein Produkt trägt auch die übergeordneten (Linsen → Hülsenfrüchte → pflanzliche Lebensmittel).
// Nur ein Vorschlag: Vor dem Speichern lässt sich alles im Formular ändern.
function offZuordnung(p, d) {
  const tags = new Set(p.categories_tags || []);
  const hat = (...w) => w.some(x => tags.has('en:' + x));
  const alle = [...tags].join(' ');
  const name = Lebensmittel.normTxt([d.name, p.generic_name_de, p.generic_name].filter(Boolean).join(' '));
  const vollkorn = /vollkorn|hafer|dinkel.*voll/.test(name) || /whole-?grain|wholemeal|wholewheat|whole-wheat|oat/.test(alle);
  const getreide = hat('breads', 'pastas', 'rices', 'flours', 'cereals-and-their-products', 'cereal-grains', 'breakfast-cereals');
  let art = 'sonstiges';
  if (hat('sweeteners', 'sugars', 'honeys', 'syrups')) art = 'suess';
  else if (hat('vegetable-oils', 'olive-oils', 'oils', 'fats', 'butters', 'margarines')) art = 'fett';
  else if (hat('tofu', 'tofus', 'meat-alternatives', 'meat-analogues', 'meats', 'poultries', 'fishes', 'seafood', 'eggs', 'cheeses', 'yogurts', 'milks', 'dairies')) art = (d.fett || 0) >= 20 && (d.protein || 0) < 8 ? 'fett' : 'eiweiss';
  else if (hat('plant-based-milk-alternatives', 'milk-substitutes')) art = (d.protein || 0) >= 2.5 ? 'eiweiss' : 'sonstiges';
  else if (hat('nuts', 'nuts-and-their-products', 'seeds', 'nut-butters', 'peanut-butters')) art = 'nuesse';
  else if (hat('legumes', 'pulses', 'beans', 'lentils', 'chickpeas') && !hat('spreads', 'meals')) art = 'huelsenfrucht';
  else if (hat('potatoes')) art = 'staerke';
  else if (hat('fruit-juices', 'juices', 'fruit-based-beverages', 'jams', 'compotes')) art = 'sonstiges';
  else if (hat('fruits')) art = 'obst';
  else if (hat('vegetables')) art = 'gemuese';
  else if (getreide) art = vollkorn ? 'vollkorn' : 'weissmehl';
  else if (hat('condiments', 'sauces', 'spices', 'herbs', 'salts', 'vinegars', 'broths')) art = 'aromaten';

  let kategorie = 'sonstiges';
  if (hat('frozen-foods')) kategorie = 'tk';
  else if (hat('canned-foods')) kategorie = 'konserven';
  else if (hat('butters', 'margarines', 'dairies', 'meats', 'fishes', 'eggs', 'tofu', 'tofus', 'meat-alternatives', 'plant-based-milk-alternatives', 'milk-substitutes')) kategorie = 'kuehl';
  else if (hat('dried-fruits', 'dried-vegetables')) kategorie = 'trocken';
  else if (art === 'obst' || art === 'gemuese' || art === 'staerke') kategorie = 'obst-gemuese';
  else if (hat('breads', 'pastries', 'cakes', 'biscuits', 'viennoiseries')) kategorie = 'brot';
  else if (getreide || art === 'huelsenfrucht' || art === 'nuesse') kategorie = 'trocken';
  else if (art === 'fett' || art === 'aromaten' || art === 'suess') kategorie = 'oel-gewuerze';

  const zuckerZugesetzt = art !== 'suess' && ((p.ingredients_tags || []).some(z => ZUCKER.has(z))
    || hat('sodas', 'sweetened-beverages', 'fruit-juices', 'confectioneries', 'chocolates', 'sweet-snacks', 'biscuits', 'jams'));
  const trocken = art === 'huelsenfrucht' && kategorie === 'trocken';
  return { kategorie, art, zuckerZugesetzt, trocken };
}
// Ein Produkt von Open Food Facts in die Felder eines eigenen Lebensmittels übersetzen (pro 100 g)
function offUmrechnen(p, code) {
  const n = p.nutriments || {};
  const d = { barcode: code, quelle: `Open Food Facts · ${code}` };
  d.name = String(p.product_name_de || p.product_name || p.generic_name_de || p.generic_name || '').trim().replace(/\s+/g, ' ');
  const marke = String(p.brands || '').split(',')[0].trim();
  if (marke) d.marke = marke;
  let kcal = wert(n, 'energy-kcal_100g');
  if (kcal == null) { const kj = wert(n, 'energy-kj_100g') ?? wert(n, 'energy_100g'); if (kj != null) kcal = kj / 4.184; }
  if (kcal != null) d.kcal = Math.round(kcal);
  for (const [k, f] of Object.entries(NAEHRSTOFFE)) { const v = wert(n, f); if (v != null) d[k] = r2(v); }
  if (d.salz == null) { const na = wert(n, 'sodium_100g'); if (na != null) d.salz = r2(na * 2.5); }
  // Packungsgröße als Stück, damit Rezepte „1 Packung“ sagen können
  const q = Number(p.product_quantity), u = String(p.product_quantity_unit || 'g').toLowerCase();
  if (q > 0 && q <= 10000 && (u === 'g' || u === 'ml')) { d.gProStk = r2(q); d.stkName = 'Packung'; }
  return Object.assign(d, offZuordnung(p, d));
}
// Schlägt einen Barcode bei Open Food Facts nach. Gibt die Felder eines Lebensmittels zurück oder null,
// wenn das Produkt dort fehlt. Wirft einen Fehler, wenn Open Food Facts nicht erreichbar ist.
async function offAbfragen(code, { fetch: holen = root.fetch, timeout = 10000 } = {}) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const uhr = ctrl ? setTimeout(() => ctrl.abort(), timeout) : null;
  let r, j;
  try {
    r = await holen(`${OFF_URL}/api/v2/product/${encodeURIComponent(code)}.json?fields=${OFF_FELDER}`, ctrl ? { signal: ctrl.signal } : {});
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('HTTP ' + r.status);
    j = await r.json();
  } catch (e) {
    const f = new Error('Open Food Facts ist gerade nicht erreichbar. Bist du online?');
    f.cause = e;
    throw f;
  } finally { clearTimeout(uhr); }
  if (!j || j.status === 0 || !j.product) return null;
  return offUmrechnen(j.product, code);
}
const offLink = code => `${OFF_URL}/product/${encodeURIComponent(code)}`;

/* ---------- Lesen ---------- */
function skriptLaden(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Nicht geladen: ' + src));
    document.head.appendChild(s);
  });
}
let erkennerLauf = null;
// Liefert { detector, nativ }: den eingebauten BarcodeDetector, wenn er EAN kann, sonst ZXing aus vendor/
function erkenner() {
  if (erkennerLauf) return erkennerLauf;
  erkennerLauf = (async () => {
    if (typeof root.BarcodeDetector === 'function') {
      try {
        const f = await root.BarcodeDetector.getSupportedFormats();
        if (f.includes('ean_13')) return { detector: new root.BarcodeDetector({ formats: FORMATE.filter(x => f.includes(x)) }), nativ: true };
      } catch (e) { /* weiter mit ZXing */ }
    }
    try {
      if (!root.BarcodeDetectionAPI) await skriptLaden(BASIS + 'vendor/barcode-detector/ponyfill.js');
      const api = root.BarcodeDetectionAPI;
      await api.prepareZXingModule({
        overrides: { locateFile: (pfad, prefix) => pfad.endsWith('.wasm') ? BASIS + 'vendor/zxing-wasm/' + pfad : prefix + pfad },
        fireImmediately: true
      });
      return { detector: new api.BarcodeDetector({ formats: FORMATE }), nativ: false };
    } catch (e) {
      const f = new Error('Der Barcode-Leser ließ sich nicht laden. Tipp die Nummer ein.');
      f.cause = e;
      throw f;
    }
  })();
  erkennerLauf.catch(() => { erkennerLauf = null; });
  return erkennerLauf;
}
function kameraFehler(e) {
  const n = e && e.name;
  const text = n === 'NotAllowedError' || n === 'SecurityError' ? 'Kein Zugriff auf die Kamera. Erlaube ihn in den Einstellungen des Browsers, oder wähl ein Foto.'
    : n === 'NotFoundError' || n === 'OverconstrainedError' || n === 'KeineKamera' ? 'Keine Kamera gefunden. Wähl ein Foto oder tipp die Nummer ein.'
    : n === 'NotReadableError' || n === 'AbortError' ? 'Die Kamera wird gerade von einem anderen Programm benutzt.'
    : n === 'Unsicher' ? 'Die Kamera geht nur über eine sichere Verbindung (https). Wähl ein Foto oder tipp die Nummer ein.'
    : 'Die Kamera ließ sich nicht starten. Wähl ein Foto oder tipp die Nummer ein.';
  const f = new Error(text);
  f.cause = e;
  return f;
}
// Startet die Rückkamera im video-Element und sucht laufend nach Barcodes. treffer(code) bekommt den
// ersten Code mit gültiger Prüfziffer, der zweimal gleich gelesen wurde. Gibt { stoppen, licht } zurück,
// licht ist null, wenn die Kamera keine Lampe hat.
async function kameraScan(video, { detector, treffer, fehler = () => {} }) {
  const md = root.navigator && root.navigator.mediaDevices;
  if (!md || !md.getUserMedia) throw kameraFehler({ name: root.isSecureContext === false ? 'Unsicher' : 'KeineKamera' });
  let stream;
  try { stream = await md.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } }); }
  catch (e) { throw kameraFehler(e); }
  video.muted = true;
  video.setAttribute('playsinline', '');
  video.srcObject = stream;
  try { await video.play(); } catch (e) { /* startet beim nächsten Bild */ }
  const spur = stream.getVideoTracks()[0];
  let laeuft = true, letzter = '', uhr = null;
  const stoppen = () => {
    laeuft = false; clearTimeout(uhr);
    stream.getTracks().forEach(t => t.stop());
    video.srcObject = null;
  };
  const runde = async () => {
    if (!laeuft) return;
    try {
      if (video.readyState >= 2 && video.videoWidth) {
        for (const b of await detector.detect(video)) {
          const c = normieren(b.rawValue, b.format);
          if (!c) continue;
          if (c === letzter && laeuft) { stoppen(); treffer(c); return; }
          letzter = c;
          break;
        }
      }
    } catch (e) {
      if (laeuft) { stoppen(); fehler(e); }
      return;
    }
    if (laeuft) uhr = setTimeout(runde, 120);
  };
  runde();
  let lampe = false;
  try { lampe = !!(spur && spur.getCapabilities && spur.getCapabilities().torch); } catch (e) { lampe = false; }
  return { stoppen, licht: lampe ? an => spur.applyConstraints({ advanced: [{ torch: !!an }] }) : null };
}
// Sucht in einem Foto nach einem Barcode. Gibt den Code zurück oder null.
async function bildScan(datei, detector) {
  let bild;
  try { bild = await createImageBitmap(datei); }
  catch (e) { throw new Error('Das Bild ließ sich nicht öffnen.'); }
  try {
    for (const b of await detector.detect(bild)) { const c = normieren(b.rawValue, b.format); if (c) return c; }
    return null;
  } finally { if (bild.close) bild.close(); }
}

return { FORMATE, OFF_URL, normieren, upcE, offUmrechnen, offAbfragen, offLink, erkenner, kameraScan, bildScan };
});
