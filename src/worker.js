/*
 * Verkäufer:innen Incentive – Cloudflare Worker
 * Bindungen: D1-Datenbank als "DB", KV-Namespace als "FILES"
 * Variablen: ADMINS (E-Mails der Verwaltung, durch Komma getrennt)
 * Secrets:   SESSION_SECRET (Pflicht), ANTHROPIC_API_KEY (optional, für KI-Rechnungsauslesung), MODEL (optional)
 */
const enc = new TextEncoder();
const PATH_RE = /^[A-Za-z0-9_\-.:@+~]{1,120}\/[A-Za-z0-9_\-.:@+~]{1,200}$/;
const COLL_RE = /^[A-Za-z0-9_\-.:@+~]{1,120}$/;
const ANON_DOCS = new Set(['config/main']);
const ANON_COLS = new Set(['board', 'dboard', 'know']);
const PUB_RE = /^[A-Za-z0-9._-]{1,120}$/;
const pubName = n => String(n || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120);
const USER_READ = new Set(['config', 'admap', 'employers', 'serials', 'know', 'board', 'dboard']);

export default {
  async fetch(req, env) {
    try { await init(env); return await route(req, env); }
    catch (e) { return json({ error: String((e && e.message) || e) }, 500); }
  }
};

let READY = false;
async function init(env) {
  if (READY) return;
  if (!env.DB) throw new Error('D1-Bindung "DB" fehlt');
  if (!env.FILES) throw new Error('KV-Bindung "FILES" fehlt');
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS docs (path TEXT PRIMARY KEY, coll TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, upd INTEGER NOT NULL)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS docs_coll ON docs(coll)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, pw TEXT NOT NULL, salt TEXT NOT NULL, created INTEGER, last INTEGER)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS colv (coll TEXT PRIMARY KEY, v INTEGER NOT NULL)')
  ]);
  READY = true;
}

