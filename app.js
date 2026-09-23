/* ===========================================================
   AgendaPro — painel do assinante (Supabase: multi-tenant real)
   Cada login = um "business" isolado por Row Level Security.
   =========================================================== */

const SEGMENTS = {
  salao:      { label: "Salão de Beleza",        color: "#e05d8f", services: [["Corte",60,80],["Escova",45,50],["Coloração",120,150],["Manicure",45,35],["Pedicure",45,40]] },
  barbearia:  { label: "Barbearia",               color: "#2b2d42", services: [["Corte Masculino",30,45],["Barba",20,30],["Sobrancelha",15,20]] },
  estetica:   { label: "Clínica de Estética",     color: "#7b61ff", services: [["Limpeza de Pele",60,120],["Massagem Relaxante",60,100],["Peeling",45,150]] },
  saude:      { label: "Consultório / Saúde",     color: "#2e9e5b", services: [["Consulta",50,150],["Retorno",30,80],["Avaliação",40,100]] },
  outro:      { label: "Outro segmento",          color: "#e08e45", services: [["Serviço 1",60,100],["Serviço 2",30,50]] }
};
const PALETTE = ["#e05d8f","#7b61ff","#2e9e5b","#e08e45","#2b8fd6","#d64545","#c9962b","#3aa0a0"];
const BACKEND_URL = "https://agendapro-backend-1n92.onrender.com";
const PLAN_LIMITS = { basico: { profissionais: 2, relatorioCompleto: false, logoPersonalizado: false },
                       pro:    { profissionais: 10, relatorioCompleto: true,  logoPersonalizado: true } };
function planoAtual(){
  // Sem plano escolhido ainda (trial) = mesmos limites do Pro, pra poder avaliar o app antes de assinar.
  return PLAN_LIMITS[BUSINESS.subscription_plan] || PLAN_LIMITS.pro;
}

let CURRENT_USER = null;
let BUSINESS = null;
let PROFESSIONALS = [];
let SERVICES = [];
let APPOINTMENTS = [];

