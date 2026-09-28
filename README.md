# Bewerbungsbogen-Scanner

Diese öffentliche GitHub-Pages-Seite enthält ausschließlich die statische
Kameraoberfläche für den QR-gestützten Ausweisscan der Sicherheit-Nord-
Bewerbungsbogen-App.

Die Seite enthält keine Bewerbungsbögen, Ausweisdaten oder Zugangsdaten. Eine
Scan-Sitzung wird nur über das URL-Fragment eines kurzlebigen QR-Codes
initialisiert. Das Fragment wird nicht an GitHub Pages übertragen. Aufnahmen
werden bereits im Smartphone mit AES-256-GCM verschlüsselt und anschließend an
den kurzlebigen Relay der Desktop-App übertragen. Es gibt kein Tracking, kein
externes OCR und keine Speicherung im Browser.

Die automatische Prüfung bewertet ausschließlich technische Bildqualität wie
Auflösung, Beleuchtung, Kontrast, Spiegelung und Schärfe. Sie rekonstruiert oder
verändert keine Ausweisdaten.

