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

function showToast(msg){
  const t = $("#toast"); t.textContent = msg;
  t.classList.remove("hidden"); setTimeout(()=>t.classList.add("hidden"), 2200);
}

// ---------------- Matrix (letters go UP) -----------------
(function matrixUp(){
  const canvas = $("#matrix");
  const ctx = canvas.getContext("2d");
  const glyphs = "01█▓░ ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789 АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ".split("");
  let W, H, cols, colY = [];

  function resize(){
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
    const fontSize = Math.max(14, Math.floor(W / 90));
    ctx.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    cols = Math.floor(W / (fontSize * 0.6));
    colY = new Array(cols).fill(H + Math.random()*H); // начинаем снизу
  }
  window.addEventListener("resize", resize);
  resize();

  function tick(){
    // прозрачная вуаль — создаёт шлейф
    ctx.fillStyle = "rgba(10,12,16,0.1)";
    ctx.fillRect(0,0,W,H);
    for (let i=0; i<cols; i++){
      const x = i * (ctx.measureText("M").width + 2);
      const y = colY[i];
      const ch = glyphs[(Math.random()*glyphs.length)|0];
      ctx.fillStyle = `rgba(180,190,200,${0.55 + Math.random()*0.4})`;
      ctx.fillText(ch, x, y);

      // двигаем ВВЕРХ
      colY[i] -= (8 + Math.random()*22);
      // перезапуск снизу с разной задержкой
      if (colY[i] < -50) colY[i] = H + Math.random()*H;
    }
    requestAnimationFrame(tick);
  }
  tick();
})();

// ---------------- Auth flow -----------------
function showLogin(){
  $("#login").classList.remove("hidden");
  $("#app").classList.add("hidden");
  $("#email").focus();
}
function showApp(){
  $("#login").classList.add("hidden");
  $("#app").classList.remove("hidden");
  history.replaceState({}, "", "/app");
}

async function guard(){
  try {
    await api("/api/me");
    showApp();
  } catch {
    showLogin();
  }
}

// login submit (no page reload)
$("#loginForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  $("#loginErr").textContent = "";
  const email = $("#email").value.trim();
  const password = $("#password").value;
  if (!email || !password) { $("#loginErr").textContent = "Введите e-mail и пароль"; return; }
  const btn = $("#loginBtn");
  btn.disabled = true; btn.textContent = "Входим…";
  try{
    await api("/api/login", { method:"POST", body: JSON.stringify({ email, password }) });
    showApp();
  }catch(err){
    $("#loginErr").textContent = err.message || "Ошибка входа";
  }finally{
    btn.disabled = false; btn.textContent = "Войти";
  }
});

$("#logout").onclick = async ()=>{
  await api("/api/logout", { method:"POST" });
  showLogin();
};

// demo private ping
$("#ping").onclick = async ()=>{
  try{ await api("/api/private/ping"); $("#pong").textContent = "ok"; }
  catch{ $("#pong").textContent = "401"; }
  setTimeout(()=> $("#pong").textContent = "", 1400);
};

// boot
guard();
