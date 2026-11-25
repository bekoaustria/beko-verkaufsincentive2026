# Admin-Passwort zurücksetzen (Cloudflare D1)

Es gibt kein festes Admin-Passwort. Admin-Rechte hängen nur an der E-Mail-Adresse in der Worker-Variable `ADMINS`.
Angemeldet wird mit dem Passwort, das bei der Registrierung gewählt wurde.

> **Wichtig:** Passwörter, Hashes und Salts gehören **nie** ins Repository.

## Weg 1 – über eine zweite Admin-Person (bevorzugt)

| Schritt | Was tun |
|---|---|
| 1 | Zweite Admin-Person meldet sich an und öffnet `…workers.dev/konten` |
| 2 | Beim betroffenen Konto auf **Passwort zurücksetzen** klicken |
| 3 | Das angezeigte vorläufige Passwort persönlich weitergeben |

Voraussetzung: Die zweite Adresse steht in `ADMINS` und hat ein Konto.

## Weg 2 – direkt in D1

| Schritt | Was tun |
|---|---|
| 1 | Lokal ausführen: `node tools/pw-hash.mjs` (zufälliges vorläufiges Passwort) oder `node tools/pw-hash.mjs "EigenesPasswort"`. Für eine andere Adresse: `EMAIL=name@beko.com node tools/pw-hash.mjs` |
| 2 | Cloudflare › **Storage & Databases › D1** › Datenbank mit der Bindung `DB` › **Console** |
| 3 | Prüfen: `SELECT id, email FROM users WHERE email = 'harald.kasperowski@beko.com';` – genau eine Zeile muss erscheinen |
| 4 | Den vom Skript ausgegebenen `UPDATE`-Befehl ausführen – Rückmeldung `changes: 1` |
| 5 | Unter `…workers.dev` mit E-Mail und neuem Passwort anmelden |

| Fall | Lösung |
|---|---|
| `SELECT` liefert keine Zeile | Noch kein Konto – in der App neu registrieren. Admin-Rechte kommen automatisch über `ADMINS`. |
| Anmeldung klappt nicht | E-Mail in D1 muss kleingeschrieben und exakt gleich sein. |
| Knopf „Verwaltung“ fehlt | Adresse fehlt in `ADMINS` (Worker › Settings › Variables and Secrets). |

Das Verfahren entspricht `pwHash()` in `src/worker.js` (PBKDF2-SHA256, 100.000 Runden).
Ändert sich dort das Verfahren, muss `tools/pw-hash.mjs` angepasst werden.
