// CJS сервер: авторизация + управление пользователями + метрики VC
const express = require("express");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const cookieSession = require("cookie-session");

const app = express();
const PORT = process.env.PORT || 3000;

const ROOT = __dirname;
const USERS_PATH = path.join(ROOT, "users.json");
const ARTICLES_PATH = path.join(ROOT, "articles.json");
const CONFIG_PATH = path.join(ROOT, "config.json");

// ----------------- utils -----------------
function readJson(fp, def) {
  try { return JSON.parse(fs.readFileSync(fp, "utf8")); } catch { return def; }
}
function writeJson(fp, data) {
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), "utf8");
}
function readUsers() { return readJson(USERS_PATH, []); }
function writeUsers(list) { writeJson(USERS_PATH, list); }

function ensureAdminSeed() {
  const list = readUsers();
  if (!list.some(u => String(u.email).toLowerCase() === "admin@local")) {
    // пароль "admin"
    const hash = "$2b$12$bF9/3pVaCM6L8BGZokmM8ecGfiY/WcKoIa/jv03gRrBTr2VQkVb2C";
    list.push({ id: 1, email: "admin@local", password: hash, isAdmin: true, createdAt: Date.now() });
    writeUsers(list);
  }
}
ensureAdminSeed();

// конфиг/статьи по умолчанию
if (!fs.existsSync(ARTICLES_PATH)) writeJson(ARTICLES_PATH, []);
if (!fs.existsSync(CONFIG_PATH)) writeJson(CONFIG_PATH, { placementPrice: 0, lastAutoRefresh: 0 });

const readArticles = () => readJson(ARTICLES_PATH, []);
const writeArticles = list => writeJson(ARTICLES_PATH, list);
const readConfig = () => readJson(CONFIG_PATH, { placementPrice: 0, lastAutoRefresh: 0 });
const writeConfig = cfg => writeJson(CONFIG_PATH, cfg);

const normEmail = e => String(e || "").trim().toLowerCase();
const genId = list => (list.reduce((m, u) => Math.max(m, Number(u.id) || 0), 0) + 1);
const genPassword = (len = 12) => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  let s = ""; for (let i = 0; i < len; i++) s += chars[(Math.random() * chars.length) | 0]; return s;
};

// ----------------- middleware -----------------
app.use(express.json());
app.use(cookieSession({
  name: "sess",
  secret: process.env.SESSION_SECRET || "vc-metrics-dev",
  maxAge: 1000 * 60 * 60 * 24 * 7,
  sameSite: "lax",
  httpOnly: true
}));

app.use(express.static(path.join(ROOT, "public"), { extensions: ["html"] }));
app.get(["/", "/app", "/login"], (req, res) => res.sendFile(path.join(ROOT, "public", "index.html")));

const requireAuth = (req, res, next) => req.session?.user ? next() : res.status(401).json({ error: "unauth" });
const requireAdmin = (req, res, next) => req.session?.user?.isAdmin ? next() : res.status(403).json({ error: "forbidden" });

// ----------------- auth -----------------
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body || {};
  const u = readUsers().find(x => normEmail(x.email) === normEmail(email));
  if (!u) return res.status(401).json({ error: "Неверные данные" });
  const ok = await bcrypt.compare(password || "", u.password);
  if (!ok) return res.status(401).json({ error: "Неверные данные" });
  req.session.user = { id: u.id, email: u.email, isAdmin: !!u.isAdmin };
  res.json({ ok: true, user: req.session.user });
});
app.post("/api/logout", (req, res) => { req.session = null; res.json({ ok: true }); });
app.get("/api/me", (req, res) => req.session?.user ? res.json({ user: req.session.user }) : res.status(401).json({ error: "unauth" }));