function brl(v){ return "R$ " + Number(v||0).toLocaleString("pt-BR",{minimumFractionDigits:2, maximumFractionDigits:2}); }
function pad(n){ return String(n).padStart(2,"0"); }
function dateKey(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function formatDateBR(dateStr){ const [y,m,d] = dateStr.split("-"); return `${d}/${m}/${y}`; }
function timeShort(t){ return t ? t.slice(0,5) : t; }

/* ---------------- AUTH / BOOTSTRAP ---------------- */
async function boot(){
  const { data: { session } } = await supabaseClient.auth.getSession();
  if(!session){ window.location.href = "login.html"; return; }
  CURRENT_USER = session.user;
  await loadOrCreateBusiness();
  if(isSubscriptionBlocked()){ renderSubscriptionGate(); return; }
  await loadAll();
  fillConfigForm();
  refreshAll();
}

/* ---------------- ASSINATURA (Mercado Pago) ---------------- */
function isSubscriptionBlocked(){
  if(BUSINESS.subscription_status === "inadimplente" || BUSINESS.subscription_status === "cancelado") return true;
  if(BUSINESS.subscription_status === "trial" && !BUSINESS.subscription_plan && BUSINESS.trial_expires_at && new Date(BUSINESS.trial_expires_at) < new Date()) return true;
  return false;
}
function trialExpirado(){
  return BUSINESS.subscription_status === "trial" && !BUSINESS.subscription_plan && BUSINESS.trial_expires_at && new Date(BUSINESS.trial_expires_at) < new Date();
}

async function iniciarAssinatura(plano){
  try{
    const resp = await fetch(`${BACKEND_URL}/api/assinatura/criar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business_id: BUSINESS.id, email: CURRENT_USER.email, plano })
    });
    const data = await resp.json();
    if(data.link){ window.location.href = data.link; }
    else { alert("Não foi possível iniciar a assinatura: " + (data.error || "tente novamente em instantes.")); }
  }catch(err){
    alert("Erro de conexão com o servidor de pagamento. Tente novamente em instantes.");
  }
}

function renderSubscriptionGate(){
  document.querySelector(".tabs").style.display = "none";
  const titulo = trialExpirado() ? "Seu teste grátis de 30 dias acabou" : "Assinatura pendente";
  const msg = trialExpirado()
    ? "Esperamos que tenha gostado! Escolha um plano abaixo pra continuar usando o AgendaPro."
    : `Sua assinatura do AgendaPro está <strong>${BUSINESS.subscription_status}</strong>. Escolha um plano abaixo para voltar a usar o app.`;
  document.querySelector(".content").innerHTML = `
    <h1>${titulo}</h1>
    <p class="hint">${msg}</p>
    <div class="cards">
      <div class="card">
        <span class="card-label">Básico — R$ 79/mês</span>
        <span class="hint">Até 2 profissionais, calendário geral + individual.</span>
        <button class="btn-primary" id="gateBasico" style="margin-top:10px;">Assinar Básico</button>
      </div>
      <div class="card">
        <span class="card-label">Pro — R$ 120/mês</span>
        <span class="hint">Até 10 profissionais, relatório completo, marca personalizada.</span>
        <button class="btn-primary" id="gatePro" style="margin-top:10px;">Assinar Pro</button>
      </div>
    </div>
  `;
  document.getElementById("gateBasico").addEventListener("click", ()=> iniciarAssinatura("basico"));
  document.getElementById("gatePro").addEventListener("click", ()=> iniciarAssinatura("pro"));
}

document.getElementById("logoutBtn").addEventListener("click", async ()=>{
  await supabaseClient.auth.signOut();
  window.location.href = "login.html";
});

async function loadOrCreateBusiness(){
  let { data: biz } = await supabaseClient.from("businesses").select("*").eq("owner_id", CURRENT_USER.id).maybeSingle();
  if(!biz){
    const slug = "negocio-" + Math.random().toString(36).slice(2,8);
    const { data: newBiz, error } = await supabaseClient.from("businesses")
      .insert({ owner_id: CURRENT_USER.id, slug, name: "Meu Negócio", segment: "salao" })
      .select().single();
    if(error){ alert("Erro ao criar negócio: " + error.message); return; }
    biz = newBiz;
  }
  BUSINESS = biz;
  await ensureServicesSeed();
}

async function ensureServicesSeed(){
  const { count } = await supabaseClient.from("services").select("id", { count: "exact", head: true }).eq("business_id", BUSINESS.id);
  if(count === 0){
    const rows = SEGMENTS[BUSINESS.segment].services.map(([name,duration,price])=>({ business_id: BUSINESS.id, name, duration, price }));
    await supabaseClient.from("services").insert(rows);
  }
}

async function loadAll(){
  const [{ data: profs }, { data: servs }, { data: appts }] = await Promise.all([
    supabaseClient.from("professionals").select("*").eq("business_id", BUSINESS.id).order("created_at"),
    supabaseClient.from("services").select("*").eq("business_id", BUSINESS.id).order("created_at"),
    supabaseClient.from("appointments").select("*").eq("business_id", BUSINESS.id).order("date").order("time")
  ]);
  PROFESSIONALS = (profs||[]).map(p=>({ ...p, start: timeShort(p.start_time), end: timeShort(p.end_time) }));
  SERVICES = servs || [];
  APPOINTMENTS = (appts||[]).map(a=>({ ...a, profId: a.professional_id, servId: a.service_id, time: timeShort(a.time), clientName: a.client_name, clientPhone: a.client_phone }));
}

/* ---------------- TABS ---------------- */
document.querySelectorAll(".tab-btn[data-tab]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll(".tab-btn[data-tab]").forEach(b=>b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p=>p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-"+btn.dataset.tab).classList.add("active");
    refreshAll();
  });
});

/* ---------------- THEME / BRAND ---------------- */
function applyBrand(){
  const cor = BUSINESS.brand_color || "#C6E619";
  document.documentElement.style.setProperty("--lime", cor);
  document.documentElement.style.setProperty("--lime-ink", contrastInk(cor));
  document.getElementById("brandName").textContent = BUSINESS.name || "AgendaPro";
  const logoEl = document.getElementById("brandLogo");
  if(BUSINESS.logo_url){ logoEl.src = BUSINESS.logo_url; logoEl.classList.remove("hidden"); }
  else { logoEl.classList.add("hidden"); }
}
function contrastInk(hex){
  const num = parseInt(hex.slice(1),16);
  const r=(num>>16)&255, g=(num>>8)&255, b=num&255;
  const brightness = (r*299 + g*587 + b*114) / 1000;
  return brightness > 150 ? "#101010" : "#F5F5EF";
}
function shade(hex, percent){
  const num = parseInt(hex.slice(1),16);
  let r=(num>>16)+percent, g=((num>>8)&0x00FF)+percent, b=(num&0x0000FF)+percent;
  r=Math.max(Math.min(255,r),0); g=Math.max(Math.min(255,g),0); b=Math.max(Math.min(255,b),0);
  return "#"+(g|(r<<16)|(b<<8)).toString(16).padStart(6,"0");
}

/* ---------------- CONFIG FORM ---------------- */
const cfgForm = document.getElementById("configForm");
function fillConfigForm(){
  document.getElementById("cfgNome").value = BUSINESS.name;
  document.getElementById("cfgSegmento").value = BUSINESS.segment;
  document.getElementById("cfgCor").value = BUSINESS.brand_color || "#C6E619";
  document.getElementById("cfgWhats").value = BUSINESS.whatsapp || "";
  document.getElementById("cfgSlug").value = BUSINESS.slug;
  updatePublicLink();
  renderSubStatus();
  const logoLiberado = planoAtual().logoPersonalizado;
  const logoInput = document.getElementById("cfgLogo");
  logoInput.disabled = !logoLiberado;
  document.getElementById("cfgLogoHint").textContent = logoLiberado ? "" : "Disponível no plano Pro.";
}

function renderSubStatus(){
  const badge = document.getElementById("subStatusBadge");
  const statusClassMap = { trial: "status-pendente", ativo: "status-pago", inadimplente: "status-cancelado", cancelado: "status-cancelado" };
  let texto = BUSINESS.subscription_status || "trial";
  if(BUSINESS.subscription_status === "trial" && !BUSINESS.subscription_plan && BUSINESS.trial_expires_at){
    const dias = Math.max(0, Math.ceil((new Date(BUSINESS.trial_expires_at) - new Date()) / 86400000));
    texto = `trial · ${dias} dia(s) restante(s)`;
  }
  badge.textContent = texto;
  badge.className = "status-badge " + (statusClassMap[BUSINESS.subscription_status] || "status-pendente");
}
document.getElementById("btnAssinarBasico").addEventListener("click", ()=> iniciarAssinatura("basico"));
document.getElementById("btnAssinarPro").addEventListener("click", ()=> iniciarAssinatura("pro"));
function updatePublicLink(){
  const url = `${window.location.origin}${window.location.pathname.replace("index.html","")}agendar.html?empresa=${BUSINESS.slug}`;
  document.getElementById("publicLinkText").textContent = url;
}
document.getElementById("copyLinkBtn").addEventListener("click", ()=>{
  navigator.clipboard.writeText(document.getElementById("publicLinkText").textContent);
  alert("Link copiado!");
});

cfgForm.addEventListener("submit", async e=>{
  e.preventDefault();
  const updates = {
    name: document.getElementById("cfgNome").value.trim() || "Meu Negócio",
    segment: document.getElementById("cfgSegmento").value,
    brand_color: document.getElementById("cfgCor").value,
    whatsapp: document.getElementById("cfgWhats").value.trim(),
    slug: document.getElementById("cfgSlug").value.trim().toLowerCase()
  };
  const file = document.getElementById("cfgLogo").files[0];
  if(file && !planoAtual().logoPersonalizado){
    alert("Logotipo personalizado é exclusivo do plano Pro. Faça upgrade na seção Assinatura.");
    return;
  }
  if(file){
    const path = `${BUSINESS.id}/${Date.now()}-${file.name}`;
    const { error: upErr } = await supabaseClient.storage.from("logos").upload(path, file, { upsert: true });
    if(upErr){ alert("Erro ao enviar logo: " + upErr.message); return; }
    const { data: pub } = supabaseClient.storage.from("logos").getPublicUrl(path);
    updates.logo_url = pub.publicUrl;
  }
  const { data, error } = await supabaseClient.from("businesses").update(updates).eq("id", BUSINESS.id).select().single();
  if(error){ alert("Erro ao salvar (verifique se o link/slug já não está em uso): " + error.message); return; }
  BUSINESS = data;
  applyBrand(); updatePublicLink();
  alert("Configurações salvas.");
});

/* ---------------- PROFISSIONAIS ---------------- */
document.getElementById("profForm").addEventListener("submit", async e=>{
  e.preventDefault();
  const limite = planoAtual().profissionais;
  if(PROFESSIONALS.length >= limite){
    alert(`Seu plano atual permite até ${limite} profissionais. Para cadastrar mais, faça upgrade em Configurações → Assinatura.`);
    return;
  }
  const name = document.getElementById("profNome").value.trim();
  const spec = document.getElementById("profEspecialidade").value.trim();
  const start_time = document.getElementById("profInicio").value;
  const end_time = document.getElementById("profFim").value;
  if(!name) return;
  const color = PALETTE[PROFESSIONALS.length % PALETTE.length];
  const { error } = await supabaseClient.from("professionals").insert({ business_id: BUSINESS.id, name, spec, start_time, end_time, color });
  if(error){ alert("Erro: " + error.message); return; }
  e.target.reset();
  document.getElementById("profInicio").value = "09:00";
  document.getElementById("profFim").value = "18:00";
  await loadAll(); refreshAll();
});

function renderProfList(){
  const el = document.getElementById("profList");
  const limite = planoAtual().profissionais;
  const contadorHtml = `<p class="hint">${PROFESSIONALS.length} de ${limite} profissionais usados no seu plano.</p>`;
  el.innerHTML = "";
  if(PROFESSIONALS.length===0){ el.innerHTML = contadorHtml + "<p class='hint'>Nenhum profissional cadastrado ainda.</p>"; return; }
  el.insertAdjacentHTML("beforeend", contadorHtml);
  PROFESSIONALS.forEach(p=>{
    const div = document.createElement("div");
    div.className = "list-item";
    div.innerHTML = `
      <span><span class="dot" style="background:${p.color};width:10px;height:10px;border-radius:50%;display:inline-block;margin-right:6px;"></span>
      <strong>${p.name}</strong> ${p.spec?("— "+p.spec):""} (${p.start}–${p.end})</span>
      <button class="btn-danger">Remover</button>`;
    div.querySelector("button").addEventListener("click", async ()=>{
      if(!confirm(`Remover ${p.name}? Isso também apaga os agendamentos dele(a).`)) return;
      await supabaseClient.from("professionals").delete().eq("id", p.id);
      await loadAll(); refreshAll();
    });
    el.appendChild(div);
  });
}

/* ---------------- SERVIÇOS ---------------- */
document.getElementById("servForm").addEventListener("submit", async e=>{
  e.preventDefault();
  const name = document.getElementById("servNome").value.trim();
  const price = parseFloat(document.getElementById("servPreco").value);
  const duration = parseInt(document.getElementById("servDuracao").value,10);
  if(!name || isNaN(price) || isNaN(duration)) return;
  const { error } = await supabaseClient.from("services").insert({ business_id: BUSINESS.id, name, price, duration });
  if(error){ alert("Erro: " + error.message); return; }
  e.target.reset();
  document.getElementById("servDuracao").value = 60;
  await loadAll(); refreshAll();
});

function renderServList(){
  const el = document.getElementById("servList");
  el.innerHTML = "";
  SERVICES.forEach(s=>{
    const div = document.createElement("div");
    div.className = "list-item";
    div.innerHTML = `<span><strong>${s.name}</strong> — ${brl(s.price)} · ${s.duration} min</span>
      <button class="btn-danger">Remover</button>`;
    div.querySelector("button").addEventListener("click", async ()=>{
      await supabaseClient.from("services").delete().eq("id", s.id);
      await loadAll(); refreshAll();
    });
    el.appendChild(div);
  });
}

/* ---------------- AGENDAMENTO (balcão / equipe) ---------------- */
const bkProfissional = document.getElementById("bkProfissional");
const bkServico = document.getElementById("bkServico");
const bkData = document.getElementById("bkData");
const bkHorario = document.getElementById("bkHorario");

function fillBookingSelects(){
  bkProfissional.innerHTML = PROFESSIONALS.map(p=>`<option value="${p.id}">${p.name}</option>`).join("") || "<option value=''>Cadastre um profissional primeiro</option>";
  bkServico.innerHTML = SERVICES.map(s=>`<option value="${s.id}">${s.name} — ${brl(s.price)}</option>`).join("");
}

function computeSlots(profId, dateStr, durationMin){
  const prof = PROFESSIONALS.find(p=>p.id===profId);
  if(!prof || !dateStr) return [];
  const [sh,sm] = prof.start.split(":").map(Number);
  const [eh,em] = prof.end.split(":").map(Number);
  const slots = [];
  let cursor = sh*60+sm;
  const end = eh*60+em;
  const step = 30;
  const taken = APPOINTMENTS.filter(a=>a.profId===profId && a.date===dateStr && a.status!=="cancelado")
    .map(a=>{ const [h,m]=a.time.split(":").map(Number); return { start: h*60+m, end: h*60+m+a.duration }; });
  while(cursor + durationMin <= end){
    const slotEnd = cursor + durationMin;
    const conflict = taken.some(t=> cursor < t.end && slotEnd > t.start );
    if(!conflict) slots.push(`${pad(Math.floor(cursor/60))}:${pad(cursor%60)}`);
    cursor += step;
  }
  return slots;
}

function refreshHorarios(){
  const profId = bkProfissional.value;
  const servId = bkServico.value;
  const dateStr = bkData.value;
  const serv = SERVICES.find(s=>s.id===servId);
  const slots = serv ? computeSlots(profId, dateStr, serv.duration) : [];
  bkHorario.innerHTML = slots.length ? slots.map(s=>`<option value="${s}">${s}</option>`).join("") : "<option value=''>Sem horários disponíveis</option>";
}
[bkProfissional, bkServico, bkData].forEach(el=> el && el.addEventListener("change", refreshHorarios));

document.getElementById("bookingForm").addEventListener("submit", async e=>{
  e.preventDefault();
  const profId = bkProfissional.value;
  const servId = bkServico.value;
  const date = bkData.value;
  const time = bkHorario.value;
  const clientName = document.getElementById("bkNome").value.trim();
  const clientPhone = document.getElementById("bkTelefone").value.trim().replace(/\D/g,"");
  const serv = SERVICES.find(s=>s.id===servId);
  const prof = PROFESSIONALS.find(p=>p.id===profId);
  if(!prof || !serv || !date || !time || !clientName || !clientPhone){ alert("Preencha todos os campos e escolha um horário disponível."); return; }

  const { error } = await supabaseClient.from("appointments").insert({
    business_id: BUSINESS.id, professional_id: profId, service_id: servId,
    client_name: clientName, client_phone: clientPhone,
    date, time, duration: serv.duration, price: serv.price, status: "pendente"
  });
  if(error){ alert("Erro ao criar agendamento: " + error.message); return; }

  const resultEl = document.getElementById("bookingResult");
  const paymentMsg = `Olá ${clientName}! Seu agendamento de *${serv.name}* com ${prof.name} em ${formatDateBR(date)} às ${time} foi criado. Valor: ${brl(serv.price)}. Para confirmar, realize o pagamento.`;
  const payLink = `https://wa.me/55${clientPhone}?text=${encodeURIComponent(paymentMsg)}`;
  resultEl.innerHTML = `<div class="appointment-item">
      <span>Agendamento criado para <strong>${clientName}</strong> — ${serv.name} com ${prof.name}, ${formatDateBR(date)} às ${time}.</span>
      <div><a class="btn-whats" href="${payLink}" target="_blank" rel="noopener">Enviar link/lembrete via WhatsApp</a></div>
    </div>`;

  if(BUSINESS.whatsapp){
    const ownerMsg = `Novo agendamento: ${clientName} marcou ${serv.name} com ${prof.name} em ${formatDateBR(date)} às ${time}.`;
    window.open(`https://wa.me/${BUSINESS.whatsapp.replace(/\D/g,"")}?text=${encodeURIComponent(ownerMsg)}`, "_blank");
  }

  document.getElementById("bookingForm").reset();
  await loadAll(); refreshAll();
});

/* ---------------- CALENDARIOS ---------------- */
let calGeralCursor = new Date();
let calProfCursor = new Date();
let calGeralSelected = null;
let calProfSelected = null;
const MONTHS_PT = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const WEEK_PT = ["D","S","T","Q","Q","S","S"];

function buildCalendar(cursor, gridEl, labelEl, selected, onSelectDay, filterProfId){
  labelEl.textContent = `${MONTHS_PT[cursor.getMonth()]} ${cursor.getFullYear()}`;
  gridEl.innerHTML = "";
  WEEK_PT.forEach(w=>{ const d=document.createElement("div"); d.className="cal-daylabel"; d.textContent=w; gridEl.appendChild(d); });
  const firstDay = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth()+1, 0).getDate();
  for(let i=0;i<startOffset;i++){ const empty=document.createElement("div"); empty.className="cal-day empty"; gridEl.appendChild(empty); }
  for(let day=1; day<=daysInMonth; day++){
    const dateObj = new Date(cursor.getFullYear(), cursor.getMonth(), day);
    const key = dateKey(dateObj);
    const cell = document.createElement("div");
    cell.className = "cal-day" + (key===selected ? " selected" : "");
    const dayAppts = APPOINTMENTS.filter(a=> a.date===key && a.status!=="cancelado" && (!filterProfId || a.profId===filterProfId));
    const dotsHtml = dayAppts.slice(0,6).map(a=>{ const p = PROFESSIONALS.find(pr=>pr.id===a.profId); return `<span style="background:${p?p.color:'#999'}"></span>`; }).join("");
    cell.innerHTML = `<span class="cal-daynum">${day}</span><div class="cal-dots">${dotsHtml}</div>`;
    cell.addEventListener("click", ()=> onSelectDay(key));
    gridEl.appendChild(cell);
  }
}

function renderDayList(key, listEl, filterProfId){
  listEl.innerHTML = "";
  if(!key){ listEl.innerHTML = "<p class='hint'>Clique em um dia para ver os agendamentos.</p>"; return; }
  const appts = APPOINTMENTS.filter(a=> a.date===key && (!filterProfId || a.profId===filterProfId)).sort((a,b)=> a.time.localeCompare(b.time));
  if(appts.length===0){ listEl.innerHTML = `<p class='hint'>Sem agendamentos em ${formatDateBR(key)}.</p>`; return; }
  appts.forEach(a=> listEl.appendChild(renderApptItem(a)));
}

function renderApptItem(a){
  const prof = PROFESSIONALS.find(p=>p.id===a.profId) || {name:"—",color:"#999"};
  const serv = SERVICES.find(s=>s.id===a.servId) || {name:"—", price:0};
  const div = document.createElement("div");
  div.className = "appointment-item";
  div.innerHTML = `
    <span><span class="dot" style="background:${prof.color}"></span>
      <strong>${a.time}</strong> — ${a.clientName} · ${serv.name} · ${prof.name} · ${brl(a.price)}
      <span class="status-badge status-${a.status}">${a.status}</span>
    </span>
    <span class="row-actions"></span>`;
  const actions = div.querySelector(".row-actions");
  if(a.status==="pendente"){
    const payBtn = document.createElement("button");
    payBtn.className = "btn-secondary"; payBtn.textContent = "Marcar como pago";
    payBtn.addEventListener("click", async ()=>{ await supabaseClient.from("appointments").update({status:"pago"}).eq("id", a.id); await loadAll(); refreshAll(); });
    actions.appendChild(payBtn);
  }
  const remindBtn = document.createElement("a");
  remindBtn.className = "btn-whats"; remindBtn.target = "_blank"; remindBtn.rel = "noopener";
  const msg = `Olá ${a.clientName}! Lembrete do seu horário de ${serv.name} com ${prof.name} em ${formatDateBR(a.date)} às ${a.time}.`;
  remindBtn.href = `https://wa.me/55${a.clientPhone}?text=${encodeURIComponent(msg)}`;
  remindBtn.textContent = "Lembrete WhatsApp";
  actions.appendChild(remindBtn);
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn-danger"; cancelBtn.textContent = "Cancelar";
  cancelBtn.addEventListener("click", async ()=>{ if(confirm("Cancelar este agendamento?")){ await supabaseClient.from("appointments").update({status:"cancelado"}).eq("id", a.id); await loadAll(); refreshAll(); } });
  actions.appendChild(cancelBtn);
  return div;
}

document.getElementById("calGeralPrev").addEventListener("click", ()=>{ calGeralCursor.setMonth(calGeralCursor.getMonth()-1); renderCalGeral(); });
document.getElementById("calGeralNext").addEventListener("click", ()=>{ calGeralCursor.setMonth(calGeralCursor.getMonth()+1); renderCalGeral(); });
document.getElementById("calProfPrev").addEventListener("click", ()=>{ calProfCursor.setMonth(calProfCursor.getMonth()-1); renderCalProf(); });
document.getElementById("calProfNext").addEventListener("click", ()=>{ calProfCursor.setMonth(calProfCursor.getMonth()+1); renderCalProf(); });

function renderCalGeral(){
  buildCalendar(calGeralCursor, document.getElementById("calGeralGrid"), document.getElementById("calGeralLabel"), calGeralSelected, (key)=>{ calGeralSelected = key; renderCalGeral(); }, null);
  renderDayList(calGeralSelected, document.getElementById("calGeralDayList"), null);
}

const calProfSelect = document.getElementById("calProfSelect");
function fillCalProfSelect(){
  calProfSelect.innerHTML = PROFESSIONALS.map(p=>`<option value="${p.id}">${p.name}</option>`).join("") || "<option value=''>Cadastre um profissional</option>";
}
calProfSelect.addEventListener("change", renderCalProf);

function renderCalProf(){
  const profId = calProfSelect.value;
  buildCalendar(calProfCursor, document.getElementById("calProfGrid"), document.getElementById("calProfLabel"), calProfSelected, (key)=>{ calProfSelected = key; renderCalProf(); }, profId);
  renderDayList(calProfSelected, document.getElementById("calProfDayList"), profId);
}

/* ---------------- DASHBOARD ---------------- */
function renderDashboard(){
  const today = dateKey(new Date());
  const todays = APPOINTMENTS.filter(a=>a.date===today && a.status!=="cancelado");
  document.getElementById("statHoje").textContent = todays.length;
  const pendentes = APPOINTMENTS.filter(a=>a.status==="pendente");
  const aReceber = pendentes.reduce((s,a)=>s+Number(a.price||0),0);
  const recebido = APPOINTMENTS.filter(a=>a.status==="pago").reduce((s,a)=>s+Number(a.price||0),0);
  document.getElementById("statAReceber").textContent = brl(aReceber);
  document.getElementById("statRecebido").textContent = brl(recebido);
  document.getElementById("statProfissionais").textContent = PROFESSIONALS.length;

  const badge = document.getElementById("badgeRelatorios");
  badge.textContent = pendentes.length;
  badge.classList.toggle("hidden", pendentes.length === 0);

  const proximosEl = document.getElementById("proximosList");
  proximosEl.innerHTML = "";
  const upcoming = APPOINTMENTS.filter(a=> a.status!=="cancelado" && a.date >= today).sort((a,b)=> (a.date+a.time).localeCompare(b.date+b.time)).slice(0,8);
  if(upcoming.length===0){ proximosEl.innerHTML = "<p class='hint'>Nenhum agendamento futuro.</p>"; return; }
  upcoming.forEach(a=> proximosEl.appendChild(renderApptItem(a)));
}

/* ---------------- RELATORIOS ---------------- */
document.getElementById("filtroStatus").addEventListener("change", renderRelatorio);
function renderRelatorio(){
  const liberado = planoAtual().relatorioCompleto;
  document.getElementById("relatorioLocked").classList.toggle("hidden", liberado);
  document.getElementById("relatorioContent").classList.toggle("hidden", !liberado);
  if(!liberado) return;
  const filtro = document.getElementById("filtroStatus").value;
  const body = document.getElementById("reportBody");
  body.innerHTML = "";
  const list = APPOINTMENTS.filter(a=> filtro==="todos" || a.status===filtro).sort((a,b)=> (b.date+b.time).localeCompare(a.date+a.time));
  list.forEach(a=>{
    const prof = PROFESSIONALS.find(p=>p.id===a.profId) || {name:"—"};
    const serv = SERVICES.find(s=>s.id===a.servId) || {name:"—"};
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${formatDateBR(a.date)}</td><td>${a.time}</td><td>${a.clientName}</td><td>${prof.name}</td><td>${serv.name}</td><td>${brl(a.price)}</td><td><span class="status-badge status-${a.status}">${a.status}</span></td><td></td>`;
    const actionsTd = tr.lastElementChild;
    if(a.status==="pendente"){
      const b = document.createElement("button");
      b.className="btn-secondary"; b.textContent="Marcar pago";
      b.addEventListener("click", async ()=>{ await supabaseClient.from("appointments").update({status:"pago"}).eq("id", a.id); await loadAll(); refreshAll(); });
      actionsTd.appendChild(b);
    }
    body.appendChild(tr);
  });
  const totalPendente = APPOINTMENTS.filter(a=>a.status==="pendente").reduce((s,a)=>s+Number(a.price||0),0);
  const totalPago = APPOINTMENTS.filter(a=>a.status==="pago").reduce((s,a)=>s+Number(a.price||0),0);
  document.getElementById("repTotalPendente").textContent = brl(totalPendente);
  document.getElementById("repTotalPago").textContent = brl(totalPago);
}

/* ---------------- REFRESH ALL ---------------- */
function refreshAll(){
  applyBrand();
  renderProfList();
  renderServList();
  fillBookingSelects();
  fillCalProfSelect();
  refreshHorarios();
  renderDashboard();
  renderCalGeral();
  renderCalProf();
  renderRelatorio();
  updatePublicLink();
}

/* ---------------- INIT ---------------- */
bkData.min = dateKey(new Date());
boot();
