# Nicos Kochbuch

Rezepte, Wochenplan, Einkaufsliste und Nährwerte in einer Web-App. Das Kochbuch entsteht als Claude-Artifact und wird Schritt für Schritt zu einer eigenständigen App.

## Dateien

| Datei | Inhalt |
| --- | --- |
| `index.html` | Die App: Oberfläche, Bewertung der Rezepte, Wochenplan, Einkaufsliste |
| `lebensmittel.js` | Lebensmittel-Datenbank, lokal im Browser (IndexedDB) |
| `barcode.js` | Barcodes lesen (Kamera, Foto, Eingabe) und Produkte bei Open Food Facts nachschlagen |
| `bls.json` | Bundeslebensmittelschlüssel 4.0, 7.140 Lebensmittel mit Nährwerten pro 100 g |
| `vendor/` | Barcode-Leser für Browser ohne eingebauten: barcode-detector 3.2.2 und zxing-wasm 3.1.3 |
| `tests/` | Tests für Datenbank und Barcodes |

Alle Dateien gehören zusammen und müssen so nebeneinander liegen.

## Starten

Die Seite lädt `bls.json` nach, deshalb braucht sie einen Webserver. Als Datei (`file://`) geöffnet, fehlt der Bundeslebensmittelschlüssel.

```bash
python3 -m http.server 8000
```

Danach http://localhost:8000 öffnen. GitHub Pages oder jeder andere statische Webserver geht genauso.

Für die Kamera braucht der Browser eine sichere Verbindung: `https://` oder `localhost` auf demselben Rechner. Am Handy also über GitHub Pages oder einen anderen Server mit https öffnen, nicht über die IP-Adresse im WLAN.

Rezepte, Wochenplan, Einkaufsliste und Ziele liegen bisher im Speicher von Claude und erscheinen nur, wenn das Kochbuch als Artifact in Claude geöffnet ist. Die Lebensmittel-Datenbank funktioniert schon ohne Claude.

## Lebensmittel-Datenbank

Reiter **Lebensmittel**: alle Einträge durchsuchen, nach Gruppe filtern, Nährwerte pro 100 g und pro Stück ansehen, eigene Lebensmittel anlegen (etwa Markenprodukte mit den Werten von der Packung), sie als Zutat ins Kochbuch übernehmen und als JSON sichern oder wieder einlesen.

Die Suche im Zutaten-Formular und im Rezept-Editor greift auf dieselbe Datenbank zu und findet damit auch eigene Lebensmittel.

### Aufbau

- **Speicher:** IndexedDB-Datenbank `kochbuch` (Version 1) mit den Tabellen `lebensmittel` (eigene Lebensmittel) und `katalog` (zwischengespeicherter BLS, damit er offline da ist). Ändert sich `bls.json`, wird der Zwischenspeicher beim nächsten Start still erneuert. Ohne IndexedDB, etwa im privaten Fenster, läuft alles im Arbeitsspeicher weiter.
- **Herkunft:** `bls` (nur lesbar, id `bls:<Code>`) oder `eigen` (id `eigen:<name>-<zufall>`).
- **Felder eines Lebensmittels** (Nährwerte pro 100 g):
  - `name`, `marke`, `barcode` (EAN, 8 bis 14 Ziffern), `basis` (BLS-Code, auf dem es beruht)
  - `kcal`, `protein`, `kh`, `zucker`, `fett`, `gesFett`, `ballaststoffe`, `salz`, `omega3`
  - `kategorie` (Abteilung im Supermarkt), `art` (für die Bewertung der Rezepte)
  - `gProStk`, `stkName`, `gProEL`, `dichte` (Umrechnung von Stück, Esslöffel und Millilitern in Gramm)
  - `basic`, `zuckerZugesetzt`, `trocken`, `erstellt`, `geaendert`
- **Prüfung:** Ohne Namen und Kalorien wird nicht gespeichert. Unmögliche Werte (negativ, mehr als 100 g in 100 g, mehr gesättigte Fettsäuren als Fett, mehr Zucker als Kohlenhydrate) werden abgelehnt.
- **Sicherung:** JSON mit `format: "kochbuch-lebensmittel"`, `version: 1` und der Liste `lebensmittel`. Beim Einlesen gewinnt bei gleicher id der jüngere Stand.

### Schnittstelle

