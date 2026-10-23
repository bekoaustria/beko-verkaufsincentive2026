[README.md](https://github.com/user-attachments/files/33894927/README.md)
# Beko Verkaufs-Challenge 2026 · Race to Turkey

Verkäufer:innen Incentive von Beko Austria AG für den österreichischen Fachhandel (elektrabregenz · Beko · Indesit). Die Plattform läuft als Cloudflare Worker mit D1-Datenbank und KV-Speicher.

## Inhalt

| Pfad | Wofür |
|---|---|
| `src/worker.js` | Server-Programm (Anmeldung, Datenbank, Dateien, KI-Auslesen der Rechnungen) |
| `app/index.html` | Die App. Wird **nicht** automatisch ausgeliefert, sondern unter `/konten` hochgeladen |
| `wrangler.toml` | Konfiguration für das Deployment aus GitHub |
| `docs/ANLEITUNG_Dashboard.md` | Einrichtung ohne GitHub, direkt im Cloudflare-Dashboard |
| `docs/Flyer_Verkaeuferinnen-Incentive_A4.pdf` | Aktueller Flyer |

Die Datei `incentive-daten.json` (Einstellungen, Außendienst-Kontakte, Vertrags-PDFs) gehört **nicht** ins Repository und ist über `.gitignore` ausgeschlossen. Bitte nur lokal bzw. intern ablegen.

## Deployment aus GitHub

| Nr. | Wo | Was tun |
|---|---|---|
| 1 | GitHub | Neues **privates** Repository anlegen und den Inhalt dieses Ordners hochladen |
| 2 | Cloudflare → Storage & Databases → D1 | Datenbank `incentive-db` öffnen und die **Database ID** kopieren |
| 3 | Cloudflare → Storage & Databases → Workers KV | Namespace `incentive-files` öffnen und die **ID** kopieren |
| 4 | GitHub → `wrangler.toml` bearbeiten | Beide IDs bei `database_id` und `id` eintragen, speichern (Commit) |
| 5 | Cloudflare → Workers & Pages → `verkaeuferinnen-incentive` → Settings → Build | **Connect** → GitHub-Repository wählen, Branch `main`, Deploy-Befehl `npx wrangler deploy` |
| 6 | Cloudflare → Worker → Settings → Variables and Secrets | Prüfen: `ADMINS` (Text), `SESSION_SECRET` und optional `ANTHROPIC_API_KEY` (Secret) sind gesetzt |
| 7 | Browser: `…workers.dev/konten` | `app/index.html` hochladen (nur beim ersten Mal bzw. bei neuer App-Version) |

Ab dann wird jede Änderung an `src/worker.js` oder `wrangler.toml` im Branch `main` automatisch deployt. Daten in D1 und KV bleiben dabei erhalten.

## Neue App-Version

| Schritt | Was tun |
|---|---|
| 1 | Neue `app/index.html` ins Repository committen (Versionsstand) |
| 2 | Unter `…workers.dev/konten` → „1 · App-Datei hochladen“ dieselbe Datei hochladen |

Einen erneuten Datenimport bitte **nicht** durchführen, er überschreibt Konten und Registrierungen.

## Kontakt

Beko Austria AG · Pfarrgasse 77, 1230 Wien · [+43 1 615 39 00](tel:+4316153900) · [order.austria@beko.com](mailto:order.austria@beko.com)
