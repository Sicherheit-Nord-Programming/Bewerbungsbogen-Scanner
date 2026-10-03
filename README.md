# Bewerbungsbogen-Scanner

Die öffentliche Scan-Seite ist unter
<https://sicherheit-nord-ausweisscan.web.app/> erreichbar. Sie enthält
ausschließlich die statische
Kameraoberfläche für den QR-gestützten Ausweisscan der Sicherheit-Nord-
Bewerbungsbogen-App.

Die bisherige GitHub-Pages-Adresse bleibt als Legacy-Einstieg bestehen und
leitet Scan-Sitzungen unter Erhalt von URL-Query und -Fragment an die neue
Sicherheit-Nord-Adresse weiter.

Die Seite enthält keine Bewerbungsbögen, Ausweisdaten oder Zugangsdaten. Eine
Scan-Sitzung wird nur über das URL-Fragment eines kurzlebigen QR-Codes
initialisiert. Das Fragment wird bei der Weiterleitung nur im Browser übernommen
und nicht als Teil einer HTTP-Anfrage an GitHub Pages übertragen. Aufnahmen
werden bereits im Smartphone mit AES-256-GCM verschlüsselt und anschließend an
den kurzlebigen Relay der Desktop-App übertragen. Es gibt kein Tracking, kein
externes OCR und keine Speicherung im Browser.

## Veröffentlichung

Firebase Hosting wird wie beim Aufschaltungs-System bewusst aus dem geprüften
Repository-Stand veröffentlicht. Ein gewöhnlicher GitHub-Push aktualisiert die
Firebase-Seite nicht automatisch. Nach einer Scanner-Änderung wird deshalb im
Repository-Verzeichnis zusätzlich ausgeführt:

```sh
git pull --ff-only
firebase deploy --only hosting --project sicherheit-nord-aufschaltung --non-interactive
```

`firebase.json` bindet diesen Befehl ausdrücklich an die separate Hosting-Site
`sicherheit-nord-ausweisscan`, sodass die bestehende Aufschaltungs-Seite nicht
überschrieben wird.

Die automatische Prüfung bewertet ausschließlich technische Bildqualität wie
Auflösung, Beleuchtung, Kontrast, Spiegelung und Schärfe. Sie rekonstruiert oder
verändert keine Ausweisdaten.
