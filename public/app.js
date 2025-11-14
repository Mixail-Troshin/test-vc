// ---------- helpers ----------
const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const money = n => (Number(n||0)).toLocaleString("ru-RU");
const fmt   = ts => ts ? new Date((String(ts).length>10?ts:ts*1000)).toLocaleString() : "—";
const cpm   = (price, metric) => !metric ? 0 : Math.round((Number(price||0) / (metric/1000)));

async function api(path, opts = {}) {
  const res = await fetch(path, { credentials:"include", headers:{"Content-Type":"application/json"}, ...opts });
  if (!res.ok) {
    let t=""; try{t=await res.json()}catch{t=await res.text()}
    throw new Error(t?.error || t || res.statusText);
  }
  const txt = await res.text(); return txt ? JSON.parse(txt) : {};
}
function toast(msg){ const t=$("#toast"); t.textContent=msg; t.classList.remove("hidden"); setTimeout(()=>t.classList.add("hidden"),2200); }

// ---------- tabs ----------
function setTab(name){
  $$(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab===name));
  $("#tab-dashboard").classList.toggle("hidden", name!=="dashboard");
  $("#tab-users").classList.toggle("hidden", name!=="users");
}
$$(".tab").forEach(b => b.onclick=()=>setTab(b.dataset.tab));

// ---------- auth guard ----------
async function guard(){
  try{
    const {user} = await api("/api/me");
    $("#meEmail").textContent = user.email;
    $("#tabUsers").style.display = user.isAdmin ? "inline-flex" : "none";
    $("#login").classList.add("hidden");
    $("#app").classList.remove("hidden");
    await loadData(); if (user.isAdmin) await loadUsers();
  }catch{
    $("#app").classList.add("hidden");
    $("#login").classList.remove("hidden");
  }
}

// login
$("#loginForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  $("#loginErr").textContent="";
  const email=$("#email").value.trim(); const password=$("#password").value;
  if(!email||!password){ $("#loginErr").textContent="Введите e-mail и пароль"; return; }
  const btn=$("#loginBtn"); btn.disabled=true; btn.textContent="Входим…";
  try{ await api("/api/login",{method:"POST",body:JSON.stringify({email,password})}); await guard(); }
  catch(err){ $("#loginErr").textContent=err.message; }
  finally{ btn.disabled=false; btn.textContent="Войти"; }
});

$("#logout").onclick = async ()=>{ await api("/api/logout",{method:"POST"}); $("#app").classList.add("hidden"); $("#login").classList.remove("hidden"); };

// ---------- statistics ----------
const state = { items:[], price:0 };

async function loadData(){
  const { items, placementPrice } = await api("/api/articles");
  state.items = items || [];
  state.price = Number(placementPrice||0);
  $("#price").value = state.price;
  renderSummary(); renderTable();
}

function renderSummary(){
  const sumHits  = state.items.reduce((s,x)=>s+Number(x.counters?.hits||0),0);
  const sumViews = state.items.reduce((s,x)=>s+Number(x.counters?.views||0),0);
  const budget   = state.items.length * Number(state.price||0);
  const avgCpmHits  = state.items.length ? Math.round((budget)/(sumHits/1000 || 1)) : 0;
  const avgCpmViews = state.items.length ? Math.round((budget)/(sumViews/1000 || 1)) : 0;

  $("#kpi-count").textContent      = money(state.items.length);
  $("#kpi-hits").textContent       = money(sumHits);
  $("#kpi-budget").textContent     = money(budget);
  $("#kpi-cpm-hits").textContent   = money(avgCpmHits);
  $("#kpi-cpm-views").textContent  = money(avgCpmViews);
}

