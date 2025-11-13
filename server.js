// CommonJS, без dotenv
const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const cookie = require('cookie');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

// --- util json ---
async function readJSON(fp, fallback) {
  try { return JSON.parse(await fs.readFile(fp, 'utf8')); }
  catch { return fallback; }
}
async function writeJSON(fp, data) {
  await fs.writeFile(fp, JSON.stringify(data, null, 2));
}

// --- config & files ---
const FP_CONFIG   = path.join(ROOT, 'config.json');
const FP_USERS    = path.join(ROOT, 'users.json');
const FP_ARTICLES = path.join(ROOT, 'articles.json');

let CONFIG = {
  siteName: "VC Metrics",
  sessionSecret: "CHANGE_ME_SECRET_32+_CHARS",
  placementPrice: 0
};
let USERS = [];
let ARTICLES = [];

async function boot() {
  CONFIG = await readJSON(FP_CONFIG, CONFIG);
  USERS = await readJSON(FP_USERS, []);
  ARTICLES = await readJSON(FP_ARTICLES, []);
}
function saveUsers()   { return writeJSON(FP_USERS, USERS); }
function saveConfig()  { return writeJSON(FP_CONFIG, CONFIG); }
function saveArticles(){ return writeJSON(FP_ARTICLES, ARTICLES); }

// --- tiny signed cookie token (HMAC) ---
function b64url(buf){ return Buffer.from(buf).toString('base64url'); }
function fromB64(s){ return Buffer.from(s, 'base64url').toString('utf8'); }

function signToken(payload){
  const body = b64url(JSON.stringify(payload));
  const sig  = b64url(crypto.createHmac('sha256', CONFIG.sessionSecret).update(body).digest());
  return `${body}.${sig}`;
}
function verifyToken(token){
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expSig = b64url(crypto.createHmac('sha256', CONFIG.sessionSecret).update(body).digest());
  if (sig !== expSig) return null;
  const data = JSON.parse(fromB64(body));
  if (data.exp && Date.now() > data.exp) return null;
  return data;
}

function setSessionCookie(res, uid){
  const tok = signToken({ uid, exp: Date.now() + 7*24*3600*1000 }); // 7 дней
  res.setHeader('Set-Cookie', cookie.serialize('sid', tok, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/'
  }));
}
function clearSessionCookie(res){
  res.setHeader('Set-Cookie', cookie.serialize('sid', '', {
    httpOnly:true, sameSite:'lax', secure:process.env.NODE_ENV==='production',
    path:'/', maxAge:0
  }));
}

function getUserFromReq(req){
  const c = cookie.parse(req.headers.cookie || '');
  const data = verifyToken(c.sid);
  if (!data) return null;
  return USERS.find(u => String(u.id) === String(data.uid)) || null;
}
function requireAuth(req, res, next){
  const u = getUserFromReq(req);
  if (!u) return res.status(401).json({ error: 'Не авторизован' });
  req.user = u; next();
}
function requireAdmin(req, res, next){
  requireAuth(req, res, () => {
    if (!req.user.isAdmin) return res.status(403).json({ error:'Только для админа' });
    next();
  });
}

// --- middleware ---
app.use(express.json());
app.use((req, _res, next) => { req.start = Date.now(); next(); });

// static
app.use('/styles.css', express.static(path.join(ROOT, 'public', 'styles.css')));
app.use('/app', requireAuth, express.static(path.join(ROOT, 'public', 'app')));
app.use('/', express.static(path.join(ROOT, 'public')));

// ---- auth API ----
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Введите e-mail и пароль' });

  const u = USERS.find(x => x.email.toLowerCase() === String(email).toLowerCase());
  if (!u) return res.status(401).json({ error: 'Неверные данные' });

  const ok = await bcrypt.compare(password, u.passHash);
  if (!ok) return res.status(401).json({ error: 'Неверные данные' });

  setSessionCookie(res, u.id);
  res.json({ ok: true });
});

app.post('/api/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const u = getUserFromReq(req);
  if (!u) return res.status(401).json({ error: 'Не авторизован' });
  res.json({ user: { id: u.id, email: u.email, isAdmin: !!u.isAdmin } });
});

// ---- admin: invite & reset ----
app.post('/api/admin/invite', requireAdmin, async (req, res) => {
  const { email, isAdmin } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Нужен e-mail' });

  if (USERS.some(u => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(409).json({ error: 'Такой пользователь уже есть' });
  }
  const plain = crypto.randomBytes(6).toString('base64url'); // временный пароль
  const passHash = await bcrypt.hash(plain, 12);
  const u = { id: Date.now(), email, passHash, isAdmin: !!isAdmin, createdAt: Date.now() };
  USERS.push(u); await saveUsers();

  // тут можно интегрировать отправку письма; пока — возвращаем пароль в ответе
  res.json({ ok:true, email, password: plain });
});

app.post('/api/admin/reset', requireAdmin, async (req, res) => {
  const { email } = req.body || {};
  const u = USERS.find(x => x.email.toLowerCase() === String(email).toLowerCase());
  if (!u) return res.status(404).json({ error: 'Нет такого e-mail' });
  const plain = crypto.randomBytes(6).toString('base64url');
  u.passHash = await bcrypt.hash(plain, 12);
  await saveUsers();
  res.json({ ok:true, email, password: plain });
});

// ---- stub API для будущей аналитики (чтобы фронт не падал) ----
app.get('/api/articles', requireAuth, async (_req, res) => {
  res.json({ items: ARTICLES, placementPrice: CONFIG.placementPrice || 0 });
});
app.post('/api/admin/set-price', requireAdmin, async (req, res) => {
  const { price } = req.body || {};
  CONFIG.placementPrice = Number(price || 0);
  await saveConfig();
  res.json({ ok:true, placementPrice: CONFIG.placementPrice });
});

// guard: если не залогинен — редирект на /login.html
app.get('/app*', (req, res, next) => {
  const u = getUserFromReq(req);
  if (!u) return res.redirect(`/login.html?redirect=${encodeURIComponent(req.originalUrl)}`);
  next();
});

// если уже залогинен — уходи сразу в /app
app.get('/login.html', (req, res, next) => {
  const u = getUserFromReq(req);
  if (u) return res.redirect('/app');
  next();
});

// fallback на главную
app.get('*', (req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'index.html'));
});

boot().then(() => {
  app.listen(PORT, () => console.log(`VC Metrics listening on :${PORT}`));
});
