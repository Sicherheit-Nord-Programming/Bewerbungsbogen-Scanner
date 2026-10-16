# Mobiler Ausweisscanner

Die öffentliche Scan-Seite ist unter
`https://sicherheit-nord-ausweisscan.web.app/` erreichbar. Sie läuft bewusst
außerhalb der Google-Apps-Script-HTML-Sandbox,
damit der Browser die rückseitige Smartphone-Kamera über `getUserMedia()`
freigeben kann.

Die bisherige GitHub-Pages-Adresse bleibt als Legacy-Einstieg bestehen und
leitet bestehende Scan-QR-Codes unter Erhalt von Querystring und URL-Fragment
an die neutrale Sicherheit-Nord-Adresse weiter.

## Veröffentlichung

Ein gewöhnlicher GitHub-Push aktualisiert Firebase Hosting nicht automatisch.
Nach einer geprüften Scanner-Änderung wird deshalb zusätzlich ausgeführt:

```powershell
npx firebase-tools deploy --only hosting --project sicherheit-nord-aufschaltung --non-interactive
```

`firebase.json` bindet den Befehl ausdrücklich an die separate Hosting-Site
`sicherheit-nord-ausweisscan`. Die bestehende Aufschaltungs-Seite wird dadurch
nicht überschrieben.

## QR-Fragment

Die Seite erwartet ausschließlich ein URL-Fragment. Geheimnisse erscheinen
dadurch nicht in HTTP-Requests oder Server-Logs:

```text
#v=1|2&s=<session-uuid>&u=<upload-capability>&k=<aes-256-key>&e=<apps-script-exec-url>
#v=3&d=<station-id>&p=<pairing-key>&e=<apps-script-exec-url>
#<compact-code>
```

- `v=1`: bisheriger Direktfluss für Vorder- und Rückseite des Personalausweises
- `v=2`: Dokumentauswahl für Personalausweis, Reisepass und
  Krankenkassenkarte
- `v=3`: dauerhaft gleicher QR-Code einer eingeschriebenen Laptop-Station;
  `discover` liefert nur den verschlüsselten Bootstrap der aktuell geöffneten
  Einmalsitzung
- `compact-code`: aktueller kurzer QR-Code aus 16 Byte als kanonisches
  Base64url; Stationskennung und Kopplungsschlüssel werden daraus lokal
  abgeleitet, der feste Produktions-Relay steht nicht mehr sichtbar im QR
- `s`: UUID der einmaligen Sitzung
- `u`: 32 Byte Upload-Capability als Base64url ohne Padding
- `k`: 32 Byte AES-256-Schlüssel als Base64url ohne Padding
- `e`: rohe, URL-kodierte Apps-Script-`/exec`-Adresse

Nach dem Einlesen entfernt die Seite das Fragment sofort aus der sichtbaren
Adresse. Der Schlüssel wird als nicht exportierbarer Web-Crypto-Schlüssel
importiert und niemals an den Relay-Dienst übertragen.

