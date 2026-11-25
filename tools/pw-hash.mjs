// Erzeugt Hash und Salt für ein neues Passwort – passend zu src/worker.js
// (PBKDF2-SHA256, 100.000 Runden, 256 Bit, base64url ohne Padding).
// Aufruf:  node tools/pw-hash.mjs                  -> erzeugt ein zufälliges vorläufiges Passwort
//          node tools/pw-hash.mjs "MeinPasswort"   -> eigenes Passwort (mind. 8 Zeichen)
//          EMAIL=name@beko.com node tools/pw-hash.mjs   -> für eine andere Adresse
// Benötigt Node.js 18 oder neuer. Die Ausgabe NICHT ins Repository übernehmen.
const enc = new TextEncoder();
const b64u = buf => Buffer.from(new Uint8Array(buf)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rnd = n => b64u(crypto.getRandomValues(new Uint8Array(n)));
async function pwHash(pw, salt) {
  const k = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return b64u(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 100000 }, k, 256));
}
const email = String(process.env.EMAIL || 'harald.kasperowski@beko.com').trim().toLowerCase();
const pw = process.argv[2] || ('Rtt-' + rnd(9).replace(/[^A-Za-z0-9]/g, 'x'));
if (pw.length < 8) { console.error('Das Passwort braucht mindestens 8 Zeichen.'); process.exit(1); }
const salt = rnd(16);
const hash = await pwHash(pw, salt);
console.log('Passwort:  ' + pw);
console.log('\nIn der D1-Console ausführen:\n');
console.log(`UPDATE users SET pw = '${hash}', salt = '${salt}' WHERE email = '${email.replace(/'/g, "''")}';`);
