/* ===========================================================
   Página pública de agendamento — sem login.
   Acesso via agendar.html?empresa=<slug-do-negocio>
   =========================================================== */

let BUSINESS = null;
let PROFESSIONALS = [];
let SERVICES = [];

function brl(v){ return "R$ " + Number(v||0).toLocaleString("pt-BR",{minimumFractionDigits:2, maximumFractionDigits:2}); }
function pad(n){ return String(n).padStart(2,"0"); }
function dateKey(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function formatDateBR(dateStr){ const [y,m,d] = dateStr.split("-"); return `${d}/${m}/${y}`; }
function timeShort(t){ return t ? t.slice(0,5) : t; }
function contrastInk(hex){
  const num = parseInt(hex.slice(1),16);
  const r=(num>>16)&255, g=(num>>8)&255, b=num&255;
  const brightness = (r*299 + g*587 + b*114) / 1000;
  return brightness > 150 ? "#101010" : "#F5F5EF";
}

const bkProfissional = document.getElementById("bkProfissional");
const bkServico = document.getElementById("bkServico");
const bkData = document.getElementById("bkData");
const bkHorario = document.getElementById("bkHorario");

async function boot(){
  const slug = new URLSearchParams(window.location.search).get("empresa");
  if(!slug){ document.getElementById("notFound").classList.remove("hidden"); document.getElementById("bookingForm").classList.add("hidden"); return; }

  const { data: biz } = await supabaseClient.from("businesses").select("*").eq("slug", slug).maybeSingle();
  if(!biz){ document.getElementById("notFound").classList.remove("hidden"); document.getElementById("bookingForm").classList.add("hidden"); return; }
  BUSINESS = biz;

  const color = BUSINESS.brand_color || "#C6E619";
  document.documentElement.style.setProperty("--lime", color);
  document.documentElement.style.setProperty("--lime-ink", contrastInk(color));
  document.getElementById("brandName").textContent = BUSINESS.name;
  if(BUSINESS.logo_url){ const logo = document.getElementById("brandLogo"); logo.src = BUSINESS.logo_url; logo.classList.remove("hidden"); }

  const [{ data: profs }, { data: servs }] = await Promise.all([
    supabaseClient.from("professionals").select("*").eq("business_id", BUSINESS.id).order("created_at"),
    supabaseClient.from("services").select("*").eq("business_id", BUSINESS.id).order("created_at")
  ]);
  PROFESSIONALS = (profs||[]).map(p=>({ ...p, start: timeShort(p.start_time), end: timeShort(p.end_time) }));
  SERVICES = servs || [];

  bkProfissional.innerHTML = PROFESSIONALS.map(p=>`<option value="${p.id}">${p.name}${p.spec?(" — "+p.spec):""}</option>`).join("") || "<option value=''>Nenhum profissional disponível</option>";
  bkServico.innerHTML = SERVICES.map(s=>`<option value="${s.id}">${s.name} — ${brl(s.price)}</option>`).join("");
  bkData.min = dateKey(new Date());
  await refreshHorarios();
}

async function computeSlots(profId, dateStr, durationMin){
  const prof = PROFESSIONALS.find(p=>p.id===profId);
  if(!prof || !dateStr) return [];
  const { data: busy } = await supabaseClient.rpc("get_busy_slots", { p_business_id: BUSINESS.id, p_professional_id: profId, p_date: dateStr });
  const taken = (busy||[]).map(b=>{ const [h,m] = timeShort(b.slot_time).split(":").map(Number); return { start: h*60+m, end: h*60+m+b.slot_duration }; });
  const [sh,sm] = prof.start.split(":").map(Number);
  const [eh,em] = prof.end.split(":").map(Number);
  const slots = [];
  let cursor = sh*60+sm;
  const end = eh*60+em;
  while(cursor + durationMin <= end){
    const slotEnd = cursor + durationMin;
    const conflict = taken.some(t=> cursor < t.end && slotEnd > t.start);
    if(!conflict) slots.push(`${pad(Math.floor(cursor/60))}:${pad(cursor%60)}`);
    cursor += 30;
  }
  return slots;
}

async function refreshHorarios(){
  const profId = bkProfissional.value;
  const servId = bkServico.value;
  const dateStr = bkData.value;
  const serv = SERVICES.find(s=>s.id===servId);
  if(!profId || !serv || !dateStr){ bkHorario.innerHTML = "<option value=''>Escolha profissional, serviço e data</option>"; return; }
  const slots = await computeSlots(profId, dateStr, serv.duration);
  bkHorario.innerHTML = slots.length ? slots.map(s=>`<option value="${s}">${s}</option>`).join("") : "<option value=''>Sem horários disponíveis nesse dia</option>";
}
[bkProfissional, bkServico, bkData].forEach(el=> el.addEventListener("change", refreshHorarios));

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
  if(error){ alert("Não foi possível agendar (o horário pode ter sido ocupado agora mesmo). Tente outro horário."); await refreshHorarios(); return; }

  const resultEl = document.getElementById("bookingResult");
  const msg = `Olá! Meu agendamento de ${serv.name} com ${prof.name} em ${formatDateBR(date)} às ${time} foi confirmado. Valor: ${brl(serv.price)}.`;
  const link = BUSINESS.whatsapp ? `https://wa.me/${BUSINESS.whatsapp.replace(/\D/g,"")}?text=${encodeURIComponent(msg)}` : null;
  resultEl.innerHTML = `<div class="appointment-item">
      <span>Agendamento confirmado, ${clientName}! ${serv.name} com ${prof.name}, ${formatDateBR(date)} às ${time}. Valor: ${brl(serv.price)}.</span>
    </div>`;
  if(link){
    const btn = document.createElement("a");
    btn.className = "btn-whats"; btn.target = "_blank"; btn.rel = "noopener"; btn.href = link;
    btn.textContent = "Falar com o negócio no WhatsApp para pagar/confirmar";
    resultEl.appendChild(btn);
  }
  document.getElementById("bookingForm").reset();
  document.getElementById("bookingForm").classList.add("hidden");
});

boot();
