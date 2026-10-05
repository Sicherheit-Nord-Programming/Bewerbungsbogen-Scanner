# Mobiler Ausweisscanner

Diese statische Top-Level-Seite ist für die Veröffentlichung unter
`https://sicherheit-nord-programming.github.io/Bewerbungsbogen-Scanner/`
vorgesehen. Sie läuft bewusst außerhalb der Google-Apps-Script-HTML-Sandbox,
damit der Browser die rückseitige Smartphone-Kamera über `getUserMedia()`
freigeben kann.

## QR-Fragment

Die Seite erwartet ausschließlich ein URL-Fragment. Geheimnisse erscheinen
dadurch nicht in HTTP-Requests oder Server-Logs:

```text
#v=1|2&s=<session-uuid>&u=<upload-capability>&k=<aes-256-key>&e=<apps-script-exec-url>
```

- `v=1`: bisheriger Direktfluss für Vorder- und Rückseite des Personalausweises
- `v=2`: Dokumentauswahl für Personalausweis, Reisepass und
  Krankenkassenkarte
- `s`: UUID der einmaligen Sitzung
- `u`: 32 Byte Upload-Capability als Base64url ohne Padding
- `k`: 32 Byte AES-256-Schlüssel als Base64url ohne Padding
- `e`: rohe, URL-kodierte Apps-Script-`/exec`-Adresse

Nach dem Einlesen entfernt die Seite das Fragment sofort aus der sichtbaren
Adresse. Der Schlüssel wird als nicht exportierbarer Web-Crypto-Schlüssel
importiert und niemals an den Relay-Dienst übertragen.

Bei `v=2` werden zuerst eine, zwei oder drei Dokumentarten ausgewählt. Nach
`Fertig` ist dieser Scanplan gesperrt und die Kamera startet mit dem
ersten ausgewählten Dokument.
Folgende stabilen Slot-Bezeichner werden im unveränderten Request-Feld `side`
an `upload` und `finalize` übergeben:

```text
id-front, id-back, passport-data, health-front, health-back
```

Sobald alle Dokumente des festgelegten Scanplans vollständig übertragen sind,
sendet das Handy `confirm` automatisch mit der alphabetisch sortierten Liste
`slots`. Erst eine Relay-Antwort mit `ready` zeigt auf dem Handy den
erfolgreichen Abschluss an. Ein zusätzlicher manueller Abschluss ist nicht
erforderlich.

## HTTP-Relay

Jeder Aufruf ist ein preflight-freier POST direkt an `e`:

```json
{
  "schemaVersion": 1,
  "action": "claim|upload|finalize|confirm",
  "request": {}
}
```

Der Content-Type lautet `text/plain;charset=UTF-8`. Die Request-Felder
entsprechen dem verschlüsselten Apps-Script-Relay-Protokoll.

## Aufnahme

1. Bei `v=1` wird nach einem gültigen QR-Fragment sofort die rückseitige Kamera
   angefordert. Bei `v=2` erscheint zuerst die Dokumentauswahl. Verweigert der
   Browser den Kamerastart, erscheint ein Fallback-Button.
2. Ein toleranter Karten- oder Passrahmen erkennt Dokumentkanten nahe der
   Vorlage. Kurzes
   Handzittern setzt den Countdown nicht sofort zurück.
3. Nach drei echten Sekunden stabiler Lage wird der aktuelle Videoframe
   unmittelbar eingefroren. Das Handy vibriert, sofern der Browser dies erlaubt.
4. Die technische Prüfung entspricht den Desktop-Grenzwerten für Auflösung,
   Helligkeit, Kontrast, Laplace-Schärfe, Clipping und lokale Spiegelung.
5. Abgelehnte Aufnahmen starten automatisch neu. Angenommene Aufnahmen werden
   konservativ zugeschnitten und farblich optimiert. Es findet weder OCR noch
   generatives Rekonstruieren unlesbarer Schrift statt.
6. Vor der verschlüsselten Übertragung bestätigt der Nutzer die sichtbare
   Vorschau. Bei zweiseitigen Dokumenten folgt automatisch die Rückseite. Sind
   weitere Dokumente ausgewählt, führt der Abschluss eines Dokuments zurück
   zur Dokumentauswahl. Nach dem letzten Dokument wird automatisch bestätigt.
7. Unterstützt der Kameratreiber `MediaTrackCapabilities.torch`, erscheint im
   Kamerabild ein Schalter für das Dauerlicht. Beim Verlassen, bei Fehlern und
   beim Stoppen der Kamera wird der Zustand zurückgesetzt.

## Verschlüsselungsformat

`v=1` behält Header und AAD unverändert. `v=2` verwendet
`schemaVersion: 2`, den Slot im Headerfeld `side` und folgende AAD:

```text
SN-ID-CAPTURE/v2|<sessionId>|<slot>
```

## Lokale Tests

```powershell
node --test mobile-id-scanner/*.test.js
npx oxlint --no-ignore mobile-id-scanner
npx oxfmt --check mobile-id-scanner/*.js mobile-id-scanner/*.css mobile-id-scanner/*.html
```

Ein echter Kameratest benötigt einen sicheren Top-Level-Kontext (`https://`
oder während der Entwicklung `localhost`).
