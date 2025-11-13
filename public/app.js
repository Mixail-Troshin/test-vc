// helpers
const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const money = n => (Number(n || 0)).toLocaleString("ru-RU");
const fmt   = ts => ts ? new Date((String(ts).length > 10 ? ts : ts * 1000)).toLocaleString() : "—";
const cpm   = (price, metric) => !metric ? 0 : Math.round((Number(price || 0) / (metric / 1000)));

async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: "include",
    headers: { "Content-Type": "application/json" }, ...opts });
  if (!res.ok) {
    let t = ""; try { t = await res.json(); } catch { t = await res.text(); }
    throw new Error(t?.error || t || res.statusText);
  }
  const txt = await res.text();
  return txt ? JSON.parse(txt) : {};
}
function showToast(msg){ const t=$("#toast"); t.textContent=msg; t.classList.remove("hidden"); setTimeout(()=>t.classList.add("hidden"),2200); }

// -------- Landing animations (counters) --------
function animateMetersOnce(el){
  const to = Number(el.dataset.to||0);
  const start = performance.now(), dur = 2000 + Math.random()*1500;
  function frame(t){
    const p = Math.min(1,(t-start)/dur);
    el.textContent = Math.floor(to*p).toLocaleString("ru-RU");
    if(p<1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
function loopMeters(){
  $$(".meter").forEach(el=>{
    animateMetersOnce(el);
    setInterval(()=>{
      el.dataset.to = String(Math.floor(Number(el.dataset.to||0)*(0.8+Math.random()*0.6)));
      animateMetersOnce(el);
    }, 4500 + Math.random()*2500);
  });
}

// -------- Auth / routing --------
async function guard(){
  try{
    const { user } = await api("/api/me");
    // logged in
    $("#landing")?.classList.add("hidden");
    $("#login")?.classList.add("hidden");
    $("#app")?.classList.remove("hidden");
    $("#tabSettings")?.style && ( $("#tabSettings").style.display = user.isAdmin ? "inline-block" : "none" );
    await loadData();
  }catch{
    // public mode
    $("#app")?.classList.add("hidden");
    $("#landing")?.classList.remove("hidden");
    $("#login")?.classList.add("hidden");
    loopMeters();
  }
}
$("#openLogin").onclick = ()=> $("#login").classList.remove("hidden");
$("#closeLogin").onclick = ()=> $("#login").classList.add("hidden");
$("#goCabinet").onclick  = ()=> $("#login").classList.remove("hidden");

// submit login (без перезагрузки)
$("#loginForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  $("#loginErr").textContent = "";
  const email = $("#email").value.trim();
  const password = $("#password").value;
  if(!email || !password){ $("#loginErr").textContent = "Введите e-mail и пароль"; return; }
  const btn = $("#loginBtn"); btn.disabled = true; btn.textContent="Входим…";
  try{
    await api("/api/login",{method:"POST",body:JSON.stringify({email,password})});
    $("#login").classList.add("hidden");
    await guard();
  }catch(err){
    $("#loginErr").textContent = err.message || "Ошибка входа";
  }finally{
    btn.disabled=false; btn.textContent="Войти";
  }
});

// logout (кнопка «Выйти» есть внутри приватного интерфейса)
$("#logout")?.addEventListener("click", async ()=>{
  await api("/api/logout", { method:"POST" });
  await guard();
});

// -------- Private app (как было) --------
const state = { items: [], price: 0 };

async function loadData(){
  const { items, placementPrice } = await api("/api/articles");
  state.items = items; state.price = placementPrice || 0;
  $("#price").value = state.price;
  renderTable();
}
function renderTable(){
  const tb = $("#table tbody"); if(!tb) return; tb.innerHTML="";
  let sumHits=0;
  for(const it of state.items){
    sumHits += Number(it?.counters?.hits||0);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${fmt(it.date)}</td>
      <td><a href="${it.url}" target="_blank" rel="noopener">${it.title || it.url}</a></td>
      <td>${money(it.counters?.hits)}</td>
      <td>${money(it.counters?.views)}</td>
      <td>${money(cpm(state.price, it.counters?.hits))}</td>
      <td>${money(cpm(state.price, it.counters?.views))}</td>
      <td>${fmt(it.lastUpdated)}</td>
      <td class="actions">
        <button class="ghost" data-act="refresh" data-id="${it.id}">Обновить</button>
        <button class="danger" data-act="remove" data-id="${it.id}">Удалить</button>
      </td>`;
    tb.appendChild(tr);
  }
  $("#sumPubs").textContent = state.items.length;
  $("#sumHits").textContent = money(sumHits);
}
$("#table")?.addEventListener("click", async (e)=>{
  const btn = e.target.closest("button"); if(!btn) return;
  const id = btn.dataset.id;

  if(btn.dataset.act==="refresh"){
    const txt=btn.textContent; btn.disabled=true; btn.textContent="…";
    try{
      const { item } = await api(`/api/articles/${id}/refresh`,{method:"PATCH"});
      const i = state.items.findIndex(x => String(x.id)===String(id));
      state.items[i]=item; renderTable(); showToast("Обновлено");
    } finally { btn.disabled=false; btn.textContent=txt; }
  }
  if(btn.dataset.act==="remove"){
    if(!confirm("Удалить статью из списка?")) return;
    await api(`/api/articles/${id}`,{method:"DELETE"});
    state.items = state.items.filter(x=>String(x.id)!==String(id));
    renderTable(); showToast("Удалено");
  }
});
$("#addBtn")?.addEventListener("click", async ()=>{
  const url = $("#urlInput").value.trim(); if(!url) return;
  $("#addMsg").textContent="Добавляю…";
  try{
    await api("/api/articles",{method:"POST",body:JSON.stringify({url})});
    $("#urlInput").value=""; await loadData(); $("#addMsg").textContent="Готово";
  }catch(e){ $("#addMsg").textContent="Ошибка: "+e.message; }
  finally{ setTimeout(()=>$("#addMsg").textContent="",1500); }
});
$("#refreshAll")?.addEventListener("click", async ()=>{
  const b=$("#refreshAll"); b.disabled=true; b.textContent="Обновляю…";
  try{ await api("/api/refresh-all",{method:"POST"}); await loadData(); }
  finally{ b.disabled=false; b.textContent="Обновить всё"; }
});
$("#savePrice")?.addEventListener("click", async ()=>{
  try{
    const val = Number($("#price").value || 0);
    await api("/api/admin/set-price",{method:"POST",body:JSON.stringify({price:val})});
    state.price=val; renderTable();
    $("#priceMsg").textContent="Сохранено"; setTimeout(()=>$("#priceMsg").textContent="",1500);
  }catch{ $("#priceMsg").textContent="Нужны права администратора"; }
});

// boot
guard();
