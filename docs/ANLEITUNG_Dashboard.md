# Verkäufer:innen Incentive auf Cloudflare – Einrichtung ohne Node.js

Alles läuft über das Cloudflare-Dashboard im Browser. Dauer: ca. 15 Minuten.

## Dateien

| Datei | Wofür |
|---|---|
| worker.js | Server-Programm – wird einmal in den Worker kopiert |
| index.html | Die App selbst – wird unter /konten hochgeladen (auch bei jeder neuen Version) |
| incentive-daten.json | Einstellungen, Kampagnen, Mailingliste mit Außendienst-Kontakten, Vertrags-PDFs, Flyer und DEMO-Testdaten |
| Flyer_Verkaeuferinnen-Incentive_A4.pdf | Flyer (A4 quer, Wickelfalz, 2 Seiten) – ist im Datenimport schon enthalten, hier nur zur Ansicht oder für neue Fassungen |

## Schritt für Schritt

| Nr. | Wo im Dashboard | Was tun |
|---|---|---|
| 1 | Storage & Databases → D1 SQL Database → Create | Name `incentive-db`, Location: **Western Europe** → Create |
| 2 | Storage & Databases → Workers KV → Create | Name `incentive-files` → Create |
| 3 | Workers & Pages → Create → Worker → „Start with Hello World“ | Name `verkaeuferinnen-incentive` → Deploy |
| 4 | Worker → Edit code | Vorhandenen Code komplett löschen, Inhalt von **worker.js** einfügen → Deploy |
| 5 | Worker → Settings → Bindings → Add → D1 database | Variable name `DB` → Datenbank `incentive-db` → Add |
| 6 | Worker → Settings → Bindings → Add → KV namespace | Variable name `FILES` → Namespace `incentive-files` → Add |
| 7 | Worker → Settings → Variables and Secrets → Add | Typ **Text**: `ADMINS` = `harald.kasperowski@beko.com` (weitere Verwaltungs-Adressen mit Komma trennen) |
| 8 | ebenda → Add | Typ **Secret**: `SESSION_SECRET` = beliebige lange Zeichenfolge (mind. 32 Zeichen, z. B. aus einem Passwort-Generator) |
| 9 | ebenda → Add (optional) | Typ **Secret**: `ANTHROPIC_API_KEY` = API-Schlüssel aus console.anthropic.com – nur nötig für das automatische Auslesen von Rechnungen und die KI-Entwürfe im Wissenscheck |
| 10 | Browser: `https://verkaeuferinnen-incentive.harald-kasperowski.workers.dev/konten` | Mit der ADMINS-Adresse ein Passwort festlegen → „Konto erstellen“ |
| 11 | /konten → „1 · App-Datei hochladen“ | **index.html** auswählen |
| 12 | /konten → „2 · Daten importieren“ | **incentive-daten.json** auswählen |
| 13 | `/flyer` öffnen | Der Flyer ist öffentlich als PDF abrufbar (auch ohne Anmeldung) |
| 14 | Startseite öffnen | Fertig – unten links steht „Angemeldet als …“, oben erscheint „Verwaltung“ |

## Laufender Betrieb

| Aufgabe | So geht's |
|---|---|
| Neue App-Version | Unter /konten die neue index.html hochladen – Daten bleiben erhalten |
| Verkäufer:innen | Erstellen ihr Konto selbst über „Mein Bereich“; die Teilnahme gibst du wie gewohnt unter Verwaltung → Freigaben frei |
| Passwort vergessen | /konten → Konten → „Passwort zurücksetzen“ – vorläufiges Passwort persönlich weitergeben |
| Weitere Verwaltungs-Personen | E-Mail in `ADMINS` ergänzen (Schritt 7), die Person erstellt dann selbst ihr Konto |
| Flyer oder andere Downloads austauschen | /konten → „3 · Öffentliche Downloads“ – Datei hochladen, Link wird angezeigt; gleicher Dateiname ersetzt die alte Fassung |
| Datensicherung | /konten → „Sicherung herunterladen“ (regelmäßig, z. B. monatlich nach der Abrechnung) |
| Eigene Adresse, z. B. incentive.beko.at | Worker → Settings → Domains & Routes → Custom domain (Domain muss in Cloudflare verwaltet sein) |

## Unterschiede zur Version in Claude

| Thema | Cloudflare-Version |
|---|---|
| Anmeldung | Eigene Konten mit E-Mail und Passwort; Verwaltung = Adressen in `ADMINS` |
| Aktualisierung | Änderungen anderer erscheinen nach spätestens 15 Sekunden (statt sofort) |
| Rechnungen auslesen | Nur mit `ANTHROPIC_API_KEY`; ohne Schlüssel erfassen Verkäufer:innen die Geräte von Hand |
| Berechtigungen | Server-seitig geprüft: Verkäufer:innen sehen nur ihre eigenen Daten und können Freigaben, Prüfstatus und Auszahlungen nicht selbst ändern |
| Daten | Stand 17.10.2026 inkl. DEMO-Daten; ab jetzt getrennt von der Claude-Version – nur noch eine Version weiterführen |

## Änderungen (Stand 18.10.2026)

| Thema | Änderung |
|---|---|
| Registrierung | Unter „Mein Bereich → Registrierung“ gibt es die Schaltflächen **Konto erstellen** und **Anmelden**; „Mein Bereich“ aktualisiert sich nach dem Laden automatisch |
| Prüfung | Wird die Seite ohne Worker geöffnet (als Datei oder über Cloudflare Pages), zeigt „Mein Bereich“ einen klaren Hinweis. Richtig ist immer die Adresse `…workers.dev` |
| Bestehender Worker | Nur index.html unter /konten neu hochladen. Daten **nicht** erneut importieren, sonst werden angelegte Konten und Registrierungen überschrieben |