function renderTable(){
  const tb = $("#table tbody"); tb.innerHTML="";
  for(const it of state.items){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${fmt(it.date)}</td>
      <td><a href="${it.url}" target="_blank">${it.title || it.url}</a></td>
      <td><a href="${it.url}" target="_blank">Открыть</a></td>
      <td>${money(it.counters?.hits)}</td>
      <td>${money(it.counters?.views)}</td>
      <td>${money(cpm(state.price, it.counters?.hits))}</td>
      <td>${money(cpm(state.price, it.counters?.views))}</td>
      <td>${fmt(it.lastUpdated)}</td>
      <td class="actions">
        <button class="ghost" data-act="refresh" data-id="${it.id}">Обновить</button>
        <button class="primary" data-act="remove" data-id="${it.id}" style="background:#b91c1c">Удалить</button>
      </td>`;
    tb.appendChild(tr);
  }
}

$("#table").onclick = async (e)=>{
  const btn = e.target.closest("button"); if(!btn) return;
  const id  = btn.dataset.id;
  if(btn.dataset.act==="refresh"){
    btn.disabled=true; btn.textContent="…";
    try{
      const { item } = await api(`/api/articles/${id}/refresh`, { method:"PATCH" });
      const i = state.items.findIndex(x=>String(x.id)===String(id));
      if(i>-1) state.items[i] = item;
      renderSummary(); renderTable(); toast("Обновлено");
    }finally{ btn.disabled=false; btn.textContent="Обновить"; }
  }
  if(btn.dataset.act==="remove"){
    if(!confirm("Удалить статью из списка?")) return;
    await api(`/api/articles/${id}`, { method:"DELETE" });
    state.items = state.items.filter(x=>String(x.id)!==String(id));
    renderSummary(); renderTable(); toast("Удалено");
  }
};

$("#addBtn").onclick = async ()=>{
  const url = $("#urlInput").value.trim(); if(!url) return;
  $("#addMsg").textContent="Добавляю…";
  try{
    await api("/api/articles", { method:"POST", body:JSON.stringify({ url }) });
    $("#urlInput").value=""; await loadData(); $("#addMsg").textContent="Готово";
  }catch(e){ $("#addMsg").textContent="Ошибка: "+e.message; }
};

$("#refreshAll").onclick = async ()=>{
  const b=$("#refreshAll"); b.disabled=true; b.textContent="Обновляю…";
  try{ await api("/api/refresh-all",{method:"POST"}); await loadData(); toast("Обновлено"); }
  finally{ b.disabled=false; b.textContent="Обновить всё"; }
};

$("#savePrice").onclick = async ()=>{
  try{
    const val = Number($("#price").value||0);
    await api("/api/admin/set-price",{method:"POST", body:JSON.stringify({price:val})});
    state.price = val; renderSummary(); renderTable();
    $("#priceMsg").textContent = "Сохранено";
    setTimeout(()=>$("#priceMsg").textContent="",1500);
  }catch(e){ $("#priceMsg").textContent = "Нужны права администратора"; }
};

// ---------- users admin ----------
async function loadUsers(){
  const { users } = await api("/api/users");
  const tb = $("#usersTbl tbody"); tb.innerHTML="";
  for(const u of users){
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
  const btn = e.target.closest("button"); if(!btn) return;
  const id  = btn.dataset.id;
  if(btn.dataset.act==="reset"){
    btn.disabled=true; btn.textContent="…";
    try{
      const { tempPassword } = await api("/api/users/reset",{method:"POST",body:JSON.stringify({id})});
      toast("Пароль сброшен — см. ниже");
      $("#inviteOut").innerHTML = `Новый пароль для ID ${id}: <code>${tempPassword}</code>`;
    }finally{ btn.disabled=false; btn.textContent="Сбросить пароль"; }
  }
  if(btn.dataset.act==="delete"){
    if(!confirm("Удалить пользователя?")) return;
    await api(`/api/users/${id}`,{method:"DELETE"});
    await loadUsers(); toast("Удалён");
  }
};

$("#inviteBtn").onclick = async ()=>{
  const email = $("#invEmail").value.trim(); const isAdmin = $("#invAdmin").checked;
  if(!email) { toast("Укажите e-mail"); return; }
  const b=$("#inviteBtn"); b.disabled=true; b.textContent="Создаю…";
  try{
    const { user, tempPassword } = await api("/api/users/invite",{method:"POST",body:JSON.stringify({email, isAdmin})});
    $("#inviteOut").innerHTML = `Пользователь <b>${user.email}</b> создан. Временный пароль: <code>${tempPassword}</code>`;
    $("#invEmail").value=""; $("#invAdmin").checked=false; await loadUsers();
  }catch(err){ toast(err.message); }
  finally{ b.disabled=false; b.textContent="Создать и выдать пароль"; }
};

// boot
guard();