Bei `v=3` oder einem kompakten Code fragt das Handy die aktuelle Sitzung mit der
Stationskennung ab. Ist der Desktop noch beim Hintergrundstart, wird neutral
weiter gewartet. Der mit dem Kopplungsschlüssel per AES-256-GCM authentisierte
Bootstrap enthält danach den unveränderten v2-Sitzungsvertrag; Claim, Aufnahme
und Upload laufen wie bei `v=2`. Das erste Claim-Fenster ist kurz, die
anschließende Scan-Sitzung bleibt 15 Minuten gültig.

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
  "action": "discover|claim|upload|finalize|confirm",
  "request": {}
}
```

Der Content-Type lautet `text/plain;charset=UTF-8`. Die Request-Felder
entsprechen dem verschlüsselten Apps-Script-Relay-Protokoll.

## Aufnahme

1. Bei `v=1` wird nach einem gültigen QR-Fragment sofort die rückseitige Kamera
   angefordert. Bei `v=2` erscheint zuerst die Dokumentauswahl. Verweigert der
   Browser den Kamerastart, erscheint ein Fallback-Button.
2. Das Handy wird waagerecht gehalten. Solange es hochkant steht, pausieren
   Erkennung und Countdown und die Seite fordert zum Drehen auf. Nach dem
   Drehen läuft die Erkennung automatisch weiter. Karten und die Datenseite
   des Reisepasses liegen quer in einem großen, fast bildschirmhohen
   Scanrahmen. Leicht schräge Platzierung und kurzes Handzittern setzen den
   Countdown nicht sofort zurück.
3. Die schnelle Kanten- und Strukturprüfung erkennt eine zusammenhängende
   Dokumentfläche mit typischen Textbereichen und lehnt leere Flächen sowie
   regelmäßige Tastaturstrukturen ab. Sobald Dokument und Position passen, wird
   der Rahmen ohne wartende OCR grün und der Countdown beginnt.
4. Nach drei echten Sekunden stabiler Lage wird der aktuelle Videoframe
   unmittelbar eingefroren und das Handy vibriert, sofern der Browser dies
   erlaubt. Die Kamera endet und die Prüf- sowie Vorschauansicht kehrt sofort
   ins Hochformat zurück. Unterstützt der Browser die automatische Drehung
   nicht, wird die Kamera-Vollbildansicht verlassen und eine klare Aufforderung
   zum Hochkantdrehen eingeblendet. Eine drei Sekunden lang grün bestätigte
   Standardaufnahme wird direkt verarbeitet: Die bereits bestandene
   Dokumentprüfung wird nicht mit einer zweiten Strukturgrenze oder einer
   blockierenden OCR wiederholt. Bei manuell bereitgestellten Bildern und der
   Steuer-ID-Aufnahme bleiben die zusätzlichen Dokument- und OCR-Prüfungen
   erhalten.
5. Die technische Prüfung entspricht den Desktop-Grenzwerten für Auflösung,
   Helligkeit, Kontrast, Laplace-Schärfe, Clipping und lokale Spiegelung. Die
   zusätzliche Dokumenttypprüfung läuft, wo erforderlich, mit selbst gehostetem
   Tesseract.js ohne zusätzlichen OCR-Cloud-Dienst. Die Prüfung ist keine
   Echtheits-, Gültigkeits- oder Lebenderkennung.
6. Abgelehnte Aufnahmen bleiben mit einer verständlichen Meldung und
   **Neu aufnehmen** stehen; erst diese bewusste Auswahl öffnet die Kamera
   erneut. Angenommene Aufnahmen werden konservativ zugeschnitten und farblich
   optimiert. OCR-Texte werden nur im Arbeitsspeicher klassifiziert, weder
   protokolliert noch an den Relay-Dienst übertragen und anschließend verworfen.
   Unlesbare Schrift wird nicht generativ rekonstruiert.
7. Vor der verschlüsselten Übertragung bestätigt der Nutzer die sichtbare
   Vorschau. Bei zweiseitigen Dokumenten folgt automatisch die Rückseite. Sind
   weitere Dokumente ausgewählt, führt der Abschluss eines Dokuments zurück
   zur Dokumentauswahl. Nach dem letzten Dokument wird automatisch bestätigt.
8. Unterstützt der Kameratreiber `MediaTrackCapabilities.torch`, erscheint im
   Kamerabild ein Schalter für das Dauerlicht. Beim Verlassen, bei Fehlern und
   beim Stoppen der Kamera wird der Zustand zurückgesetzt.

## Wiederaufnahme nach dem Neuladen

Nach dem ersten erfolgreichen Verbindungsaufbau speichert der Browser nur einen
kurzlebigen, an Station und Sitzung gebundenen Wiederaufnahme-Nachweis. Beim
Neuladen oder erneuten Öffnen derselben QR-Adresse kann das Handy damit in die
laufende Sitzung zurückkehren. Der Nachweis läuft spätestens mit der Sitzung ab
und enthält weder Bilder noch OCR-Texte, entschlüsselte Schlüssel oder eine
Upload-Berechtigung.

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
