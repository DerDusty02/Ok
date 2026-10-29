// Tests für Barcodes und Open Food Facts. Aufruf: node --test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../lebensmittel.js');
const B = require('../barcode.js');

// Aufgebaut wie eine Antwort der Open-Food-Facts-API v2, Werte ausgedacht
const SKYR = {
  code: '4014400900057',
  product_name: 'Skyr natur', product_name_de: 'Skyr Natur', brands: 'Testmolkerei, Handelsmarke',
  product_quantity: '450', product_quantity_unit: 'g',
  categories_tags: ['en:dairies', 'en:fermented-foods', 'en:fermented-milk-products', 'en:yogurts', 'en:skyr'],
  ingredients_tags: ['en:skimmed-milk', 'en:dairy', 'en:milk', 'en:ferment'],
  nutriments: { 'energy-kcal_100g': 63, 'energy-kj_100g': 267, fat_100g: 0.2, 'saturated-fat_100g': 0.1, carbohydrates_100g: 4, sugars_100g: 4, proteins_100g: 11, salt_100g: 0.1, fiber_100g: '' }
};
const antwort = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

test('prüft und vereinheitlicht Barcodes', () => {
  assert.equal(B.normieren('4006040001232'), '4006040001232');
  assert.equal(B.normieren('4006040 001232'), '4006040001232');
  assert.equal(B.normieren('4006040001233'), null, 'falsche Prüfziffer');
  assert.equal(B.normieren('036000291452', 'upc_a'), '0036000291452', 'UPC-A bekommt eine 0 davor');
  assert.equal(B.normieren('90024900', 'ean_8'), '90024900');
  assert.equal(B.normieren('04252614', 'upc_e'), '0042100005264', 'UPC-E wird ausgeschrieben');
  assert.equal(B.normieren('04252614'), '0042100005264', 'eingetippter UPC-E');
  assert.equal(B.normieren('12345'), null);
  assert.equal(B.normieren('abc'), null);
  assert.equal(B.normieren(''), null);
});

test('übersetzt ein Produkt von Open Food Facts', () => {
  const d = B.offUmrechnen(SKYR, SKYR.code);
  assert.deepEqual(d, {
    barcode: '4014400900057', quelle: 'Open Food Facts · 4014400900057', name: 'Skyr Natur', marke: 'Testmolkerei',
    kcal: 63, protein: 11, kh: 4, zucker: 4, fett: 0.2, gesFett: 0.1, salz: 0.1, gProStk: 450, stkName: 'Packung',
    kategorie: 'kuehl', art: 'eiweiss', zuckerZugesetzt: false, trocken: false
  });
  // lässt sich unverändert als eigenes Lebensmittel speichern
  assert.equal(L.pruefen(d).barcode, '4014400900057');
});

test('rechnet kJ und Natrium um, wenn kcal oder Salz fehlen', () => {
  const d = B.offUmrechnen({ product_name: 'X', nutriments: { energy_100g: 418.4, sodium_100g: 0.4 } }, '4006040001232');
  assert.equal(d.kcal, 100);
  assert.equal(d.salz, 1);
  assert.equal(d.protein, undefined, 'fehlende Werte bleiben leer');
});

test('rechnet Angaben pro Portion auf 100 g um und liest Zahlen als Text', () => {
  const d = B.offUmrechnen({ product_name: 'Riegel', serving_quantity: '40', serving_quantity_unit: 'g', nutriments: { 'energy-kcal_serving': 160, proteins_serving: '8', fat_serving: 6, 'saturated-fat_100g': '1,5' } }, '4006040001232');
  assert.equal(d.kcal, 400);
  assert.equal(d.protein, 20);
  assert.equal(d.fett, 15);
  assert.equal(d.gesFett, 1.5, 'ein Wert pro 100 g geht vor');
  const ohne = B.offUmrechnen({ product_name: 'Riegel', nutriments: { 'energy-kcal_serving': 160 } }, '4006040001232');
  assert.equal(ohne.kcal, undefined, 'ohne Portionsgröße keine Umrechnung');
});