function json(o, s = 200, h = {}) { return new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...h } }); }
function html(t, s = 200) { return new Response(t, { status: s, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' } }); }
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rnd = n => b64u(crypto.getRandomValues(new Uint8Array(n)));
const now = () => Date.now();

/* ---------- Konten & Sitzung ---------- */
const isAdminEmail = (env, e) => String(env.ADMINS || '').toLowerCase().split(/[,;\s]+/).filter(Boolean).includes(String(e || '').toLowerCase());
async function hmac(env, msg) { const k = await crypto.subtle.importKey('raw', enc.encode(env.SESSION_SECRET || ''), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return b64u(await crypto.subtle.sign('HMAC', k, enc.encode(msg))); }
async function pwHash(pw, salt) { const k = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']); return b64u(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 100000 }, k, 256)); }
function safeEq(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
async function session(req, env) {
  if (!env.SESSION_SECRET) return null;
  const m = (req.headers.get('Cookie') || '').match(/(?:^|;\s*)vi_s=([^;]+)/); if (!m) return null;
  const [id, exp, sig] = m[1].split('.'); if (!id || !exp || !sig || +exp < now() / 1000) return null;
  if (!safeEq(sig, await hmac(env, id + '.' + exp))) return null;
  const u = await env.DB.prepare('SELECT id, email FROM users WHERE id = ?').bind(id).first(); if (!u) return null;
  u.admin = isAdminEmail(env, u.email); return u;
}
async function cookieFor(env, id) { const exp = Math.floor(now() / 1000) + 30 * 86400; return `vi_s=${id}.${exp}.${await hmac(env, id + '.' + exp)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 86400}`; }
const clearCookie = 'vi_s=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';

/* ---------- Datenbank ---------- */
async function getDoc(env, p) { const r = await env.DB.prepare('SELECT data FROM docs WHERE path = ?').bind(p).first(); return r ? JSON.parse(r.data) : null; }
function bump(env, c) { return env.DB.prepare('INSERT INTO colv (coll, v) VALUES (?, 1) ON CONFLICT(coll) DO UPDATE SET v = v + 1').bind(c); }
async function putDoc(env, p, d) { const [c, id] = p.split('/'); await env.DB.batch([env.DB.prepare('INSERT INTO docs (path, coll, id, data, upd) VALUES (?, ?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET data = excluded.data, upd = excluded.upd').bind(p, c, id, JSON.stringify(d), now()), bump(env, c)]); }
async function delDoc(env, p) { const c = p.split('/')[0]; await env.DB.batch([env.DB.prepare('DELETE FROM docs WHERE path = ?').bind(p), bump(env, c)]); }

function canRead(u, p) {
  const [c, id] = p.split('/');
  if (!u) return ANON_DOCS.has(p);
  if (u.admin) return true;
  if (c === 'sellers') return id === u.id;
  return USER_READ.has(c);
}
function canReadCol(u, c) { if (!u) return ANON_COLS.has(c); if (u.admin) return true; return ANON_COLS.has(c); }

/* Verkäufer:innen dürfen nur ihr eigenes Profil ändern – Freigaben, Prüfstatus und Auszahlungen bleiben der Verwaltung vorbehalten */
function guardSeller(prev, next, cfg) {
  prev = prev || {}; next = (next && typeof next === 'object') ? next : {};
  const pr = prev.p && prev.p.reg;
  if (next.p && typeof next.p === 'object') {
    if (pr && pr.st && pr.st !== 'no') next.p.reg = pr;
    else if (next.p.reg) { const r = next.p.reg; next.p.reg = { st: 'pending', sub: typeof r.sub === 'string' ? r.sub : new Date().toISOString() }; }
  } else if (prev.p) next.p = prev.p;
  const ps = new Map((prev.sales || []).map(s => [s.id, s]));
  const ns = (Array.isArray(next.sales) ? next.sales : []).map(s => { if (ps.has(s.id)) return ps.get(s.id); const c = { ...s, st: 'offen' }; for (const k of ['chk', 'paid', 'reason', 'by', 'noTs']) delete c[k]; return c; });
  for (const [id, s] of ps) if (!ns.some(x => x.id === id) && s.st !== 'offen') ns.push(s);
  next.sales = ns;
  const pr2 = new Map((prev.red || []).map(r => [r.id, r]));
  const RW = (cfg && cfg.rewards) || [], cap = Math.max(0, +((cfg && cfg.redCap) ?? 186));
  const rwEur = x => { const r = RW.find(q => q.id === x.rid); return r ? (r.eur != null && r.eur !== '' ? +r.eur : Math.round((+r.pts || 0) / 10)) : Math.round((+x.pts || 0) / 10); };
  const yr = String(new Date().getFullYear());
  let used = [...pr2.values()].filter(x => x.st !== 'no' && String(x.ts || '').slice(0, 4) === yr).reduce((a, x) => a + (x.eur != null ? +x.eur : rwEur(x)), 0);
  const nr = (Array.isArray(next.red) ? next.red : []).map(r => { if (pr2.has(r.id)) return pr2.get(r.id); const c = { ...r }; for (const k of ['st', 'done', 'by']) delete c[k];
    const rw = RW.find(q => q.id === c.rid); if (!rw) throw Object.assign(new Error('Prämie nicht gefunden'), { status: 400 });
    c.name = rw.name; c.pts = +rw.pts || 0; c.eur = rwEur(c); c.ts = new Date().toISOString();
    if (used + c.eur > cap) throw Object.assign(new Error(`Jahresrahmen für Sachprämien (€ ${cap}) überschritten`), { status: 409 });
    used += c.eur; return c; });
  for (const [id, r] of pr2) if (!nr.some(x => x.id === id)) nr.push(r);
  next.red = nr;
  return next;
}

/* ---------- Routen ---------- */
async function route(req, env) {
  const url = new URL(req.url), P = url.pathname, M = req.method;
  const mut = M !== 'GET' && M !== 'HEAD';
  if (mut && P.startsWith('/api/') && req.headers.get('X-VI') !== '1') return json({ error: 'Ungültige Anfrage' }, 403);

  if (P === '/shim.js') return new Response(SHIM_JS, { headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' } });
  if (P === '/konten') return html(KONTEN_HTML);

  const u = await session(req, env);

  if (P === '/' || P === '/index.html') {
    const app = await env.FILES.get('app:index');
    if (!app) return html(SETUP_HTML);
    return html(app.replace(/<head([^>]*)>/i, m => m + '\n<script src="/shim.js"></script>'));
  }

  if (P.startsWith('/dl/')) {
    let name = ''; try { name = decodeURIComponent(P.slice(4)); } catch (e) {}
    if (!PUB_RE.test(name)) return new Response('Nicht gefunden', { status: 404 });
    const r = await env.FILES.getWithMetadata('pub:' + name, { type: 'arrayBuffer' });
    if (!r || !r.value) return new Response('Nicht gefunden', { status: 404 });
    const md = r.metadata || {};
    return new Response(r.value, { headers: { 'Content-Type': md.type || 'application/octet-stream', 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`, 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' } });
  }
  if (P === '/flyer') return Response.redirect(url.origin + '/dl/Flyer_Verkaeuferinnen-Incentive_A4.pdf', 302);

  if (P.startsWith('/_blob/')) {
    const id = P.slice(7).replace(/[^A-Za-z0-9_-]/g, '');
    if (!u) { const cfg = await env.DB.prepare("SELECT data FROM docs WHERE path = 'config/main'").first(); if (!cfg || !cfg.data.includes(id)) return new Response('Bitte anmelden', { status: 401 }); }
    const r = await env.FILES.getWithMetadata('b:' + id, { type: 'arrayBuffer' });
    if (!r || !r.value) return new Response('Nicht gefunden', { status: 404 });
    const md = r.metadata || {};
    return new Response(r.value, { headers: { 'Content-Type': md.type || 'application/octet-stream', 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(md.name || id)}`, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
  }

  if (P === '/api/me') return json({ user: u ? { id: u.id, email: u.email, admin: u.admin } : null, ai: !!env.ANTHROPIC_API_KEY });

  if (P === '/api/register' && M === 'POST') {
    if (!env.SESSION_SECRET) return json({ error: 'SESSION_SECRET ist in Cloudflare noch nicht gesetzt.' }, 500);
    const b = await req.json().catch(() => ({})); const email = String(b.email || '').trim().toLowerCase(), pw = String(b.pw || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Bitte eine gültige E-Mail-Adresse eingeben.' }, 400);
    if (pw.length < 8) return json({ error: 'Das Passwort braucht mindestens 8 Zeichen.' }, 400);
    if (await env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first()) return json({ error: 'Für diese E-Mail-Adresse gibt es schon ein Konto – bitte anmelden.' }, 409);
    const id = 'u_' + rnd(12).replace(/[^A-Za-z0-9]/g, ''), salt = rnd(16);
    await env.DB.prepare('INSERT INTO users (id, email, pw, salt, created, last) VALUES (?, ?, ?, ?, ?, ?)').bind(id, email, await pwHash(pw, salt), salt, now(), now()).run();
    return json({ ok: true }, 200, { 'Set-Cookie': await cookieFor(env, id) });
  }
  if (P === '/api/login' && M === 'POST') {
    if (!env.SESSION_SECRET) return json({ error: 'SESSION_SECRET ist in Cloudflare noch nicht gesetzt.' }, 500);
    const b = await req.json().catch(() => ({})); const email = String(b.email || '').trim().toLowerCase();
    const row = await env.DB.prepare('SELECT id, pw, salt FROM users WHERE email = ?').bind(email).first();
    if (!row || !safeEq(row.pw, await pwHash(String(b.pw || ''), row.salt))) { await new Promise(r => setTimeout(r, 600)); return json({ error: 'E-Mail oder Passwort stimmt nicht.' }, 401); }
    await env.DB.prepare('UPDATE users SET last = ? WHERE id = ?').bind(now(), row.id).run();
    return json({ ok: true }, 200, { 'Set-Cookie': await cookieFor(env, row.id) });
  }
  if (P === '/api/logout' && M === 'POST') return json({ ok: true }, 200, { 'Set-Cookie': clearCookie });

  if (P === '/api/doc') {
    const p = url.searchParams.get('p') || ''; if (!PATH_RE.test(p)) return json({ error: 'Ungültiger Pfad' }, 400);
    const [c, id] = p.split('/');
    if (M === 'GET') { if (!canRead(u, p)) return json({ error: u ? 'Keine Berechtigung' : 'Bitte anmelden' }, u ? 403 : 401); return json({ data: await getDoc(env, p) }); }
    if (!u) return json({ error: 'Bitte anmelden' }, 401);
    if (M === 'PUT') {
      let d = await req.json(); if (!d || typeof d !== 'object' || Array.isArray(d)) return json({ error: 'Ungültige Daten' }, 400);
      if (!u.admin) {
        if (c === 'sellers' && id === u.id) { try { d = guardSeller(await getDoc(env, p), d, await getDoc(env, 'config/main')); } catch (e) { return json({ error: e.message }, e.status || 400); } }
        else if (c === 'serials') { const ex = await getDoc(env, p); if (ex && ex.sid !== u.id) return json({ error: 'Gerät bereits abgerechnet' }, 409); d.sid = u.id; d.st = 'offen'; }
        else return json({ error: 'Keine Berechtigung' }, 403);
      }
      const s = JSON.stringify(d); if (s.length > 1900000) return json({ error: 'Datensatz zu groß' }, 413);
      await putDoc(env, p, d); return json({ ok: true });
    }
    if (M === 'DELETE') {
      if (!u.admin) { const ex = c === 'serials' ? await getDoc(env, p) : null; if (!(ex && ex.sid === u.id)) return json({ error: 'Keine Berechtigung' }, 403); }
      await delDoc(env, p); return json({ ok: true });
    }
  }

  if (P === '/api/col' && M === 'GET') {
    const c = url.searchParams.get('c') || ''; if (!COLL_RE.test(c)) return json({ error: 'Ungültig' }, 400);
    if (!canReadCol(u, c)) return json({ error: 'Keine Berechtigung' }, u ? 403 : 401);
    const v = await env.DB.prepare('SELECT v FROM colv WHERE coll = ?').bind(c).first();
    const etag = `"${c}-${v ? v.v : 0}"`;
    if (req.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
    const rs = await env.DB.prepare('SELECT id, data FROM docs WHERE coll = ?').bind(c).all();
    return json({ docs: (rs.results || []).map(r => ({ id: r.id, data: JSON.parse(r.data) })) }, 200, { ETag: etag });
  }

  if (P === '/api/blob' && M === 'POST') {
    if (!u) return json({ error: 'Bitte anmelden' }, 401);
    const buf = await req.arrayBuffer(); if (!buf.byteLength) return json({ error: 'Leere Datei' }, 400);
    if (buf.byteLength > 20 * 1024 * 1024) return json({ error: 'Datei zu groß (max. 20 MB)' }, 413);
    const type = (req.headers.get('Content-Type') || 'application/octet-stream').split(';')[0];
    if (!/^(image\/(png|jpeg|gif|webp|heic|heif)|application\/pdf|video\/(mp4|webm|quicktime))$/.test(type)) return json({ error: 'Dateityp nicht erlaubt' }, 415);
    const id = [...crypto.getRandomValues(new Uint8Array(16))].map(x => x.toString(16).padStart(2, '0')).join('');
    let name = 'Datei'; try { name = decodeURIComponent(req.headers.get('X-Name') || 'Datei').slice(0, 160); } catch (e) {}
    await env.FILES.put('b:' + id, buf, { metadata: { type, name, owner: u.id, size: buf.byteLength, ts: now() } });
    return json({ id, url: '/_blob/' + id, contentType: type });
  }

  if (P === '/api/ai' && M === 'POST') {
    if (!u) return json({ error: 'Bitte anmelden' }, 401);
    if (!env.ANTHROPIC_API_KEY) return json({ error: 'KI ist nicht eingerichtet' }, 501);
    const b = await req.json().catch(() => ({}));
    const content = [...(Array.isArray(b.images) ? b.images : []).slice(0, 4).map(i => ({ type: 'image', source: { type: 'base64', media_type: /^image\/(jpeg|png|gif|webp)$/.test(i.type) ? i.type : 'image/jpeg', data: String(i.data || '') } })),
      { type: 'text', text: String(b.prompt || '').slice(0, 30000) + '\n\nAntworte ausschließlich mit gültigem JSON, ohne Erklärung und ohne Markdown.' }];
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: env.MODEL || 'claude-sonnet-5-5', max_tokens: 4000, messages: [{ role: 'user', content }] }) });
    const j = await r.json().catch(() => ({})); if (!r.ok) return json({ error: (j.error && j.error.message) || 'KI-Fehler' }, 502);
    const t = (j.content || []).filter(x => x.type === 'text').map(x => x.text).join('').replace(/```json|```/g, '').trim();
    const a = t.indexOf('{'), z = t.lastIndexOf('}'); try { return json(JSON.parse(t.slice(a, z + 1))); } catch (e) { return json({ error: 'KI-Antwort nicht lesbar' }, 502); }
  }

  /* ---------- Verwaltung ---------- */
  if (P.startsWith('/api/admin/')) {
    if (!u) return json({ error: 'Bitte anmelden' }, 401);
    if (!u.admin) return json({ error: 'Keine Berechtigung' }, 403);
    const a = P.slice(11);
    if (a === 'status') { const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM docs').first(); const app = await env.FILES.getWithMetadata('app:index'); return json({ app: !!app.value, appUpd: app.metadata && app.metadata.ts, docs: n ? n.n : 0, secret: !!env.SESSION_SECRET, ai: !!env.ANTHROPIC_API_KEY }); }
    if (a === 'app' && M === 'POST') { const t = await req.text(); if (!/<html/i.test(t) || !t.includes('claude.use')) return json({ error: 'Das ist nicht die App-Datei (index.html).' }, 400); await env.FILES.put('app:index', t, { metadata: { ts: now(), by: u.email } }); return json({ ok: true }); }
    if (a === 'import' && M === 'POST') {
      const b = await req.json(); let nd = 0, nb = 0; const st = [];
      for (const d of (b.docs || [])) { if (!PATH_RE.test(d.path || '') || !d.data) continue; const [c, id] = d.path.split('/'); st.push(env.DB.prepare('INSERT INTO docs (path, coll, id, data, upd) VALUES (?, ?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET data = excluded.data, upd = excluded.upd').bind(d.path, c, id, JSON.stringify(d.data), now())); nd++; }
      const colls = [...new Set((b.docs || []).map(d => String(d.path || '').split('/')[0]).filter(c => COLL_RE.test(c)))];
      for (let i = 0; i < st.length; i += 40) await env.DB.batch(st.slice(i, i + 40));
      if (colls.length) await env.DB.batch(colls.map(c => bump(env, c)));
      for (const f of (b.blobs || [])) { if (!/^[A-Za-z0-9_-]{8,64}$/.test(f.id || '')) continue; const bin = Uint8Array.from(atob(f.data || ''), ch => ch.charCodeAt(0)); await env.FILES.put('b:' + f.id, bin, { metadata: { type: f.type || 'application/octet-stream', name: f.name || f.id, owner: 'import', size: bin.length, ts: now() } }); nb++; }
      let np = 0; for (const f of (b.pub || [])) { const nm = pubName(f.name); if (!PUB_RE.test(nm)) continue; const bin = Uint8Array.from(atob(f.data || ''), ch => ch.charCodeAt(0)); await env.FILES.put('pub:' + nm, bin, { metadata: { type: f.type || 'application/pdf', size: bin.length, ts: now(), by: u.email } }); np++; }
      return json({ ok: true, docs: nd, blobs: nb + np });
    }
    if (a === 'pub' && M === 'POST') { let nm = ''; try { nm = pubName(decodeURIComponent(req.headers.get('X-Name') || '')); } catch (e) {} if (!PUB_RE.test(nm)) return json({ error: 'Ungültiger Dateiname' }, 400); const type = (req.headers.get('Content-Type') || '').split(';')[0]; if (!/^(application\/pdf|image\/(png|jpeg|webp))$/.test(type)) return json({ error: 'Nur PDF oder Bild' }, 415); const buf = await req.arrayBuffer(); if (!buf.byteLength || buf.byteLength > 24 * 1024 * 1024) return json({ error: 'Datei leer oder zu groß' }, 413); await env.FILES.put('pub:' + nm, buf, { metadata: { type, size: buf.byteLength, ts: now(), by: u.email } }); return json({ ok: true, name: nm, url: '/dl/' + nm }); }
    if (a === 'pubs') { const l = await env.FILES.list({ prefix: 'pub:' }); return json({ files: l.keys.map(k => ({ name: k.name.slice(4), ...(k.metadata || {}) })) }); }
    if (a === 'pubdel' && M === 'POST') { const b = await req.json(); const nm = String(b.name || ''); if (!PUB_RE.test(nm)) return json({ error: 'Ungültig' }, 400); await env.FILES.delete('pub:' + nm); return json({ ok: true }); }
    if (a === 'export') { const rs = await env.DB.prepare('SELECT path, data FROM docs ORDER BY path').all(); return json({ exported: new Date().toISOString(), docs: (rs.results || []).map(r => ({ path: r.path, data: JSON.parse(r.data) })) }, 200, { 'Content-Disposition': 'attachment; filename="incentive-sicherung.json"' }); }
    if (a === 'users') { const rs = await env.DB.prepare('SELECT id, email, created, last FROM users ORDER BY created DESC').all(); return json({ users: (rs.results || []).map(x => ({ ...x, admin: isAdminEmail(env, x.email) })) }); }
    if (a === 'reset' && M === 'POST') { const b = await req.json(); const row = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(String(b.id || '')).first(); if (!row) return json({ error: 'Konto nicht gefunden' }, 404); const pw = rnd(9).replace(/[^A-Za-z0-9]/g, 'x'), salt = rnd(16); await env.DB.prepare('UPDATE users SET pw = ?, salt = ? WHERE id = ?').bind(await pwHash(pw, salt), salt, String(b.id)).run(); return json({ ok: true, email: row.email, pw }); }
    if (a === 'deluser' && M === 'POST') { const b = await req.json(); const row = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(String(b.id || '')).first(); if (!row) return json({ error: 'Konto nicht gefunden' }, 404); if (isAdminEmail(env, row.email)) return json({ error: 'Verwaltungs-Konten bitte über ADMINS entfernen' }, 400); await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(String(b.id)).run(); return json({ ok: true }); }
  }
  return json({ error: 'Nicht gefunden' }, 404);
}

const SETUP_HTML = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Verkäufer:innen Incentive – Einrichtung</title><style>body{margin:0;font-family:system-ui,sans-serif;background:#f3f5f8;color:#13213a}main{max-width:620px;margin:60px auto;background:#fff;border:1px solid #dfe3ea;border-radius:16px;padding:28px}h1{color:#001C86;font-size:24px;margin:0 0 10px}li{margin:8px 0;line-height:1.5}a{color:#001C86;font-weight:700}</style></head><body><main><h1>Verkäufer:innen Incentive wird eingerichtet</h1><p>Die Plattform läuft, die App ist aber noch nicht installiert.</p><ol><li>Unter <a href="/konten">/konten</a> mit einer Verwaltungs-E-Mail (Liste „ADMINS“) ein Konto erstellen.</li><li>Dort die Datei <b>index.html</b> hochladen.</li><li>Danach <b>incentive-daten.json</b> importieren.</li></ol></main></body></html>`;

const SHIM_JS = "/* Verkäufer:innen Incentive – Laufzeit-Adapter für Cloudflare (ersetzt window.claude) */\n(function(){\n  'use strict';\n  var H={'X-VI':'1'}, ME=null, AI=false;\n  var meP=fetch('/api/me',{credentials:'same-origin'}).then(function(r){return r.json();}).then(function(j){ME=j.user||null;AI=!!j.ai;return j;}).catch(function(){return {};});\n  function snap(id,d){ return {id:id,exists:d!=null,data:function(){ return d==null?undefined:JSON.parse(JSON.stringify(d)); }}; }\n  async function api(m,url,body,raw,extra){\n    var o={method:m,headers:Object.assign({},H,extra||{}),credentials:'same-origin'};\n    if(body!==undefined){ if(raw){ o.body=body; } else { o.headers['Content-Type']='application/json'; o.body=JSON.stringify(body); } }\n    var r=await fetch(url,o);\n    if(r.status===401){ showLogin('Bitte melde dich an, um fortzufahren.'); var e1=new Error('Bitte anmelden'); e1.code='unauthenticated'; throw e1; }\n    if(!r.ok){ var t=''; try{ t=(await r.json()).error||''; }catch(_){} var e2=new Error(t||('Fehler '+r.status)); e2.code='http_'+r.status; throw e2; }\n    return r;\n  }\n  var docW=new Map(), colW=new Map();\n  async function pollDoc(p){ var w=docW.get(p); if(!w) return; try{ var r=await fetch('/api/doc?p='+encodeURIComponent(p),{credentials:'same-origin'}); if(!r.ok) return; var t=await r.text(); if(t!==w.last){ w.last=t; var j=JSON.parse(t); w.cbs.forEach(function(cb){ try{ cb(snap(p.split('/')[1],j.data)); }catch(e){ console.error(e); } }); } }catch(e){} }\n  async function pollCol(c){ var w=colW.get(c); if(!w) return; try{ var h={}; if(w.etag) h['If-None-Match']=w.etag; var r=await fetch('/api/col?c='+encodeURIComponent(c),{credentials:'same-origin',headers:h}); if(r.status===304||!r.ok) return; w.etag=r.headers.get('ETag'); var j=await r.json(); var docs=j.docs.map(function(d){ return snap(d.id,d.data); }); var s={docs:docs,size:docs.length,empty:!docs.length,forEach:function(f){ docs.forEach(f); }}; w.cbs.forEach(function(cb){ try{ cb(s); }catch(e){ console.error(e); } }); }catch(e){} }\n  function pollAll(){ docW.forEach(function(_,p){ pollDoc(p); }); colW.forEach(function(_,c){ pollCol(c); }); }\n  setInterval(function(){ if(!document.hidden) pollAll(); },15000);\n  document.addEventListener('visibilitychange',function(){ if(!document.hidden) pollAll(); });\n  function touched(p){ var c=p.split('/')[0]; if(docW.has(p)) pollDoc(p); var w=colW.get(c); if(w){ w.etag=null; pollCol(c); } }\n  var db={\n    doc:function(p){ return {\n      get:async function(){ var r=await api('GET','/api/doc?p='+encodeURIComponent(p)); var j=await r.json(); return snap(p.split('/')[1],j.data); },\n      set:async function(d){ await api('PUT','/api/doc?p='+encodeURIComponent(p),d); touched(p); },\n      delete:async function(){ await api('DELETE','/api/doc?p='+encodeURIComponent(p)); touched(p); },\n      onSnapshot:function(cb){ var w=docW.get(p); if(!w){ w={cbs:new Set(),last:null}; docW.set(p,w); } w.cbs.add(cb); if(w.last!=null){ var j=JSON.parse(w.last); setTimeout(function(){ cb(snap(p.split('/')[1],j.data)); },0); } else pollDoc(p); return function(){ w.cbs.delete(cb); }; }\n    }; },\n    collection:function(c){ return { onSnapshot:function(cb){ var w=colW.get(c); if(!w){ w={cbs:new Set(),etag:null}; colW.set(c,w); } w.cbs.add(cb); w.etag=null; pollCol(c); return function(){ w.cbs.delete(cb); }; } }; }\n  };\n  var user={ id:async function(){ return ME?ME.id:null; }, canEdit:function(){ return !!(ME&&ME.admin); }, isOwner:function(){ return !!(ME&&ME.admin); } };\n  var assets={ upload:async function(file){ var r=await api('POST','/api/blob',file,true,{'Content-Type':file.type||'application/octet-stream','X-Name':encodeURIComponent(file.name||'Datei')}); return await r.json(); } };\n  function toB64(blob){ return new Promise(function(res,rej){ var fr=new FileReader(); fr.onload=function(){ res(String(fr.result).split(',')[1]); }; fr.onerror=rej; fr.readAsDataURL(blob); }); }\n  async function shrink(blob){ try{ var bmp=await createImageBitmap(blob); var s=Math.min(1,2000/Math.max(bmp.width,bmp.height)); var c=document.createElement('canvas'); c.width=Math.round(bmp.width*s); c.height=Math.round(bmp.height*s); c.getContext('2d').drawImage(bmp,0,0,c.width,c.height); var b=await new Promise(function(r){ c.toBlob(r,'image/jpeg',0.85); }); return {type:'image/jpeg',data:await toB64(b)}; }catch(e){ return {type:blob.type||'image/jpeg',data:await toB64(blob)}; } }\n  var sample={ limits:async function(){ return {images:true}; }, json:async function(prompt,opts){ var imgs=[]; var L=(opts&&opts.images)||[]; for(var i=0;i<L.length;i++) imgs.push(await shrink(L[i])); var r=await api('POST','/api/ai',{prompt:String(prompt),images:imgs}); return await r.json(); } };\n  var downloads={ save:async function(o){ var b=o.data instanceof Blob?o.data:new Blob([o.data]); var u=URL.createObjectURL(b); var a=document.createElement('a'); a.href=u; a.download=o.filename||'Datei'; document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(u); a.remove(); },1500); } };\n  window.claude={ use:async function(n){ await meP; if(n==='user') return user; if(n==='db') return db; if(n==='assets'){ if(!ME) throw new Error('nicht angemeldet'); return assets; } if(n==='sample'){ if(!ME||!AI) throw new Error('KI nicht eingerichtet'); return sample; } if(n==='downloads') return downloads; throw new Error('nicht verfügbar: '+n); } };\n\n  /* ---------- Anmeldung ---------- */\n  var CSS='#vi-ov{position:fixed;inset:0;z-index:99999;background:rgba(10,20,50,.55);display:flex;align-items:center;justify-content:center;padding:16px;font-family:\"Public Sans\",system-ui,sans-serif}#vi-ov .bx{background:#fff;color:#13213a;border-radius:16px;max-width:420px;width:100%;padding:26px 24px;box-shadow:0 20px 60px rgba(0,0,0,.3)}#vi-ov h2{margin:0 0 6px;font-size:22px;color:#001C86}#vi-ov p{margin:0 0 14px;font-size:14px;line-height:1.5;color:#3b4863}#vi-ov label{display:block;font-size:13px;font-weight:700;margin:10px 0 4px}#vi-ov input{width:100%;box-sizing:border-box;font:inherit;font-size:16px;padding:11px 12px;border:1px solid #c9d3ea;border-radius:10px}#vi-ov .row{display:flex;gap:8px;margin-top:16px;flex-wrap:wrap}#vi-ov button{font:inherit;font-weight:700;font-size:15px;border-radius:10px;padding:11px 16px;cursor:pointer;border:1px solid #001C86;background:#001C86;color:#fff;min-height:44px}#vi-ov button.g{background:#fff;color:#001C86}#vi-ov .err{color:#b3261e;font-size:14px;min-height:18px;margin-top:10px}#vi-ov .lnk{background:none;border:0;color:#001C86;text-decoration:underline;padding:0;min-height:auto;font-weight:600;font-size:14px}#vi-acc{position:fixed;left:10px;bottom:10px;z-index:9999;background:rgba(255,255,255,.95);border:1px solid #dfe3ea;border-radius:999px;padding:6px 12px;font:600 12px \"Public Sans\",system-ui,sans-serif;color:#3b4863;box-shadow:0 4px 14px rgba(0,0,0,.08)}#vi-acc a,#vi-acc button{color:#001C86;background:none;border:0;font:inherit;cursor:pointer;padding:0;text-decoration:underline}';\n  function showLogin(msg,mode){\n    if(document.getElementById('vi-ov')) return;\n    mode=mode||'login';\n    var ov=document.createElement('div'); ov.id='vi-ov'; ov.setAttribute('role','dialog'); ov.setAttribute('aria-modal','true');\n    var reg=mode==='reg';\n    ov.innerHTML='<div class=\"bx\"><h2>'+(reg?'Konto erstellen':'Anmelden')+'</h2><p>'+(msg||(reg?'Mit deinem Konto kannst du dich für das Verkäufer:innen Incentive registrieren und Rechnungen hochladen.':'Melde dich mit deiner E-Mail-Adresse und deinem Passwort an.'))+'</p>'\n      +'<label for=\"vi-e\">E-Mail</label><input id=\"vi-e\" type=\"email\" autocomplete=\"email\">'\n      +'<label for=\"vi-p\">Passwort'+(reg?' (mindestens 8 Zeichen)':'')+'</label><input id=\"vi-p\" type=\"password\" autocomplete=\"'+(reg?'new-password':'current-password')+'\">'\n      +(reg?'<label for=\"vi-p2\">Passwort wiederholen</label><input id=\"vi-p2\" type=\"password\" autocomplete=\"new-password\">':'')\n      +'<div class=\"err\" id=\"vi-err\" aria-live=\"polite\"></div>'\n      +'<div class=\"row\"><button type=\"button\" id=\"vi-go\">'+(reg?'Konto erstellen':'Anmelden')+'</button><button type=\"button\" class=\"g\" id=\"vi-x\">Abbrechen</button></div>'\n      +'<p style=\"margin:14px 0 0\">'+(reg?'Schon ein Konto? <button type=\"button\" class=\"lnk\" id=\"vi-sw\">Anmelden</button>':'Noch kein Konto? <button type=\"button\" class=\"lnk\" id=\"vi-sw\">Konto erstellen</button><br>Passwort vergessen? Bitte wende dich an deinen Außendienst.')+'</p></div>';\n    document.body.appendChild(ov);\n    var q=function(s){ return ov.querySelector(s); };\n    q('#vi-e').focus();\n    q('#vi-x').onclick=function(){ ov.remove(); };\n    q('#vi-sw').onclick=function(){ ov.remove(); showLogin('',reg?'login':'reg'); };\n    var go=async function(){ var e=q('#vi-e').value.trim(), p=q('#vi-p').value, err=q('#vi-err');\n      if(reg&&p!==q('#vi-p2').value){ err.textContent='Die Passwörter stimmen nicht überein.'; return; }\n      q('#vi-go').disabled=true; err.textContent='';\n      try{ var r=await fetch(reg?'/api/register':'/api/login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-VI':'1'},body:JSON.stringify({email:e,pw:p})}); var j=await r.json().catch(function(){return {};}); if(!r.ok) throw new Error(j.error||'Anmeldung nicht möglich'); location.reload(); }\n      catch(x){ err.textContent=x.message; q('#vi-go').disabled=false; } };\n    q('#vi-go').onclick=go; ov.addEventListener('keydown',function(ev){ if(ev.key==='Enter') go(); if(ev.key==='Escape') ov.remove(); });\n  }\n  window.viLogin=showLogin;\n  function bar(){\n    var st=document.createElement('style'); st.textContent=CSS; document.head.appendChild(st);\n    var b=document.createElement('div'); b.id='vi-acc';\n    if(ME){ b.innerHTML='Angemeldet als '+ME.email.replace(/[<>&\"]/g,'')+' · '+(ME.admin?'<a href=\"/konten\">Konten</a> · ':'')+'<button type=\"button\" id=\"vi-out\">Abmelden</button>'; }\n    else { b.innerHTML='<button type=\"button\" id=\"vi-in\">Anmelden</button>'; }\n    document.body.appendChild(b);\n    var o=document.getElementById('vi-out'); if(o) o.onclick=async function(){ await fetch('/api/logout',{method:'POST',credentials:'same-origin',headers:{'X-VI':'1'}}); location.reload(); };\n    var i=document.getElementById('vi-in'); if(i) i.onclick=function(){ showLogin(); };\n  }\n  document.addEventListener('click',function(ev){ if(ME) return; var t=ev.target.closest&&ev.target.closest('#meBtn,#ctaReg,#ctaUp'); if(t){ ev.preventDefault(); ev.stopImmediatePropagation(); showLogin(t.id==='ctaReg'?'':'',t.id==='ctaReg'?'reg':'login'); } },true);\n  meP.then(function(){ if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bar); else bar(); });\n})();\n";
const KONTEN_HTML = "<!doctype html>\n<html lang=\"de\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>Verwaltung Konten – Verkäufer:innen Incentive</title>\n<style>\n:root{--n:#001C86;--i:#13213a;--m:#5b6787;--l:#dfe3ea;--bg:#f3f5f8}\nbody{margin:0;font-family:system-ui,-apple-system,\"Segoe UI\",sans-serif;background:var(--bg);color:var(--i)}\nheader{background:var(--n);color:#fff;padding:16px 20px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}\nheader a{color:#fff}\nmain{max-width:980px;margin:0 auto;padding:20px}\n.box{background:#fff;border:1px solid var(--l);border-radius:14px;padding:18px 20px;margin-bottom:16px}\nh1{font-size:20px;margin:0}h2{font-size:18px;margin:0 0 8px;color:var(--n)}\np{line-height:1.5;margin:6px 0}.m{color:var(--m);font-size:14px}\nbutton,input[type=file]::file-selector-button{font:inherit;font-weight:700;border-radius:10px;padding:9px 14px;border:1px solid var(--n);background:var(--n);color:#fff;cursor:pointer;min-height:40px}\nbutton.g{background:#fff;color:var(--n)}button.r{background:#fff;color:#b3261e;border-color:#b3261e}\ninput[type=email],input[type=password]{font:inherit;font-size:16px;padding:10px;border:1px solid #c9d3ea;border-radius:10px;width:100%;box-sizing:border-box;margin:4px 0 10px}\ntable{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--l);vertical-align:top}\n.ok{color:#167a3e;font-weight:700}.no{color:#b3261e;font-weight:700}.st{min-height:20px;margin-top:8px}\n.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}\n</style></head><body>\n<header><h1>Verkäufer:innen Incentive · Verwaltung</h1><div class=\"row\" id=\"hd\"></div></header>\n<main id=\"app\"><div class=\"box\">Wird geladen …</div></main>\n<script>\nconst H={'X-VI':'1'};const $=s=>document.querySelector(s);\nconst esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));\nconst dt=t=>t?new Date(t).toLocaleString('de-AT'):'–';\nasync function post(u,b,raw,ct){ const r=await fetch(u,{method:'POST',credentials:'same-origin',headers:Object.assign({},H,raw?{'Content-Type':ct||'application/octet-stream'}:{'Content-Type':'application/json'}),body:raw?b:JSON.stringify(b)}); const j=await r.json().catch(()=>({})); if(!r.ok) throw new Error(j.error||('Fehler '+r.status)); return j; }\nasync function boot(){\n  const me=await (await fetch('/api/me',{credentials:'same-origin'})).json();\n  const A=$('#app');\n  if(!me.user){ A.innerHTML=`<div class=\"box\" style=\"max-width:420px\"><h2>Anmelden</h2><p class=\"m\">Als Verwaltung mit einer E-Mail-Adresse aus der Liste ADMINS anmelden. Noch kein Konto? Einfach ein Passwort festlegen und „Konto erstellen“ wählen.</p><label>E-Mail<input type=\"email\" id=\"e\" autocomplete=\"email\"></label><label>Passwort (mindestens 8 Zeichen)<input type=\"password\" id=\"p\" autocomplete=\"current-password\"></label><div class=\"row\"><button id=\"li\">Anmelden</button><button class=\"g\" id=\"rg\">Konto erstellen</button></div><div class=\"st no\" id=\"er\"></div></div>`;\n    const go=async u=>{ try{ await post(u,{email:$('#e').value.trim(),pw:$('#p').value}); location.reload(); }catch(x){ $('#er').textContent=x.message; } };\n    $('#li').onclick=()=>go('/api/login'); $('#rg').onclick=()=>go('/api/register'); return; }\n  $('#hd').innerHTML=`<span>${esc(me.user.email)}</span><a href=\"/\">Zur App</a><button class=\"g\" id=\"lo\">Abmelden</button>`;\n  $('#lo').onclick=async()=>{ await post('/api/logout',{}); location.reload(); };\n  if(!me.user.admin){ A.innerHTML=`<div class=\"box\"><h2>Keine Berechtigung</h2><p>Dieses Konto gehört nicht zur Verwaltung. Die Verwaltungs-Adressen werden in Cloudflare unter „ADMINS“ festgelegt.</p></div>`; return; }\n  const s=await (await fetch('/api/admin/status',{credentials:'same-origin'})).json();\n  const flag=(b,t,f)=>`<span class=\"${b?'ok':'no'}\">${b?'✓ '+t:'✗ '+f}</span>`;\n  A.innerHTML=`<div class=\"box\"><h2>Status</h2><p>${flag(s.app,'App installiert ('+esc(s.appUpd?dt(s.appUpd):'')+')','App noch nicht hochgeladen')}<br>${flag(s.docs>0,s.docs+' Datensätze in der Datenbank','Noch keine Daten – bitte importieren')}<br>${flag(s.secret,'Sitzungsschlüssel gesetzt','SESSION_SECRET fehlt – bitte in Cloudflare als Secret anlegen')}<br>${flag(s.ai,'KI-Rechnungsauslesung aktiv','KI aus – ANTHROPIC_API_KEY nicht gesetzt (Rechnungen werden dann manuell erfasst)')}</p></div>\n  <div class=\"box\"><h2>1 · App-Datei hochladen</h2><p class=\"m\">Die Datei <b>index.html</b> der App. Bei jeder neuen Version einfach erneut hochladen – Daten bleiben erhalten.</p><input type=\"file\" id=\"fa\" accept=\".html,text/html\"><div class=\"st\" id=\"sa\"></div></div>\n  <div class=\"box\"><h2>2 · Daten importieren</h2><p class=\"m\">Die Datei <b>incentive-daten.json</b> (Einstellungen, Kampagnen, Mailingliste, Vertrag, Testdaten). Vorhandene Datensätze mit gleichem Namen werden überschrieben.</p><input type=\"file\" id=\"fi\" accept=\".json,application/json\"><div class=\"st\" id=\"si\"></div></div>\n  <div class=\"box\"><h2>3 · Öffentliche Downloads (z. B. Flyer)</h2><p class=\"m\">PDF oder Bild hochladen – ohne Anmeldung abrufbar unter <b>/dl/Dateiname</b>. Der Flyer ist zusätzlich unter <b>/flyer</b> erreichbar, wenn er „Flyer_Verkaeuferinnen-Incentive_A4.pdf“ heißt.</p><input type=\"file\" id=\"fp\" accept=\".pdf,application/pdf,image/png,image/jpeg,image/webp\"><div class=\"st\" id=\"sp\"></div><div id=\"pl\"></div></div>\n  <div class=\"box\"><h2>Datensicherung</h2><p class=\"m\">Alle Datensätze als JSON herunterladen (ohne hochgeladene Dateien). Diese Datei lässt sich oben wieder importieren.</p><button id=\"ex\">Sicherung herunterladen</button></div>\n  <div class=\"box\"><h2>Konten</h2><p class=\"m\">Verkäufer:innen erstellen ihr Konto selbst. Die Teilnahme selbst wird wie gewohnt in der App unter „Verwaltung → Freigaben“ freigegeben.</p><div id=\"us\">Wird geladen …</div></div>`;\n  $('#fa').onchange=async e=>{ const f=e.target.files[0]; if(!f) return; $('#sa').textContent='Wird hochgeladen …'; try{ await post('/api/admin/app',await f.text(),true,'text/html; charset=utf-8'); $('#sa').innerHTML='<span class=\"ok\">✓ App installiert.</span> <a href=\"/\">Jetzt öffnen</a>'; }catch(x){ $('#sa').innerHTML='<span class=\"no\">'+esc(x.message)+'</span>'; } };\n  $('#fi').onchange=async e=>{ const f=e.target.files[0]; if(!f) return; $('#si').textContent='Wird importiert …'; try{ const j=await post('/api/admin/import',await f.text(),true,'application/json'); $('#si').innerHTML=`<span class=\"ok\">✓ ${j.docs} Datensätze und ${j.blobs} Dateien importiert.</span>`; }catch(x){ $('#si').innerHTML='<span class=\"no\">'+esc(x.message)+'</span>'; } };\n  $('#ex').onclick=async()=>{ const r=await fetch('/api/admin/export',{credentials:'same-origin'}); const b=await r.blob(); const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download='incentive-sicherung-'+new Date().toISOString().slice(0,10)+'.json'; a.click(); };\n  $('#fp').onchange=async e=>{ const f=e.target.files[0]; if(!f) return; $('#sp').textContent='Wird hochgeladen …'; try{ const r=await fetch('/api/admin/pub',{method:'POST',credentials:'same-origin',headers:{'X-VI':'1','Content-Type':f.type||'application/pdf','X-Name':encodeURIComponent(f.name)},body:f}); const j=await r.json(); if(!r.ok) throw new Error(j.error||'Fehler'); $('#sp').innerHTML='<span class=\"ok\">✓ Online:</span> <a href=\"'+j.url+'\" target=\"_blank\">'+esc(location.origin+j.url)+'</a>'; pubs(); }catch(x){ $('#sp').innerHTML='<span class=\"no\">'+esc(x.message)+'</span>'; } };\n  users(); pubs();\n}\nasync function pubs(){ const j=await (await fetch('/api/admin/pubs',{credentials:'same-origin'})).json(); $('#pl').innerHTML=j.files.length?`<table style=\"margin-top:10px\"><thead><tr><th>Datei</th><th>Link</th><th>Hochgeladen</th><th></th></tr></thead><tbody>${j.files.map(f=>`<tr><td>${esc(f.name)}</td><td><a href=\"/dl/${encodeURIComponent(f.name)}\" target=\"_blank\">/dl/${esc(f.name)}</a></td><td>${dt(f.ts)}</td><td><button class=\"r\" data-pd=\"${esc(f.name)}\">Entfernen</button></td></tr>`).join('')}</tbody></table>`:'<p class=\"m\">Noch keine öffentlichen Dateien.</p>'; document.querySelectorAll('[data-pd]').forEach(b=>b.onclick=async()=>{ if(!confirm('Datei offline nehmen?')) return; await post('/api/admin/pubdel',{name:b.dataset.pd}); pubs(); }); }\nasync function users(){\n  const j=await (await fetch('/api/admin/users',{credentials:'same-origin'})).json();\n  $('#us').innerHTML=`<table><thead><tr><th>E-Mail</th><th>Angelegt</th><th>Letzte Anmeldung</th><th>Rolle</th><th></th></tr></thead><tbody>${j.users.map(u=>`<tr><td>${esc(u.email)}</td><td>${dt(u.created)}</td><td>${dt(u.last)}</td><td>${u.admin?'Verwaltung':'Verkäufer:in'}</td><td class=\"row\"><button class=\"g\" data-r=\"${esc(u.id)}\">Passwort zurücksetzen</button>${u.admin?'':`<button class=\"r\" data-d=\"${esc(u.id)}\">Löschen</button>`}</td></tr>`).join('')||'<tr><td colspan=\"5\">Noch keine Konten.</td></tr>'}</tbody></table><div class=\"st\" id=\"su\"></div>`;\n  document.querySelectorAll('[data-r]').forEach(b=>b.onclick=async()=>{ try{ const r=await post('/api/admin/reset',{id:b.dataset.r}); $('#su').innerHTML=`Neues vorläufiges Passwort für <b>${esc(r.email)}</b>: <code style=\"font-size:16px\">${esc(r.pw)}</code> – bitte persönlich weitergeben.`; }catch(x){ $('#su').textContent=x.message; } });\n  document.querySelectorAll('[data-d]').forEach(b=>b.onclick=async()=>{ if(!confirm('Konto wirklich löschen? Die Teilnahmedaten in der App bleiben erhalten.')) return; try{ await post('/api/admin/deluser',{id:b.dataset.d}); users(); }catch(x){ $('#su').textContent=x.message; } });\n}\nboot();\n</script></body></html>\n";
