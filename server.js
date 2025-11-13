// simple auth server + static SPA
const express = require("express");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const cookieSession = require("cookie-session");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(
  cookieSession({
    name: "sess",
    secret: process.env.SESSION_SECRET || "vc-metrics-dev-secret",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24 * 7 // 7 days
  })
);

// --- tiny JSON "db"
const USERS_PATH = path.join(__dirname, "users.json");
function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_PATH, "utf8")); }
  catch { return []; }
}
function findUser(email) {
  const e = String(email || "").toLowerCase();
  return loadUsers().find(u => String(u.email).toLowerCase() === e);
}

// --- static
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

// SPA entry (включая /login прямой заход)
app.get(["/", "/login", "/app"], (_, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// --- auth api
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body || {};
  const user = findUser(email);
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

// пример приватного ping
app.get("/api/private/ping", (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: "unauth" });
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`Server on http://localhost:${PORT}`));