// ----------------- users admin -----------------
app.get("/api/users", requireAuth, requireAdmin, (req, res) => {
  const users = readUsers().map(u => ({ id: u.id, email: u.email, isAdmin: !!u.isAdmin, createdAt: u.createdAt }));
  res.json({ users });
});
app.post("/api/users/invite", requireAuth, requireAdmin, async (req, res) => {
  const { email, isAdmin = false } = req.body || {};
  const e = normEmail(email);
  if (!e) return res.status(400).json({ error: "Укажите e-mail" });
  const list = readUsers();
  if (list.some(u => normEmail(u.email) === e)) return res.status(409).json({ error: "Пользователь уже существует" });
  const pwd = genPassword(12);
  const hash = await bcrypt.hash(pwd, 12);
  const user = { id: genId(list), email: e, password: hash, isAdmin: !!isAdmin, createdAt: Date.now() };
  list.push(user); writeUsers(list);
  res.json({ ok: true, user: { id: user.id, email: user.email, isAdmin: user.isAdmin }, tempPassword: pwd });
});
app.post("/api/users/reset", requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.body || {};
  const list = readUsers();
  const u = list.find(x => String(x.id) === String(id));
  if (!u) return res.status(404).json({ error: "Нет такого пользователя" });
  const pwd = genPassword(12); u.password = await bcrypt.hash(pwd, 12);
  writeUsers(list); res.json({ ok: true, tempPassword: pwd });
});
app.delete("/api/users/:id", requireAuth, requireAdmin, (req, res) => {
  const id = String(req.params.id);
  if (String(req.session.user.id) === id) return res.status(400).json({ error: "Нельзя удалить самого себя" });
  const list = readUsers(); const next = list.filter(u => String(u.id) !== id);
  if (next.length === list.length) return res.status(404).json({ error: "Нет такого пользователя" });
  writeUsers(next); res.json({ ok: true });
});

// ----------------- VC metrics -----------------

// берём ID статьи из ссылки vc.ru/…/1234567-title
function extractIdFromUrl(url) {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/(\d{4,})/g);
    return m ? Number(m.pop()) : NaN;
  } catch { return NaN; }
}

async function fetchVcItem(id) {
  const url = `https://api.vc.ru/v2.10/content?id=${id}&markdown=false`;
  const r = await fetch(url, { headers: { "accept": "application/json" } });
  if (!r.ok) throw new Error(`VC API ${r.status}`);
  const j = await r.json();
  const x = j.result || {};
  const counters = x.counters || {};
  return {
    id: x.id,
    url: x.url || `https://vc.ru/${x.customUri || ""}`,
    title: x.title || "",
    date: x.date || 0,
    counters: {
      views: Number(counters.views || 0),
      hits: Number(counters.hits || x.hitsCount || 0)
    },
    lastUpdated: Date.now()
  };
}

// список
app.get("/api/articles", requireAuth, async (req, res) => {
  const items = readArticles();
  const cfg = readConfig();
  // сортировка по дате публикации (убывание)
  items.sort((a, b) => (b.date || 0) - (a.date || 0));
  res.json({ items, placementPrice: Number(cfg.placementPrice || 0) });
});

// добавить
app.post("/api/articles", requireAuth, async (req, res) => {
  const { url } = req.body || {};
  const id = extractIdFromUrl(String(url || ""));
  if (!id) return res.status(400).json({ error: "Не удалось извлечь ID из ссылки" });

  const list = readArticles();
  if (list.some(x => Number(x.id) === Number(id)))
    return res.status(409).json({ error: "Такая статья уже есть" });

  const item = await fetchVcItem(id);
  list.push(item); writeArticles(list);
  res.json({ ok: true, item });
});

// refresh 1
app.patch("/api/articles/:id/refresh", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const list = readArticles();
  const idx = list.findIndex(x => Number(x.id) === id);
  if (idx === -1) return res.status(404).json({ error: "Нет в базе" });
  const fresh = await fetchVcItem(id);
  list[idx] = { ...list[idx], ...fresh };
  writeArticles(list);
  res.json({ ok: true, item: list[idx] });
});

// delete
app.delete("/api/articles/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const list = readArticles();
  const next = list.filter(x => Number(x.id) !== id);
  if (next.length === list.length) return res.status(404).json({ error: "Нет в базе" });
  writeArticles(next); res.json({ ok: true });
});

// refresh all
app.post("/api/refresh-all", requireAuth, async (req, res) => {
  const list = readArticles();
  for (let i = 0; i < list.length; i++) {
    try {
      const fresh = await fetchVcItem(list[i].id);
      list[i] = { ...list[i], ...fresh };
    } catch (_) {}
  }
  writeArticles(list);
  res.json({ ok: true, count: list.length });
});

// set placement price (admin)
app.post("/api/admin/set-price", requireAuth, requireAdmin, (req, res) => {
  const { price } = req.body || {};
  const cfg = readConfig();
  cfg.placementPrice = Number(price || 0);
  writeConfig(cfg);
  res.json({ ok: true, placementPrice: cfg.placementPrice });
});

// -----------------
app.listen(PORT, () => console.log(`Server on :${PORT}`));
