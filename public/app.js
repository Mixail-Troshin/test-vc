// helpers
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts
  });
  if (!res.ok) {
    let t = "";
    try { t = await res.json(); } catch { t = await res.text(); }
    throw new Error(t?.error || t || res.statusText);
  }
  const txt = await res.text();
  return txt ? JSON.parse(txt) : {};
}

function toast(msg){
  const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden");
  setTimeout(()=>t.classList.add("hidden"), 2200);
}

/* Tabs */
function setTab(name){
  $$(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  $("#tab-dashboard").classList.toggle("hidden", name !== "dashboard");
  $("#tab-users").classList.toggle("hidden", name !== "users");
}
$$(".tab").forEach(b => b.onclick = () => setTab(b.dataset.tab));

/* Auth guard */
async function guard(){
  try {
    const { user } = await api("/api/me");
    $("#meEmail").textContent = user.email;
    $("#tabUsers").style.display = user.isAdmin ? "inline-flex" : "none";
    $("#login").classList.add("hidden");
    $("#app").classList.remove("hidden");
    if (user.isAdmin) await loadUsers();
  } catch {
    $("#app").classList.add("hidden");
    $("#login").classList.remove("hidden");
  }
}

/* Login form (no reload) */
$("#loginForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  $("#loginErr").textContent = "";
  const email = $("#email").value.trim();
  const password = $("#password").value;
  if (!email || !password) { $("#loginErr").textContent = "Введите e-mail и пароль"; return; }

  const btn = $("#loginBtn");
  btn.disabled = true; btn.textContent = "Входим…";
  try {
    await api("/api/login", { method:"POST", body: JSON.stringify({ email, password }) });
    await guard();
  } catch (err) {
    $("#loginErr").textContent = err.message;
  } finally {
    btn.disabled = false; btn.textContent = "Войти";
  }
});

$("#logout").onclick = async ()=>{
  await api("/api/logout", { method:"POST" });
  $("#app").classList.add("hidden");
  $("#login").classList.remove("hidden");
};

/* Admin: users */
async function loadUsers(){
  const { users } = await api("/api/users");
  const tb = $("#usersTbl tbody"); tb.innerHTML = "";
  for (const u of users) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${u.id}</td>
      <td>${u.email}</td>
      <td>${u.isAdmin ? "admin" : "user"}</td>
      <td>${new Date(u.createdAt).toLocaleString()}</td>
      <td class="actions">
        <button class="ghost" data-act="reset" data-id="${u.id}">Сбросить пароль</button>
        <button class="ghost" data-act="delete" data-id="${u.id}">Удалить</button>
      </td>`;
    tb.appendChild(tr);
  }
}

$("#usersTbl").onclick = async (e)=>{
  const btn = e.target.closest("button"); if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.act === "reset") {
    btn.disabled = true; btn.textContent = "…";
    try {
      const { tempPassword } = await api("/api/users/reset", {
        method:"POST", body: JSON.stringify({ id })
      });
      toast("Пароль сброшен. Скопируйте ниже.");
      $("#inviteOut").innerHTML = `Новый пароль для пользователя <b>ID ${id}</b>: <code>${tempPassword}</code>`;
    } finally { btn.disabled = false; btn.textContent = "Сбросить пароль"; }
  }
  if (btn.dataset.act === "delete") {
    if (!confirm("Удалить пользователя?")) return;
    await api(`/api/users/${id}`, { method:"DELETE" });
    await loadUsers(); toast("Удалён");
  }
};

$("#inviteBtn").onclick = async ()=>{
  const email = $("#invEmail").value.trim();
  const isAdmin = $("#invAdmin").checked;
  if (!email) { toast("Укажите e-mail"); return; }
  const b = $("#inviteBtn"); b.disabled = true; b.textContent = "Создаю…";
  try{
    const { tempPassword, user } = await api("/api/users/invite", {
      method:"POST", body: JSON.stringify({ email, isAdmin })
    });
    $("#inviteOut").innerHTML =
      `Пользователь <b>${user.email}</b> создан. Временный пароль: <code>${tempPassword}</code>`;
    $("#invEmail").value = ""; $("#invAdmin").checked = false;
    await loadUsers();
  }catch(err){
    toast(err.message);
  }finally{
    b.disabled = false; b.textContent = "Создать и выдать пароль";
  }
};

// boot
guard();
