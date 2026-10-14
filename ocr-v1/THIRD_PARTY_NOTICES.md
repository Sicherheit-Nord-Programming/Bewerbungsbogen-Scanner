# Lokale OCR-Komponenten

Der mobile Scanner verarbeitet die Dokumenterkennung ausschließlich lokal im
Browser. Die folgenden unveränderten, selbst gehosteten Dateien werden aus den
angegebenen, exakt gepinnten NPM-Paketen ausgeliefert:

- `tesseract.js@7.0.0` – Apache License 2.0
- `tesseract.js-core@7.0.0` – Apache License 2.0
- `@tesseract.js-data/deu@1.0.0` (`4.0.0_best_int`) – MIT
- `@tesseract.js-data/eng@1.0.0` (`4.0.0_best_int`, vorgehaltene
  Sprachreserve) – MIT

Die vollständigen Apache-Lizenztexte und der Lizenzhinweis des gebündelten
Workers liegen im Unterordner `licenses/`. Die unveränderte deutsche
Sprachdatei stammt aus dem genannten NPM-Sprachdatenpaket. Für sie gilt die
folgende MIT-Lizenz:

> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to
> deal in the Software without restriction, including without limitation the
> rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
> sell copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in
> all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

Bezugsquellen:

- https://www.npmjs.com/package/tesseract.js/v/7.0.0
- https://www.npmjs.com/package/tesseract.js-core/v/7.0.0
- https://www.npmjs.com/package/@tesseract.js-data/deu/v/1.0.0
- https://www.npmjs.com/package/@tesseract.js-data/eng/v/1.0.0

Die OCR-Prüfung bestätigt nur, dass die sichtbare Aufnahme zum ausgewählten
unterstützten Dokumenttyp und zur ausgewählten Seite passt. Sie ist keine
Echtheits-, Gültigkeits- oder Lebenderkennung.