```js
const LM = Lebensmittel.erstellen();
await LM.laden();                                 // eigene Lebensmittel und BLS
LM.suche('Haferflocken', { max: 8, veg: true });  // filter: '', 'eigen', 'bls' oder BLS-Hauptgruppe wie 'G'
LM.liste({ filter: 'eigen' });
const skyr = await LM.speichern({ name: 'Skyr', marke: 'Hofmolkerei', kcal: 63, protein: 11, kh: 4, fett: 0.2 });
await LM.speichern({ ...skyr, kcal: 65 }, skyr.id);
await LM.loeschen(skyr.id);
const sicherung = LM.exportieren();
await LM.importieren(sicherung);
LM.abonnieren(() => { /* etwas hat sich geändert */ });
```

## Barcode-Scanner

Im Reiter **Lebensmittel** über **Barcode scannen**, im Formular eines eigenen Lebensmittels am Feld „Barcode“ und im Zutaten-Formular.

- **Lesen:** mit der Kamera (Rückkamera am Handy, Webcam am PC, Licht ein- und ausschaltbar, wo die Kamera eins hat), aus einem Foto oder durch Eintippen der Nummer. Ein Handscanner am PC tippt die Nummer einfach ins Feld. Gelesen werden die Strichcodes auf Lebensmitteln: EAN-13, EAN-8, UPC-A und UPC-E. Die Prüfziffer wird kontrolliert, und ein Code zählt erst, wenn die Kamera ihn zweimal gleich gelesen hat.
- **Nachschlagen:** zuerst in den eigenen Lebensmitteln (geht offline), dann bei [Open Food Facts](https://world.openfoodfacts.org), einer freien Produktdatenbank mit vielen Produkten aus deutschen Supermärkten. Name, Marke, Nährwerte pro 100 g und Packungsgröße kommen ins Formular, Abteilung und Art schlägt das Kochbuch aus den Kategorien vor. Nach dem Prüfen und Speichern ist das Produkt ein eigenes Lebensmittel und wird beim nächsten Scan ohne Internet erkannt.
- **Unbekannte Produkte:** Das Formular öffnet sich mit dem Barcode, die Werte kommen von der Packung.

| Gerät | Barcode-Leser |
| --- | --- |
| Android, Chrome | eingebaut im Browser |
| PC, Chrome und Edge unter Windows und Linux, Firefox | ZXing aus `vendor/`, wird beim ersten Scan geladen (rund 1 MB) |
| Mac, Chrome | eingebaut im Browser |
| iPhone und iPad, Safari | ZXing aus `vendor/`. Sollte gehen, ist aber noch nicht auf einem echten Gerät getestet |

## Tests

```bash
node --test
```

Braucht Node 18 oder neuer, sonst nichts.

## Fahrplan

1. **Lebensmittel-Datenbank** (erledigt): lokal, offline, mit eigenen Lebensmitteln und Sicherung.
2. **Alles lokal speichern:** Rezepte, Wochenplan, Einkaufsliste und Ziele kommen als weitere Tabellen in dieselbe IndexedDB. Zutaten werden zu eigenen Lebensmitteln. Danach braucht das Kochbuch Claude nicht mehr.
3. **Installierbar und offline:** Web-App-Manifest und Service Worker, damit sich das Kochbuch wie eine App auf dem Handy installieren lässt.
4. **Barcode** (erledigt): scannen mit Kamera, Foto oder Handscanner, Produkte aus Open Food Facts übernehmen.
5. **Abgleich zwischen Geräten:** Bis dahin bringt die Sicherung als JSON die eigenen Lebensmittel auf ein anderes Gerät.

## Quellen und Lizenzen

- Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0. Karlsruhe. Lizenz [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Aufbereitet über waistline-bls (MIT), Werte gerundet und auf ausgewählte Nährstoffe reduziert.
- Produktdaten beim Scannen: [Open Food Facts](https://world.openfoodfacts.org), Lizenz [ODbL](https://opendatacommons.org/licenses/odbl/1-0/).
- `vendor/barcode-detector`: [barcode-detector](https://github.com/Sec-ant/barcode-detector) 3.2.2, MIT.
- `vendor/zxing-wasm`: [zxing-wasm](https://github.com/Sec-ant/zxing-wasm) 3.1.3, MIT. Enthält [zxing-cpp](https://github.com/zxing-cpp/zxing-cpp), Apache License 2.0. Die Lizenztexte liegen in den Ordnern.