test('leitet Abteilung, Art und Merkmale ab', () => {
  const z = (tags, extra = {}) => { const d = B.offUmrechnen({ product_name: extra.name || 'X', categories_tags: tags.map(t => 'en:' + t), ingredients_tags: (extra.zutaten || []).map(t => 'en:' + t), nutriments: extra.n || {} }, '4006040001232'); return [d.kategorie, d.art, d.zuckerZugesetzt, d.trocken]; };
  assert.deepEqual(z(['plant-based-foods', 'legumes', 'pulses', 'lentils']), ['trocken', 'huelsenfrucht', false, true]);
  assert.deepEqual(z(['plant-based-foods', 'canned-foods', 'legumes', 'chickpeas']), ['konserven', 'huelsenfrucht', false, false]);
  assert.deepEqual(z(['cereals-and-their-products', 'pastas'], { name: 'Vollkorn Spaghetti' }), ['trocken', 'vollkorn', false, false]);
  assert.deepEqual(z(['cereals-and-their-products', 'pastas'], { name: 'Spaghetti' }), ['trocken', 'weissmehl', false, false]);
  assert.deepEqual(z(['frozen-foods', 'vegetables', 'spinachs']), ['tk', 'gemuese', false, false]);
  assert.deepEqual(z(['snacks', 'sweet-snacks', 'chocolates'], { zutaten: ['sugar', 'cocoa-butter'] }), ['sonstiges', 'sonstiges', true, false]);
  assert.deepEqual(z(['dairies', 'yogurts', 'fruit-yogurts'], { zutaten: ['milk', 'sugar'], n: { proteins_100g: 3.5 } }), ['kuehl', 'eiweiss', true, false]);
  assert.deepEqual(z(['dairies', 'creams'], { n: { fat_100g: 30, proteins_100g: 2.4 } }), ['kuehl', 'fett', false, false]);
  assert.deepEqual(z(['spreads', 'sweet-spreads', 'honeys']), ['oel-gewuerze', 'suess', false, false]);
  assert.deepEqual(z(['beverages', 'plant-based-milk-alternatives', 'oat-based-drinks'], { n: { proteins_100g: 1 } }), ['kuehl', 'sonstiges', false, false]);
});

test('fragt Open Food Facts ab', async () => {
  const urls = [];
  const holen = body => async url => { urls.push(url); return body; };
  const d = await B.offAbfragen('4014400900057', { fetch: holen(antwort(200, { status: 1, product: SKYR })) });
  assert.equal(d.name, 'Skyr Natur');
  assert.match(urls[0], /^https:\/\/world\.openfoodfacts\.org\/api\/v2\/product\/4014400900057\.json\?fields=/);
  assert.equal(await B.offAbfragen('4006040001232', { fetch: holen(antwort(404, { status: 0 })) }), null, 'unbekannt (HTTP 404)');
  assert.equal(await B.offAbfragen('4006040001232', { fetch: holen(antwort(200, { status: 0, status_verbose: 'product not found' })) }), null, 'unbekannt (status 0)');
  await assert.rejects(B.offAbfragen('4006040001232', { fetch: async () => { throw new TypeError('Failed to fetch'); } }), /nicht erreichbar/);
  await assert.rejects(B.offAbfragen('4006040001232', { fetch: holen(antwort(503, {})) }), /nicht erreichbar/);
});

test('findet eigene Lebensmittel per Barcode und verhindert doppelte Barcodes', async () => {
  const db = L.erstellen({ speicher: L.ramSpeicher(), blsText: async () => { throw new Error('nicht gebraucht'); } });
  const skyr = await db.speichern(B.offUmrechnen(SKYR, SKYR.code));
  assert.equal(skyr.quelle, 'Open Food Facts · 4014400900057');
  assert.equal(db.perBarcode('4014400900057').id, skyr.id);
  assert.equal(db.perBarcode('04014400900057').id, skyr.id, 'mit führender 0');
  assert.equal(db.perBarcode('4006040001232'), null);
  assert.equal(db.suche('4014400900057')[0].id, skyr.id, 'die Suche kennt den Barcode');

  await assert.rejects(db.speichern({ name: 'Anderer Skyr', kcal: 60, barcode: '4014400900057' }), /Diesen Barcode hat schon „Skyr Natur \(Testmolkerei\)“/);
  await db.speichern({ ...skyr, kcal: 64 }, skyr.id);

  const r = await db.importieren([{ name: 'Fremd', kcal: 1, barcode: '4014400900057' }, { name: 'Neu', kcal: 1, barcode: '4006040001232' }, { name: 'Auch neu', kcal: 1, barcode: '4006040001232' }]);
  assert.equal(r.neu, 1);
  assert.deepEqual(r.fehler.map(f => f.name), ['Fremd', 'Auch neu']);
});
