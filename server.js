// CJS сервер: простая авторизация + управление пользователями
const express = require("express");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const cookieSession = require("cookie-session");

const app = express();
const PORT = process.env.PORT || 3000;

const ROOT = __dirname;
const USERS_PATH = path.join(ROOT, "users.json");

// --- helpers -----------------------------------------------------------------
function readUsers() {
  try {
    const json = fs.readFileSync(USERS_PATH, "utf8");
    const arr = JSON.parse(json);
    if (Array.isArray(arr)) return arr;
  } catch (_) {}
  return [];
}

function writeUsers(list) {
  fs.writeFileSync(USERS_PATH, JSON.stringify(list, null, 2), "utf8");
}

function ensureAdminSeed() {
  const list = readUsers();
  if (!list.some(u => String(u.email).toLowerCase() === "admin@local")) {
    // пароль: "admin"
    const hash = "$2b$12$bF9/3pVaCM6L8BGZokmM8ecGfiY/WcKoIa/jv03gRrBTr2VQkVb2C";
    list.push({
      id: 1,
      email: "admin@local",
      password: hash,
      isAdmin: true,
      createdAt: Date.now()
    });
    writeUsers(list);
  }
}
ensureAdminSeed();

function normalizeEmail(e) {
  return String(e || "").trim().toLowerCase();
}
function genId(list) {
  const max = list.reduce((m, u) => Math.max(m, Number(u.id) || 0), 0);
  return max + 1;
}
function genPassword(len = 10) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[(Math.random() * chars.length) | 0];
  return out;
}

// --- middleware --------------------------------------------------------------
app.use(express.json());
app.use(
  cookieSession({
    name: "sess",
    secret: process.env.SESSION_SECRET || "vc-metrics-dev",
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 дней
    sameSite: "lax",
    httpOnly: true
  })
);

// статика SPA
app.use(express.static(path.join(ROOT, "public"), { extensions: ["html"] }));

// SPA fallback (на всякий)
app.get(["/", "/app", "/login"], (req, res) => {
  res.sendFile(path.join(ROOT, "public", "index.html"));
});

// --- auth API ----------------------------------------------------------------
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body || {};
  const e = normalizeEmail(email);
  const user = readUsers().find(u => normalizeEmail(u.email) === e);
  if (!user) return res.status(401).json({ error: "Неверные данные" });

  const ok = await bcrypt.compare(password || "", user.password);
  if (!ok) return res.status(401).json({ error: "Неверные данные" });

  req.session.user = { id: user.id, email: user.email, isAdmin: !!user.isAdmin };
  res.json({ ok: true, user: req.session.user });
});

app.post("/api/logout", (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: "unauth" });
  res.json({ user: req.session.user });
});

function requireAuth(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: "unauth" });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session?.user?.isAdmin) return res.status(403).json({ error: "forbidden" });
  next();
}

// --- users admin -------------------------------------------------------------
app.get("/api/users", requireAuth, requireAdmin, (req, res) => {
  const list = readUsers().map(u => ({
    id: u.id, email: u.email, isAdmin: !!u.isAdmin, createdAt: u.createdAt
  }));
  res.json({ users: list });
});

app.post("/api/users/invite", requireAuth, requireAdmin, async (req, res) => {
  const { email, isAdmin = false } = req.body || {};
  const e = normalizeEmail(email);
  if (!e) return res.status(400).json({ error: "Укажите e-mail" });

  const list = readUsers();
  if (list.some(u => normalizeEmail(u.email) === e)) {
    return res.status(409).json({ error: "Пользователь уже существует" });
  }

  const passwordPlain = genPassword(12);
  const passwordHash = await bcrypt.hash(passwordPlain, 12);
  const user = { id: genId(list), email: e, password: passwordHash, isAdmin: !!isAdmin, createdAt: Date.now() };
  list.push(user);
  writeUsers(list);

  // Возвращаем временный пароль, чтобы ты отправил его сам (почтой/мессенджером)
  res.json({ ok: true, user: { id: user.id, email: user.email, isAdmin: user.isAdmin }, tempPassword: passwordPlain });
});

app.post("/api/users/reset", requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.body || {};
  const list = readUsers();
  const u = list.find(x => String(x.id) === String(id));
  if (!u) return res.status(404).json({ error: "Нет такого пользователя" });

  const temp = genPassword(12);
  u.password = await bcrypt.hash(temp, 12);
  writeUsers(list);
  res.json({ ok: true, tempPassword: temp });
});

app.delete("/api/users/:id", requireAuth, requireAdmin, (req, res) => {
  const id = String(req.params.id);
  if (String(req.session.user.id) === id) {
    return res.status(400).json({ error: "Нельзя удалить самого себя" });
  }
  const list = readUsers();
  const next = list.filter(u => String(u.id) !== id);
  if (next.length === list.length) return res.status(404).json({ error: "Нет такого пользователя" });
  writeUsers(next);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
app.listen(PORT, () => console.log(`Auth server running on :${PORT}`));
