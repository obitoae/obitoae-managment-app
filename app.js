import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, PRIVACY_PASSWORD } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const money = (n) =>
  "$" + (Number(n) || 0).toLocaleString("es-MX", { maximumFractionDigits: 0 });

const todayISO = () => new Date().toISOString().slice(0, 10);
const currentPeriodKey = () => new Date().toISOString().slice(0, 7); // "YYYY-MM"

// ============================================================
// CALENDARIO: descarga de eventos .ics (Google Calendar, Apple
// Calendar, Outlook, etc. — todos abren este formato estándar)
// ============================================================
function icsEscape(text) {
  return String(text || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function downloadICS(filename, events) {
  const dtstamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Obitoae Management//ES", "CALSCALE:GREGORIAN"];
  events.forEach((ev, i) => {
    const dt = ev.date.replace(/-/g, "");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${dt}-${i}-${Math.random().toString(36).slice(2)}@obitoae-management`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${dt}`,
      `SUMMARY:${icsEscape(ev.title)}`
    );
    if (ev.description) lines.push(`DESCRIPTION:${icsEscape(ev.description)}`);
    lines.push("END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Regla de pago de tarjeta: el pago del corte que cierra el día 26 de un mes
// vence el día 5 del mes siguiente.
function fechaPagoCorte(periodKey) {
  const [y, m] = periodKey.split("-").map(Number);
  let payYear = y;
  let payMonth = m + 1;
  if (payMonth > 12) {
    payMonth = 1;
    payYear += 1;
  }
  return `${payYear}-${String(payMonth).padStart(2, "0")}-05`;
}

function fechaCorteCierre(periodKey) {
  const [y, m] = periodKey.split("-").map(Number);
  return `${y}-${String(m).padStart(2, "0")}-26`;
}

const MESES_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
function formatMes(mesKey) {
  const [anio, mes] = mesKey.split("-");
  return `${MESES_ES[parseInt(mes, 10) - 1]} ${anio}`;
}

const DIAS_ES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

function saludoSegunHora() {
  const h = new Date().getHours();
  if (h < 12) return "Buenos días";
  if (h < 19) return "Buenas tardes";
  return "Buenas noches";
}

function fechaLargaHoy() {
  const d = new Date();
  return `${DIAS_ES[d.getDay()]}, ${d.getDate()} de ${MESES_ES[d.getMonth()]} de ${d.getFullYear()}`;
}

// Próxima fecha (YYYY-MM-DD) en la que cae un día fijo del mes (ej. día 26),
// contando desde hoy — si ya pasó este mes, salta al mes siguiente.
function proximaFechaDelMes(diaDelMes) {
  const hoy = todayISO();
  const [y, m] = hoy.split("-").map(Number);
  const candidato = `${y}-${String(m).padStart(2, "0")}-${String(diaDelMes).padStart(2, "0")}`;
  if (candidato >= hoy) return candidato;
  let ny = y;
  let nm = m + 1;
  if (nm > 12) {
    nm = 1;
    ny += 1;
  }
  return `${ny}-${String(nm).padStart(2, "0")}-${String(diaDelMes).padStart(2, "0")}`;
}

function diasEntreHoyY(fechaISO) {
  const hoy = new Date(todayISO() + "T00:00:00");
  const futura = new Date(fechaISO + "T00:00:00");
  return Math.round((futura - hoy) / 86400000);
}

function fechaCortaES(fechaISO) {
  const [y, m, d] = fechaISO.split("-").map(Number);
  return `${d} de ${MESES_ES[m - 1]}`;
}

// ---- Cortes de tarjeta de crédito (cierran el día 26 de cada mes) ----
function cortePeriodKey(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  let year = y;
  let month = m; // 1-12
  if (d > 26) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return `${year}-${String(month).padStart(2, "0")}`;
}

function currentCorteKey() {
  return cortePeriodKey(todayISO());
}

function corteRangeLabel(periodKey) {
  const [y, m] = periodKey.split("-").map(Number);
  let prevMonth = m - 1;
  let prevYear = y;
  if (prevMonth < 1) {
    prevMonth = 12;
    prevYear -= 1;
  }
  return `Corte del 27 de ${MESES_ES[prevMonth - 1]} al 26 de ${MESES_ES[m - 1]} ${y}`;
}

let state = { clients: [], income: [], expenses: [], tasks: [], savingsFunds: [], savingsMoves: [], creditPayments: [] };

// ============================================================
// AUTH
// ============================================================
const loginScreen = document.getElementById("login-screen");
const coverScreen = document.getElementById("cover-screen");
const appEl = document.getElementById("app");

async function checkSession() {
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    showApp();
  } else {
    showLogin();
  }
}

function showLogin() {
  loginScreen.hidden = false;
  coverScreen.hidden = true;
  appEl.hidden = true;
}

// Portada: se muestra siempre después de entrar, antes de la app. Los datos
// se cargan de fondo mientras el usuario la ve, así que al tocar "Ingresar"
// todo ya está listo.
async function showApp() {
  loginScreen.hidden = true;
  appEl.hidden = true;
  coverScreen.hidden = false;
  document.getElementById("cover-fecha").textContent = fechaLargaHoy();
  await loadAll();
  renderAll();
}

document.getElementById("btn-cover-ingresar").addEventListener("click", () => {
  coverScreen.hidden = true;
  appEl.hidden = false;
});

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const errEl = document.getElementById("login-error");
  errEl.hidden = true;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    errEl.textContent = "No pudimos entrar: " + error.message;
    errEl.hidden = false;
    return;
  }
  await showApp();
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  await supabase.auth.signOut();
  showLogin();
});

// ============================================================
// NAVEGACIÓN
// ============================================================
function switchView(viewName) {
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === viewName));
  document.querySelectorAll(".view").forEach((v) => (v.hidden = true));
  const target = document.getElementById("view-" + viewName);
  if (target) target.hidden = false;
  // si el botón vive dentro de una carpeta (nav-group), la expandimos para que se vea activa
  const activeBtn = document.querySelector(`.nav-item[data-view="${viewName}"]`);
  const group = activeBtn && activeBtn.closest(".nav-group");
  if (group) group.classList.remove("collapsed");
}

document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

document.querySelectorAll(".nav-group-header").forEach((header) => {
  header.addEventListener("click", () => {
    header.closest(".nav-group").classList.toggle("collapsed");
  });
});

// ============================================================
// CARGA DE DATOS
// ============================================================
let loadErrorShown = false;

function loadAllQueries() {
  return [
    supabase.from("clients").select("*").order("name"),
    supabase.from("income").select("*").order("date", { ascending: false }),
    supabase.from("expenses").select("*").order("date", { ascending: false }),
    supabase.from("tasks").select("*").order("due_date", { ascending: true, nullsFirst: false }),
    supabase.from("savings_funds").select("*").order("name"),
    supabase.from("savings_moves").select("*").order("date", { ascending: false }),
    supabase.from("credit_payments").select("*").order("date", { ascending: false }),
  ];
}

async function loadAll() {
  const tableNames = ["clients", "income", "expenses", "tasks", "savings_funds", "savings_moves", "credit_payments"];
  let results = await Promise.all(loadAllQueries());

  // Reintento automático: errores intermitentes (p. ej. "JWT issued at future" cuando
  // el token de sesión se refresca de fondo) casi siempre desaparecen solos medio
  // segundo después, así que reintentamos SOLO las tablas que fallaron antes de
  // molestar al usuario con la alerta.
  const fallidasIdx = results.map((r, i) => (r.error ? i : -1)).filter((i) => i !== -1);
  if (fallidasIdx.length) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    const retryQueries = loadAllQueries();
    const retryResults = await Promise.all(fallidasIdx.map((i) => retryQueries[i]));
    fallidasIdx.forEach((i, j) => {
      results[i] = retryResults[j];
    });
  }

  const fallidas = [];
  results.forEach(({ error }, i) => {
    if (error) fallidas.push(`${tableNames[i]}: ${error.message}`);
  });
  if (fallidas.length && !loadErrorShown) {
    loadErrorShown = true;
    alert(
      "No se pudo cargar información de estas tablas:\n\n" +
        fallidas.join("\n") +
        "\n\nCasi siempre significa que falta correr el SQL de esa parte en Supabase (archivo schema.sql, SQL Editor). El resto de la app sigue funcionando."
    );
  }
  const [{ data: clients }, { data: income }, { data: expenses }, { data: tasks }, { data: savingsFunds }, { data: savingsMoves }, { data: creditPayments }] = results;
  state.clients = clients || [];
  state.income = income || [];
  state.expenses = expenses || [];
  state.tasks = tasks || [];
  state.savingsFunds = savingsFunds || [];
  state.savingsMoves = savingsMoves || [];
  state.creditPayments = creditPayments || [];
}

function clientName(id) {
  const c = state.clients.find((c) => c.id === id);
  return c ? c.name : "—";
}

// ---- Guardar con manejo de errores: si Supabase rechaza el insert/update
// (por ejemplo porque falta correr el SQL de esa tabla), avisa en vez de
// fallar en silencio. Regresa true si se guardó bien, false si no. ----
async function saveRow(table, id, row) {
  const { error } = id
    ? await supabase.from(table).update(row).eq("id", id)
    : await supabase.from(table).insert(row);
  if (error) {
    alert(
      `No se pudo guardar (tabla "${table}"): ${error.message}\n\n` +
        `Esto casi siempre pasa porque falta correr el SQL de esa parte en Supabase (SQL Editor). Revisa el archivo schema.sql.`
    );
    return false;
  }
  return true;
}

function renderAll() {
  renderClientSelects();
  renderClientesView();
  renderTareasView();
  renderTareasHistoricoView();
  renderIngresosView();
  renderGastosView();
  renderCreditoView();
  renderAhorroView();
  renderHistoricoDetalle();
  renderDashboard();
  renderInicioView();
}

// ============================================================
// INICIO / BIENVENIDA
// ============================================================
function renderInicioView() {
  document.getElementById("inicio-saludo").textContent = `${saludoSegunHora()}, Eduardo`;
  document.getElementById("inicio-fecha").textContent = fechaLargaHoy();

  const hoy = todayISO();

  const pendientes = state.tasks.filter((t) => t.status !== "Hecho" && t.due_date);
  const vencidas = pendientes.filter((t) => t.due_date < hoy).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const limite7 = new Date(hoy + "T00:00:00");
  limite7.setDate(limite7.getDate() + 7);
  const limite7ISO = limite7.toISOString().slice(0, 10);
  const proximas = pendientes
    .filter((t) => t.due_date >= hoy && t.due_date <= limite7ISO)
    .sort((a, b) => a.due_date.localeCompare(b.due_date));

  const alertasHTML = [];

  if (vencidas.length) {
    alertasHTML.push(`
      <div class="alert-box">
        <div class="inicio-alert-title">⚠️ Tienes ${vencidas.length} tarea${vencidas.length > 1 ? "s" : ""} vencida${vencidas.length > 1 ? "s" : ""}</div>
        <div class="inicio-alert-list">
          ${vencidas
            .slice(0, 6)
            .map((t) => `<div class="inicio-alert-item"><span>${t.title}</span><span class="item-fecha">${fechaCortaES(t.due_date)}</span></div>`)
            .join("")}
        </div>
      </div>`);
  }

  if (proximas.length) {
    alertasHTML.push(`
      <div class="alert-box alert-warn">
        <div class="inicio-alert-title">🔔 ${proximas.length} tarea${proximas.length > 1 ? "s" : ""} por vencer esta semana</div>
        <div class="inicio-alert-list">
          ${proximas
            .slice(0, 6)
            .map((t) => `<div class="inicio-alert-item"><span>${t.title}</span><span class="item-fecha">${fechaCortaES(t.due_date)}</span></div>`)
            .join("")}
        </div>
      </div>`);
  }

  if (!vencidas.length && !proximas.length) {
    alertasHTML.push(`
      <div class="alert-box alert-ok">
        <div class="inicio-alert-title">🎉 Vas al día — sin tareas vencidas ni por vencer esta semana.</div>
      </div>`);
  }

  document.getElementById("inicio-alertas").innerHTML = alertasHTML.join("");

  // ---- Tarjeta de crédito: próximos corte y pago ----
  const proximoCorte = proximaFechaDelMes(26);
  const proximoPago = proximaFechaDelMes(5);
  const diasCorte = diasEntreHoyY(proximoCorte);
  const diasPago = diasEntreHoyY(proximoPago);
  const actual = currentCorteKey();
  const saldoActual = totalCorte(actual) - pagadoCorte(actual);

  document.getElementById("inicio-credito").innerHTML = `
    <div class="stat-row"><span>Próximo corte</span><span class="amount">${fechaCortaES(proximoCorte)} (en ${diasCorte} día${diasCorte === 1 ? "" : "s"})</span></div>
    <div class="stat-row"><span>Próximo pago</span><span class="amount ${diasPago <= 3 ? "negative" : ""}">${fechaCortaES(proximoPago)} (en ${diasPago} día${diasPago === 1 ? "" : "s"})</span></div>
    <div class="stat-row"><span>Saldo actual del corte</span><span class="amount ing-amount">${money(saldoActual)}</span></div>
  `;

  // ---- Resumen rápido ----
  const periodo = currentPeriodKey();
  const ingresosMes = state.income.filter((i) => i.date && i.date.slice(0, 7) === periodo).reduce((s, i) => s + Number(i.amount || 0), 0);
  const gastosMes = state.expenses.filter((g) => g.date && g.date.slice(0, 7) === periodo).reduce((s, g) => s + Number(g.amount || 0), 0);
  const ahorroTotal = state.savingsFunds.reduce((s, f) => s + fondoAcumulado(f.id), 0);

  document.getElementById("inicio-resumen").innerHTML = `
    <div class="stat-row"><span>Tareas pendientes</span><span class="amount">${pendientes.length}</span></div>
    <div class="stat-row"><span>Ingresos del mes</span><span class="amount positive ing-amount">${money(ingresosMes)}</span></div>
    <div class="stat-row"><span>Gastos del mes</span><span class="amount negative ing-amount">${money(gastosMes)}</span></div>
    <div class="stat-row"><span>Utilidad del mes</span><span class="amount ing-amount">${money(ingresosMes - gastosMes)}</span></div>
    <div class="stat-row"><span>Ahorro total</span><span class="amount ing-amount">${money(ahorroTotal)}</span></div>
  `;
}

// ============================================================
// CLIENTES
// ============================================================
function renderClientSelects() {
  const opts = state.clients.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
  document.getElementById("ingreso-cliente").innerHTML = opts;
  document.getElementById("gasto-cliente").innerHTML =
    `<option value="">— Ninguno —</option>` + opts;
  document.getElementById("tarea-cliente").innerHTML =
    `<option value="">— Ninguno —</option>` + opts;
}

function renderClientesView() {
  const tbody = document.getElementById("tabla-clientes");
  tbody.innerHTML = state.clients
    .map(
      (c) => `
    <tr>
      <td>${c.name}</td>
      <td>${c.notes || ""}</td>
      <td>${c.active ? "Sí" : "No"}</td>
      <td>
        <button class="btn-edit" data-id="${c.id}" data-kind="clients">Editar</button>
        <button class="btn-delete" data-id="${c.id}" data-kind="clients">Eliminar</button>
      </td>
    </tr>`
    )
    .join("");
}

function resetClienteForm() {
  document.getElementById("form-cliente").reset();
  document.getElementById("cliente-id").value = "";
  document.getElementById("cliente-submit-btn").textContent = "Agregar";
  document.getElementById("cliente-cancel-btn").hidden = true;
}

document.getElementById("form-cliente").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("cliente-id").value;
  const name = document.getElementById("cliente-nombre").value.trim();
  const notes = document.getElementById("cliente-notas").value.trim();
  if (!name) return;
  const ok = await saveRow("clients", id, { name, notes });
  if (!ok) return;
  resetClienteForm();
  await loadAll();
  renderAll();
});

document.getElementById("cliente-cancel-btn").addEventListener("click", resetClienteForm);

// ============================================================
// TAREAS
// ============================================================
function fechaTareaHTML(t) {
  if (!t.due_date) return "—";
  const vencida = t.status !== "Hecho" && t.due_date < todayISO();
  return vencida ? `<span class="due-overdue">${t.due_date}</span>` : t.due_date;
}

function sortByDue(a, b) {
  if (!a.due_date && !b.due_date) return 0;
  if (!a.due_date) return 1;
  if (!b.due_date) return -1;
  return a.due_date.localeCompare(b.due_date);
}

function tareaCardHTML(t) {
  const moveButtons = [];
  if (t.status === "Pendiente") {
    moveButtons.push(`<button class="kanban-move-btn" data-id="${t.id}" data-to="En curso">→ En curso</button>`);
  } else if (t.status === "En curso") {
    moveButtons.push(`<button class="kanban-move-btn" data-id="${t.id}" data-to="Pendiente">← Pendiente</button>`);
    moveButtons.push(`<button class="kanban-move-btn" data-id="${t.id}" data-to="Hecho">→ Hecho</button>`);
  } else if (t.status === "Hecho") {
    moveButtons.push(`<button class="kanban-move-btn" data-id="${t.id}" data-to="En curso">← Reabrir</button>`);
  }
  return `
    <div class="kanban-card">
      <div class="kanban-card-title">${t.title}</div>
      <div class="kanban-card-meta">
        <span class="priority-tag ${t.priority}">${t.priority}</span>
        <span>${t.category}</span>
        ${t.client_id ? `<span>${clientName(t.client_id)}</span>` : ""}
        ${t.due_date ? `<span>${fechaTareaHTML(t)}</span>` : ""}
      </div>
      <div class="kanban-card-actions">
        ${moveButtons.join("")}
        ${t.due_date && t.status !== "Hecho" ? `<button class="btn-calendar" data-id="${t.id}" data-kind="task">📅 Calendario</button>` : ""}
        <button class="btn-edit" data-id="${t.id}" data-kind="tasks">Editar</button>
        <button class="btn-delete" data-id="${t.id}" data-kind="tasks">Eliminar</button>
      </div>
    </div>`;
}

function renderTareasView() {
  const porEstado = { Pendiente: [], "En curso": [], Hecho: [] };
  state.tasks.forEach((t) => {
    if (porEstado[t.status]) porEstado[t.status].push(t);
  });

  porEstado["Pendiente"].sort(sortByDue);
  porEstado["En curso"].sort(sortByDue);
  const hechoOrdenado = porEstado["Hecho"]
    .slice()
    .sort((a, b) => (b.due_date || "").localeCompare(a.due_date || ""))
    .slice(0, 15);

  document.getElementById("count-pendiente").textContent = porEstado["Pendiente"].length;
  document.getElementById("count-encurso").textContent = porEstado["En curso"].length;
  document.getElementById("count-hecho").textContent = porEstado["Hecho"].length;

  document.getElementById("kanban-pendiente").innerHTML =
    porEstado["Pendiente"].map(tareaCardHTML).join("") || `<p class="muted">Sin tareas aquí. 🎉</p>`;
  document.getElementById("kanban-encurso").innerHTML =
    porEstado["En curso"].map(tareaCardHTML).join("") || `<p class="muted">Sin tareas aquí.</p>`;
  document.getElementById("kanban-hecho").innerHTML =
    hechoOrdenado.map(tareaCardHTML).join("") || `<p class="muted">Sin tareas aquí todavía.</p>`;
}

function renderTareasHistoricoView() {
  const hechas = state.tasks
    .filter((t) => t.status === "Hecho")
    .slice()
    .sort((a, b) => (b.due_date || "").localeCompare(a.due_date || ""));
  document.getElementById("tabla-tareas-historico").innerHTML =
    hechas
      .map(
        (t) => `
    <tr>
      <td>${t.title}</td>
      <td>${t.category}</td>
      <td>${t.client_id ? clientName(t.client_id) : "—"}</td>
      <td><span class="priority-tag ${t.priority}">${t.priority}</span></td>
      <td>${t.due_date || "—"}</td>
      <td>
        <button class="btn-edit" data-id="${t.id}" data-kind="tasks">Editar</button>
        <button class="btn-delete" data-id="${t.id}" data-kind="tasks">Eliminar</button>
      </td>
    </tr>`
      )
      .join("") || `<tr><td colspan="6" class="muted">Todavía no tienes tareas completadas.</td></tr>`;
}

document.addEventListener("click", async (e) => {
  if (!e.target.matches(".kanban-move-btn")) return;
  const { id, to } = e.target.dataset;
  await supabase.from("tasks").update({ status: to }).eq("id", id);
  await loadAll();
  renderAll();
});

document.addEventListener("click", (e) => {
  if (!e.target.matches(".btn-calendar")) return;
  const t = state.tasks.find((x) => x.id === e.target.dataset.id);
  if (!t || !t.due_date) return;
  downloadICS(`tarea-${t.title.replace(/[^a-z0-9]+/gi, "-")}.ics`, [
    {
      date: t.due_date,
      title: `Tarea: ${t.title}`,
      description: `Prioridad: ${t.priority}${t.client_id ? " · Cliente: " + clientName(t.client_id) : ""}`,
    },
  ]);
});

function resetTareaForm() {
  document.getElementById("form-tarea").reset();
  document.getElementById("tarea-id").value = "";
  document.getElementById("tarea-submit-btn").textContent = "Agregar tarea";
  document.getElementById("tarea-cancel-btn").hidden = true;
}

document.getElementById("form-tarea").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("tarea-id").value;
  const row = {
    title: document.getElementById("tarea-titulo").value.trim(),
    category: document.getElementById("tarea-categoria").value,
    client_id: document.getElementById("tarea-cliente").value || null,
    status: document.getElementById("tarea-estado").value,
    priority: document.getElementById("tarea-prioridad").value,
    due_date: document.getElementById("tarea-fecha").value || null,
  };
  if (!row.title) return;
  const ok = await saveRow("tasks", id, row);
  if (!ok) return;
  resetTareaForm();
  await loadAll();
  renderAll();
});

document.getElementById("tarea-cancel-btn").addEventListener("click", resetTareaForm);

// ============================================================
// INGRESOS
// ============================================================
document.getElementById("ingreso-fecha").value = todayISO();

function renderIngresosView() {
  const tbody = document.getElementById("tabla-ingresos");
  const delMes = state.income.filter((i) => i.date && i.date.slice(0, 7) === currentPeriodKey());
  tbody.innerHTML =
    delMes
      .map(
        (i) => `
    <tr>
      <td>${i.date}</td>
      <td>${clientName(i.client_id)}</td>
      <td>${i.service}</td>
      <td>${i.type}</td>
      <td class="ing-amount">${money(i.amount)}</td>
      <td class="ing-amount">${money(i.iva)}</td>
      <td>${i.payment_method || ""}</td>
      <td>${i.is_recurring ? "Sí" : "No"}</td>
      <td><span class="invoiced-tag ${i.invoiced ? "si" : "no"}">${i.invoiced ? `Sí${i.invoice_folio ? " · " + i.invoice_folio : ""}` : "No"}</span></td>
      <td>
        <button class="btn-edit" data-id="${i.id}" data-kind="income">Editar</button>
        <button class="btn-delete" data-id="${i.id}" data-kind="income">Eliminar</button>
      </td>
    </tr>`
      )
      .join("") || `<tr><td colspan="10" class="muted">Aún no registras ingresos este mes.</td></tr>`;
}

function resetIngresoForm() {
  document.getElementById("form-ingreso").reset();
  document.getElementById("ingreso-id").value = "";
  document.getElementById("ingreso-fecha").value = todayISO();
  document.getElementById("ingreso-submit-btn").textContent = "Registrar ingreso";
  document.getElementById("ingreso-cancel-btn").hidden = true;
}

document.getElementById("form-ingreso").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("ingreso-id").value;
  const row = {
    client_id: document.getElementById("ingreso-cliente").value,
    service: document.getElementById("ingreso-servicio").value.trim(),
    type: document.getElementById("ingreso-tipo").value,
    amount: parseFloat(document.getElementById("ingreso-monto").value) || 0,
    iva: parseFloat(document.getElementById("ingreso-iva").value) || 0,
    payment_method: document.getElementById("ingreso-metodo").value,
    is_recurring: document.getElementById("ingreso-recurrente").checked,
    date: document.getElementById("ingreso-fecha").value,
    invoiced: document.getElementById("ingreso-facturado").checked,
    invoice_folio: document.getElementById("ingreso-folio").value.trim() || null,
    invoice_date: document.getElementById("ingreso-fecha-factura").value || null,
  };
  const ok = await saveRow("income", id, row);
  if (!ok) return;
  resetIngresoForm();
  await loadAll();
  renderAll();
});

document.getElementById("ingreso-cancel-btn").addEventListener("click", resetIngresoForm);

// ---- Conversor EUR -> MXN (solo ayuda a llenar el Monto, no se guarda aparte) ----
function actualizarMontoDesdeEuros() {
  const eur = parseFloat(document.getElementById("ingreso-eur-monto").value);
  const tc = parseFloat(document.getElementById("ingreso-eur-tc").value);
  if (eur > 0 && tc > 0) {
    document.getElementById("ingreso-monto").value = (eur * tc).toFixed(2);
  }
}
document.getElementById("ingreso-eur-monto").addEventListener("input", actualizarMontoDesdeEuros);
document.getElementById("ingreso-eur-tc").addEventListener("input", actualizarMontoDesdeEuros);

document.getElementById("btn-tipo-cambio-hoy").addEventListener("click", async () => {
  const statusEl = document.getElementById("tipo-cambio-status");
  statusEl.textContent = "Consultando tipo de cambio...";
  try {
    const res = await fetch("https://api.frankfurter.dev/v1/latest?from=EUR&to=MXN");
    const data = await res.json();
    const rate = data && data.rates && data.rates.MXN;
    if (rate) {
      document.getElementById("ingreso-eur-tc").value = rate.toFixed(4);
      statusEl.textContent = `Tipo de cambio de hoy (${data.date}): 1 € = ${rate.toFixed(2)} MXN`;
      actualizarMontoDesdeEuros();
    } else {
      statusEl.textContent = "No se pudo obtener el tipo de cambio automático, ponlo manual.";
    }
  } catch (err) {
    statusEl.textContent = "No se pudo obtener el tipo de cambio automático, ponlo manual.";
  }
});

// ============================================================
// GASTOS
// ============================================================
document.getElementById("gasto-fecha").value = todayISO();

function renderGastosView() {
  const tbody = document.getElementById("tabla-gastos");
  const delMes = state.expenses.filter((g) => g.date && g.date.slice(0, 7) === currentPeriodKey());
  tbody.innerHTML = delMes
    .map(
      (g) => `
    <tr>
      <td>${g.date}</td>
      <td class="ing-amount">${g.description}</td>
      <td>${g.category}</td>
      <td>${g.client_id ? clientName(g.client_id) : "—"}</td>
      <td class="ing-amount">${money(g.amount)}</td>
      <td>${g.recurrence}</td>
      <td>${g.payment_method || ""}</td>
      <td><span class="invoiced-tag ${g.invoiced ? "si" : "no"}">${g.invoiced ? `Sí${g.invoice_folio ? " · " + g.invoice_folio : ""}` : "No"}</span></td>
      <td>
        <button class="btn-edit" data-id="${g.id}" data-kind="expenses">Editar</button>
        <button class="btn-delete" data-id="${g.id}" data-kind="expenses">Eliminar</button>
      </td>
    </tr>`
    )
    .join("") || `<tr><td colspan="9" class="muted">Aún no registras gastos este mes.</td></tr>`;
}

function resetGastoForm() {
  document.getElementById("form-gasto").reset();
  document.getElementById("gasto-id").value = "";
  document.getElementById("gasto-fecha").value = todayISO();
  document.getElementById("gasto-submit-btn").textContent = "Registrar gasto";
  document.getElementById("gasto-cancel-btn").hidden = true;
}

document.getElementById("form-gasto").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("gasto-id").value;
  const clientId = document.getElementById("gasto-cliente").value;
  const row = {
    description: document.getElementById("gasto-descripcion").value.trim(),
    category: document.getElementById("gasto-categoria").value,
    client_id: clientId || null,
    detail: document.getElementById("gasto-detalle").value.trim(),
    amount: parseFloat(document.getElementById("gasto-monto").value) || 0,
    recurrence: document.getElementById("gasto-recurrencia").value,
    payment_method: document.getElementById("gasto-metodo").value,
    date: document.getElementById("gasto-fecha").value,
    invoiced: document.getElementById("gasto-facturado").checked,
    invoice_folio: document.getElementById("gasto-folio").value.trim() || null,
    invoice_date: document.getElementById("gasto-fecha-factura").value || null,
  };
  const ok = await saveRow("expenses", id, row);
  if (!ok) return;
  resetGastoForm();
  await loadAll();
  renderAll();
});

document.getElementById("gasto-cancel-btn").addEventListener("click", resetGastoForm);

// ============================================================
// TARJETA DE CRÉDITO (cortes + pagos quincenales)
// ============================================================
document.getElementById("pago-credito-fecha").value = todayISO();

function gastosCreditoDelCorte(periodKey) {
  return state.expenses.filter(
    (g) => g.payment_method === "Tarjeta de crédito" && cortePeriodKey(g.date) === periodKey
  );
}

function totalCorte(periodKey) {
  return gastosCreditoDelCorte(periodKey).reduce((s, g) => s + Number(g.amount || 0), 0);
}

function pagadoCorte(periodKey) {
  return state.creditPayments
    .filter((p) => p.period_key === periodKey)
    .reduce((s, p) => s + Number(p.amount || 0), 0);
}

function allCortePeriods() {
  const keys = new Set([currentCorteKey()]);
  state.expenses.forEach((g) => {
    if (g.payment_method === "Tarjeta de crédito" && g.date) keys.add(cortePeriodKey(g.date));
  });
  state.creditPayments.forEach((p) => keys.add(p.period_key));
  return Array.from(keys).sort((a, b) => b.localeCompare(a));
}

function renderCreditoView() {
  const periodos = allCortePeriods();
  const actual = currentCorteKey();

  const selPeriodo = document.getElementById("pago-credito-periodo");
  const prevSel = selPeriodo.value;
  selPeriodo.innerHTML = periodos.map((k) => `<option value="${k}">${corteRangeLabel(k)}</option>`).join("");
  selPeriodo.value = prevSel && periodos.includes(prevSel) ? prevSel : actual;

  const totalActual = totalCorte(actual);
  const pagadoActual = pagadoCorte(actual);
  const saldoActual = totalActual - pagadoActual;
  document.getElementById("credito-corte-label").textContent = corteRangeLabel(actual);
  const btnCalCredito = document.getElementById("btn-add-credito-calendar");
  if (btnCalCredito) btnCalCredito.dataset.period = actual;
  document.getElementById("credito-corte-total").textContent = money(totalActual);
  document.getElementById("credito-corte-pagado").textContent = money(pagadoActual);
  document.getElementById("credito-corte-saldo").textContent = money(saldoActual);
  document.getElementById("credito-corte-sugerido").textContent = money(totalActual / 2);

  const gastosCorte = gastosCreditoDelCorte(actual)
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date));
  document.getElementById("tabla-credito-gastos").innerHTML =
    gastosCorte
      .map(
        (g) => `
    <tr>
      <td>${g.date}</td>
      <td class="ing-amount">${g.description}</td>
      <td>${g.category}</td>
      <td class="ing-amount">${money(g.amount)}</td>
    </tr>`
      )
      .join("") || `<tr><td colspan="4" class="muted">Todavía no registras gastos a crédito en este corte.</td></tr>`;

  document.getElementById("tabla-pagos-credito").innerHTML =
    state.creditPayments
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date))
      .map(
        (p) => `
    <tr>
      <td>${p.date}</td>
      <td>${corteRangeLabel(p.period_key)}</td>
      <td class="ing-amount">${money(p.amount)}</td>
      <td>${p.note || ""}</td>
      <td>
        <button class="btn-edit" data-id="${p.id}" data-kind="credit_payments">Editar</button>
        <button class="btn-delete" data-id="${p.id}" data-kind="credit_payments">Eliminar</button>
      </td>
    </tr>`
      )
      .join("") || `<tr><td colspan="5" class="muted">Todavía no registras pagos.</td></tr>`;

  document.getElementById("tabla-historico-cortes").innerHTML =
    periodos
      .map((k) => {
        const total = totalCorte(k);
        const pagado = pagadoCorte(k);
        const saldo = total - pagado;
        const estado = saldo <= 0 ? "Liquidado" : k === actual ? "En curso" : "Pendiente";
        return `
    <tr>
      <td>${corteRangeLabel(k)}</td>
      <td class="ing-amount">${money(total)}</td>
      <td class="ing-amount">${money(pagado)}</td>
      <td class="${saldo > 0 ? "due-overdue" : ""} ing-amount">${money(saldo)}</td>
      <td>${estado}</td>
    </tr>`;
      })
      .join("") || `<tr><td colspan="5" class="muted">Sin cortes todavía.</td></tr>`;
}

function resetPagoCreditoForm() {
  document.getElementById("form-pago-credito").reset();
  document.getElementById("pago-credito-id").value = "";
  document.getElementById("pago-credito-fecha").value = todayISO();
  document.getElementById("pago-credito-submit-btn").textContent = "Registrar pago";
  document.getElementById("pago-credito-cancel-btn").hidden = true;
}

document.getElementById("form-pago-credito").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("pago-credito-id").value;
  const row = {
    period_key: document.getElementById("pago-credito-periodo").value,
    amount: parseFloat(document.getElementById("pago-credito-monto").value) || 0,
    date: document.getElementById("pago-credito-fecha").value,
    note: document.getElementById("pago-credito-nota").value.trim(),
  };
  if (!row.period_key) return;
  const ok = await saveRow("credit_payments", id, row);
  if (!ok) return;
  resetPagoCreditoForm();
  await loadAll();
  renderAll();
});

document.getElementById("pago-credito-cancel-btn").addEventListener("click", resetPagoCreditoForm);

document.getElementById("btn-sugerido-credito").addEventListener("click", () => {
  const periodo = document.getElementById("pago-credito-periodo").value;
  const sugerido = totalCorte(periodo) / 2;
  document.getElementById("pago-credito-monto").value = sugerido.toFixed(2);
});

document.getElementById("btn-add-credito-calendar").addEventListener("click", (e) => {
  const periodo = e.target.dataset.period || currentCorteKey();
  downloadICS(`tarjeta-corte-${periodo}.ics`, [
    {
      date: fechaCorteCierre(periodo),
      title: "Corte de tarjeta de crédito",
      description: corteRangeLabel(periodo),
    },
    {
      date: fechaPagoCorte(periodo),
      title: "Pago de tarjeta de crédito",
      description: `Vence el pago del corte: ${corteRangeLabel(periodo)}`,
    },
  ]);
});

// ============================================================
// AHORRO (fondos + movimientos)
// ============================================================
document.getElementById("movimiento-fecha").value = todayISO();

function fondoAcumulado(fondoId) {
  return state.savingsMoves
    .filter((m) => m.fund_id === fondoId)
    .reduce((s, m) => s + (m.type === "Retiro" ? -Number(m.amount || 0) : Number(m.amount || 0)), 0);
}

function fondoName(id) {
  const f = state.savingsFunds.find((x) => x.id === id);
  return f ? f.name : "—";
}

function renderFondoSelect() {
  document.getElementById("movimiento-fondo").innerHTML = state.savingsFunds
    .map((f) => `<option value="${f.id}">${f.name}</option>`)
    .join("");
}

function renderAhorroView() {
  renderFondoSelect();

  const tbodyFondos = document.getElementById("tabla-fondos");
  tbodyFondos.innerHTML =
    state.savingsFunds
      .map((f) => {
        const acumulado = fondoAcumulado(f.id);
        let avance = "—";
        if (f.goal_amount > 0) {
          const pct = Math.max(0, Math.min(100, Math.round((acumulado / f.goal_amount) * 100)));
          avance = `<div class="progress-bar"><div class="progress-bar-fill" style="width:${pct}%"></div></div><span class="muted">${pct}%</span>`;
        }
        return `
    <tr>
      <td class="ing-amount">${f.name}</td>
      <td class="ing-amount">${f.goal_amount ? money(f.goal_amount) : "—"}</td>
      <td class="ing-amount">${money(acumulado)}</td>
      <td>${avance}</td>
      <td>
        <button class="btn-edit" data-id="${f.id}" data-kind="savings_funds">Editar</button>
        <button class="btn-delete" data-id="${f.id}" data-kind="savings_funds">Eliminar</button>
      </td>
    </tr>`;
      })
      .join("") || `<tr><td colspan="5" class="muted">Todavía no tienes fondos de ahorro.</td></tr>`;

  const tbodyMovs = document.getElementById("tabla-movimientos");
  tbodyMovs.innerHTML =
    state.savingsMoves
      .map(
        (m) => `
    <tr>
      <td>${m.date}</td>
      <td class="ing-amount">${fondoName(m.fund_id)}</td>
      <td>${m.type}</td>
      <td class="ing-amount">${money(m.amount)}</td>
      <td>${m.note || ""}</td>
      <td>
        <button class="btn-edit" data-id="${m.id}" data-kind="savings_moves">Editar</button>
        <button class="btn-delete" data-id="${m.id}" data-kind="savings_moves">Eliminar</button>
      </td>
    </tr>`
      )
      .join("") || `<tr><td colspan="6" class="muted">Todavía no registras movimientos.</td></tr>`;
}

function resetFondoForm() {
  document.getElementById("form-fondo").reset();
  document.getElementById("fondo-id").value = "";
  document.getElementById("fondo-submit-btn").textContent = "Agregar fondo";
  document.getElementById("fondo-cancel-btn").hidden = true;
}

document.getElementById("form-fondo").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("fondo-id").value;
  const row = {
    name: document.getElementById("fondo-nombre").value.trim(),
    goal_amount: parseFloat(document.getElementById("fondo-meta").value) || null,
  };
  if (!row.name) return;
  const ok = await saveRow("savings_funds", id, row);
  if (!ok) return;
  resetFondoForm();
  await loadAll();
  renderAll();
});

document.getElementById("fondo-cancel-btn").addEventListener("click", resetFondoForm);

function resetMovimientoForm() {
  document.getElementById("form-movimiento").reset();
  document.getElementById("movimiento-id").value = "";
  document.getElementById("movimiento-fecha").value = todayISO();
  document.getElementById("movimiento-submit-btn").textContent = "Registrar movimiento";
  document.getElementById("movimiento-cancel-btn").hidden = true;
}

document.getElementById("form-movimiento").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("movimiento-id").value;
  const row = {
    fund_id: document.getElementById("movimiento-fondo").value,
    type: document.getElementById("movimiento-tipo").value,
    amount: parseFloat(document.getElementById("movimiento-monto").value) || 0,
    date: document.getElementById("movimiento-fecha").value,
    note: document.getElementById("movimiento-nota").value.trim(),
  };
  if (!row.fund_id) return;
  const ok = await saveRow("savings_moves", id, row);
  if (!ok) return;
  resetMovimientoForm();
  await loadAll();
  renderAll();
});

document.getElementById("movimiento-cancel-btn").addEventListener("click", resetMovimientoForm);

// ============================================================
// EDITAR (delegado, carga el registro en su formulario)
// ============================================================
document.addEventListener("click", (e) => {
  if (!e.target.matches(".btn-edit")) return;
  const { id, kind } = e.target.dataset;

  if (kind === "clients") {
    const c = state.clients.find((x) => x.id === id);
    if (!c) return;
    document.getElementById("cliente-id").value = c.id;
    document.getElementById("cliente-nombre").value = c.name;
    document.getElementById("cliente-notas").value = c.notes || "";
    document.getElementById("cliente-submit-btn").textContent = "Guardar cambios";
    document.getElementById("cliente-cancel-btn").hidden = false;
    switchView("clientes");
    document.getElementById("form-cliente").scrollIntoView({ behavior: "smooth", block: "center" });
  } else if (kind === "income") {
    const i = state.income.find((x) => x.id === id);
    if (!i) return;
    document.getElementById("ingreso-id").value = i.id;
    document.getElementById("ingreso-cliente").value = i.client_id;
    document.getElementById("ingreso-servicio").value = i.service;
    document.getElementById("ingreso-tipo").value = i.type;
    document.getElementById("ingreso-monto").value = i.amount;
    document.getElementById("ingreso-iva").value = i.iva;
    document.getElementById("ingreso-metodo").value = i.payment_method;
    document.getElementById("ingreso-fecha").value = i.date;
    document.getElementById("ingreso-recurrente").checked = i.is_recurring;
    document.getElementById("ingreso-facturado").checked = !!i.invoiced;
    document.getElementById("ingreso-folio").value = i.invoice_folio || "";
    document.getElementById("ingreso-fecha-factura").value = i.invoice_date || "";
    document.getElementById("ingreso-eur-monto").value = "";
    document.getElementById("ingreso-eur-tc").value = "";
    document.getElementById("ingreso-submit-btn").textContent = "Guardar cambios";
    document.getElementById("ingreso-cancel-btn").hidden = false;
    switchView("ingresos");
    document.getElementById("form-ingreso").scrollIntoView({ behavior: "smooth", block: "center" });
  } else if (kind === "expenses") {
    const g = state.expenses.find((x) => x.id === id);
    if (!g) return;
    document.getElementById("gasto-id").value = g.id;
    document.getElementById("gasto-descripcion").value = g.description;
    document.getElementById("gasto-categoria").value = g.category;
    document.getElementById("gasto-cliente").value = g.client_id || "";
    document.getElementById("gasto-detalle").value = g.detail || "";
    document.getElementById("gasto-monto").value = g.amount;
    document.getElementById("gasto-recurrencia").value = g.recurrence;
    document.getElementById("gasto-metodo").value = g.payment_method;
    document.getElementById("gasto-fecha").value = g.date;
    document.getElementById("gasto-facturado").checked = !!g.invoiced;
    document.getElementById("gasto-folio").value = g.invoice_folio || "";
    document.getElementById("gasto-fecha-factura").value = g.invoice_date || "";
    document.getElementById("gasto-submit-btn").textContent = "Guardar cambios";
    document.getElementById("gasto-cancel-btn").hidden = false;
    switchView("gastos");
    document.getElementById("form-gasto").scrollIntoView({ behavior: "smooth", block: "center" });
  } else if (kind === "tasks") {
    const t = state.tasks.find((x) => x.id === id);
    if (!t) return;
    document.getElementById("tarea-id").value = t.id;
    document.getElementById("tarea-titulo").value = t.title;
    document.getElementById("tarea-categoria").value = t.category;
    document.getElementById("tarea-cliente").value = t.client_id || "";
    document.getElementById("tarea-estado").value = t.status;
    document.getElementById("tarea-prioridad").value = t.priority;
    document.getElementById("tarea-fecha").value = t.due_date || "";
    document.getElementById("tarea-submit-btn").textContent = "Guardar cambios";
    document.getElementById("tarea-cancel-btn").hidden = false;
    switchView("tareas");
    document.getElementById("form-tarea").scrollIntoView({ behavior: "smooth", block: "center" });
  } else if (kind === "savings_funds") {
    const f = state.savingsFunds.find((x) => x.id === id);
    if (!f) return;
    document.getElementById("fondo-id").value = f.id;
    document.getElementById("fondo-nombre").value = f.name;
    document.getElementById("fondo-meta").value = f.goal_amount || "";
    document.getElementById("fondo-submit-btn").textContent = "Guardar cambios";
    document.getElementById("fondo-cancel-btn").hidden = false;
    switchView("ahorro");
    document.getElementById("form-fondo").scrollIntoView({ behavior: "smooth", block: "center" });
  } else if (kind === "savings_moves") {
    const m = state.savingsMoves.find((x) => x.id === id);
    if (!m) return;
    document.getElementById("movimiento-id").value = m.id;
    document.getElementById("movimiento-fondo").value = m.fund_id;
    document.getElementById("movimiento-tipo").value = m.type;
    document.getElementById("movimiento-monto").value = m.amount;
    document.getElementById("movimiento-fecha").value = m.date;
    document.getElementById("movimiento-nota").value = m.note || "";
    document.getElementById("movimiento-submit-btn").textContent = "Guardar cambios";
    document.getElementById("movimiento-cancel-btn").hidden = false;
    switchView("ahorro");
    document.getElementById("form-movimiento").scrollIntoView({ behavior: "smooth", block: "center" });
  } else if (kind === "credit_payments") {
    const p = state.creditPayments.find((x) => x.id === id);
    if (!p) return;
    document.getElementById("pago-credito-id").value = p.id;
    document.getElementById("pago-credito-periodo").value = p.period_key;
    document.getElementById("pago-credito-monto").value = p.amount;
    document.getElementById("pago-credito-fecha").value = p.date;
    document.getElementById("pago-credito-nota").value = p.note || "";
    document.getElementById("pago-credito-submit-btn").textContent = "Guardar cambios";
    document.getElementById("pago-credito-cancel-btn").hidden = false;
    switchView("credito");
    document.getElementById("form-pago-credito").scrollIntoView({ behavior: "smooth", block: "center" });
  }
});

// ============================================================
// ELIMINAR (delegado, cualquier tabla)
// ============================================================
document.addEventListener("click", async (e) => {
  if (!e.target.matches(".btn-delete")) return;
  const { id, kind } = e.target.dataset;
  if (!confirm("¿Eliminar este registro?")) return;
  const { error } = await supabase.from(kind).delete().eq("id", id);
  if (error) {
    alert(`No se pudo eliminar (tabla "${kind}"): ${error.message}`);
    return;
  }
  await loadAll();
  renderAll();
});

// ============================================================
// HISTÓRICO (detalle de meses anteriores, solo lectura)
// ============================================================
function renderHistoricoDetalle() {
  const periodo = currentPeriodKey();

  const ingresosAnteriores = state.income
    .filter((i) => i.date && i.date.slice(0, 7) !== periodo)
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date));
  document.getElementById("tabla-historico-ingresos").innerHTML =
    ingresosAnteriores
      .map(
        (i) => `
    <tr>
      <td>${i.date}</td>
      <td>${clientName(i.client_id)}</td>
      <td>${i.service}</td>
      <td>${i.type}</td>
      <td class="ing-amount">${money(i.amount)}</td>
      <td class="ing-amount">${money(i.iva)}</td>
      <td>
        <button class="btn-edit" data-id="${i.id}" data-kind="income">Editar</button>
        <button class="btn-delete" data-id="${i.id}" data-kind="income">Eliminar</button>
      </td>
    </tr>`
      )
      .join("") || `<tr><td colspan="7" class="muted">Todavía no hay meses anteriores registrados.</td></tr>`;

  const gastosAnteriores = state.expenses
    .filter((g) => g.date && g.date.slice(0, 7) !== periodo)
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date));
  document.getElementById("tabla-historico-gastos").innerHTML =
    gastosAnteriores
      .map(
        (g) => `
    <tr>
      <td>${g.date}</td>
      <td>${g.description}</td>
      <td>${g.category}</td>
      <td>${g.client_id ? clientName(g.client_id) : "—"}</td>
      <td class="ing-amount">${money(g.amount)}</td>
      <td>${g.recurrence}</td>
      <td>${g.payment_method || ""}</td>
      <td>
        <button class="btn-edit" data-id="${g.id}" data-kind="expenses">Editar</button>
        <button class="btn-delete" data-id="${g.id}" data-kind="expenses">Eliminar</button>
      </td>
    </tr>`
      )
      .join("") || `<tr><td colspan="8" class="muted">Todavía no hay meses anteriores registrados.</td></tr>`;
}

// ============================================================
// DASHBOARD
// ============================================================
let chartConcentracion, chartCanal;

function renderDashboard() {
  const period = currentPeriodKey();
  const incomePeriod = state.income.filter((i) => i.date && i.date.slice(0, 7) === period);
  const expensesPeriod = state.expenses.filter((g) => g.date && g.date.slice(0, 7) === period);

  const totalIngresos = incomePeriod.reduce((s, i) => s + Number(i.amount || 0), 0);
  const totalGastos = expensesPeriod.reduce((s, g) => s + Number(g.amount || 0), 0);

  document.getElementById("kpi-ingresos").textContent = money(totalIngresos);
  document.getElementById("kpi-gastos").textContent = money(totalGastos);
  document.getElementById("kpi-utilidad").textContent = money(totalIngresos - totalGastos);
  document.getElementById("kpi-clientes").textContent = state.clients.filter((c) => c.active).length;
  document.getElementById("kpi-tareas").textContent = state.tasks.filter((t) => t.status !== "Hecho").length;
  const ahorroTotal = state.savingsFunds.reduce((s, f) => s + fondoAcumulado(f.id), 0);
  document.getElementById("kpi-ahorro").textContent = money(ahorroTotal);
  const saldoCreditoActual = totalCorte(currentCorteKey()) - pagadoCorte(currentCorteKey());
  document.getElementById("kpi-credito").textContent = money(saldoCreditoActual);

  // ---- Concentración de ingresos por cliente (todo el histórico, más representativo que solo el mes) ----
  const porCliente = {};
  state.income.forEach((i) => {
    const key = i.client_id || "sin-cliente";
    porCliente[key] = (porCliente[key] || 0) + Number(i.amount || 0);
  });
  const totalHist = Object.values(porCliente).reduce((s, v) => s + v, 0) || 1;
  const entries = Object.entries(porCliente)
    .map(([id, monto]) => ({
      id,
      name: id === "sin-cliente" ? "Sin cliente" : clientName(id),
      monto,
      pct: monto / totalHist,
    }))
    .sort((a, b) => b.monto - a.monto);

  const alertBox = document.getElementById("alert-concentracion");
  if (entries.length && entries[0].pct > 0.5) {
    alertBox.hidden = false;
    alertBox.className = "alert-box ing-amount";
    alertBox.textContent = `Alta dependencia de ingresos: ${entries[0].name} representa ${Math.round(
      entries[0].pct * 100
    )}% de lo que has facturado — si ese cliente se va, el golpe es grande. Vale la pena diversificar.`;
  } else if (entries.length) {
    alertBox.hidden = false;
    alertBox.className = "alert-box alert-ok ing-amount";
    alertBox.textContent = "Tus ingresos están razonablemente repartidos entre clientes — ninguno representa más de la mitad del total.";
  } else {
    alertBox.hidden = true;
  }

  const palette = ["#a0bb37", "#1b1b1a", "#74786a", "#b6cc5c", "#4d5a1a", "#c7cdb8", "#3f4a15", "#9aa87f"];
  if (chartConcentracion) chartConcentracion.destroy();
  chartConcentracion = new Chart(document.getElementById("chart-concentracion"), {
    type: "doughnut",
    data: {
      labels: entries.map((e) => e.name),
      datasets: [{ data: entries.map((e) => e.monto), backgroundColor: palette }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } } },
    },
  });

  // ---- Rentabilidad (ingresos) por canal de origen ----
  const porCanal = {};
  state.income.forEach((i) => {
    porCanal[i.type] = (porCanal[i.type] || 0) + Number(i.amount || 0);
  });
  const canalEntries = Object.entries(porCanal).sort((a, b) => b[1] - a[1]);
  if (chartCanal) chartCanal.destroy();
  chartCanal = new Chart(document.getElementById("chart-canal"), {
    type: "bar",
    data: {
      labels: canalEntries.map((e) => e[0]),
      datasets: [{ data: canalEntries.map((e) => e[1]), backgroundColor: "#a0bb37" }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } },
    },
  });

  // ---- Proyección recurrente mensual ----
  const ingresoRecurrente = state.income
    .filter((i) => i.is_recurring)
    .reduce((s, i) => s + Number(i.amount || 0), 0);
  const gastoRecurrente = state.expenses
    .filter((g) => g.recurrence === "Mensual")
    .reduce((s, g) => s + Number(g.amount || 0), 0);
  document.getElementById("proyeccion-recurrente").innerHTML = `
    <div class="stat-row"><span>Ingreso recurrente / mes</span><span class="amount positive ing-amount">${money(ingresoRecurrente)}</span></div>
    <div class="stat-row"><span>Gasto recurrente / mes</span><span class="amount negative ing-amount">${money(gastoRecurrente)}</span></div>
    <div class="stat-row"><span>Neto recurrente / mes</span><span class="amount ing-amount">${money(ingresoRecurrente - gastoRecurrente)}</span></div>
  `;

  // ---- Utilidad por cliente ----
  const utilidadPorCliente = state.clients.map((c) => {
    const ingresosC = state.income.filter((i) => i.client_id === c.id).reduce((s, i) => s + Number(i.amount || 0), 0);
    const gastosC = state.expenses.filter((g) => g.client_id === c.id).reduce((s, g) => s + Number(g.amount || 0), 0);
    return { name: c.name, utilidad: ingresosC - gastosC };
  }).sort((a, b) => b.utilidad - a.utilidad);
  document.getElementById("utilidad-cliente").innerHTML =
    utilidadPorCliente
      .map(
        (u) =>
          `<div class="stat-row"><span>${u.name}</span><span class="amount ing-amount ${u.utilidad >= 0 ? "positive" : "negative"}">${money(u.utilidad)}</span></div>`
      )
      .join("") || `<p class="muted">Todavía no hay clientes con movimientos.</p>`;

  // ---- Próximos pendientes (tareas activas, ordenadas por fecha límite) ----
  const proximas = state.tasks
    .filter((t) => t.status !== "Hecho")
    .slice()
    .sort((a, b) => {
      if (!a.due_date && !b.due_date) return 0;
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return a.due_date.localeCompare(b.due_date);
    })
    .slice(0, 5);
  document.getElementById("proximos-pendientes").innerHTML =
    proximas
      .map(
        (t) =>
          `<div class="stat-row"><span>${t.title}${t.client_id ? " — " + clientName(t.client_id) : ""}</span><span class="amount">${fechaTareaHTML(t)}</span></div>`
      )
      .join("") || `<p class="muted">No tienes pendientes activos. 🎉</p>`;

  // ---- Histórico mensual (ingresos + gastos + utilidad, todos los meses con movimientos) ----
  const porMes = {};
  state.income.forEach((i) => {
    if (!i.date) return;
    const mes = i.date.slice(0, 7);
    porMes[mes] = porMes[mes] || { ingresos: 0, gastos: 0 };
    porMes[mes].ingresos += Number(i.amount || 0);
  });
  state.expenses.forEach((g) => {
    if (!g.date) return;
    const mes = g.date.slice(0, 7);
    porMes[mes] = porMes[mes] || { ingresos: 0, gastos: 0 };
    porMes[mes].gastos += Number(g.amount || 0);
  });
  const mesesOrdenados = Object.keys(porMes).sort((a, b) => b.localeCompare(a)); // más reciente primero
  document.getElementById("tabla-historico-mensual").innerHTML =
    mesesOrdenados
      .map((mes) => {
        const { ingresos, gastos } = porMes[mes];
        const utilidad = ingresos - gastos;
        return `
    <tr>
      <td>${formatMes(mes)}</td>
      <td class="ing-amount">${money(ingresos)}</td>
      <td class="ing-amount">${money(gastos)}</td>
      <td class="${utilidad >= 0 ? "" : "due-overdue"} ing-amount">${money(utilidad)}</td>
    </tr>`;
      })
      .join("") || `<tr><td colspan="4" class="muted">Aún no hay movimientos registrados.</td></tr>`;
}

// ============================================================
// PRIVACIDAD (ocultar montos de ingresos con blur + contraseña)
// ============================================================
const PRIVACY_KEY = "obitoae_privacy_hidden";
const privacyBtn = document.getElementById("btn-privacy-toggle");

function isPrivacyOn() {
  const v = localStorage.getItem(PRIVACY_KEY);
  return v === null ? true : v === "1"; // oculto por default hasta que se desbloquee con la contraseña
}

function setPrivacy(on) {
  appEl.classList.toggle("privacy-on", on);
  localStorage.setItem(PRIVACY_KEY, on ? "1" : "0");
  privacyBtn.textContent = on ? "🙈 Ingresos ocultos" : "🙈 Ocultar ingresos";
}

privacyBtn.addEventListener("click", () => {
  if (isPrivacyOn()) {
    const pass = prompt("Contraseña para ver los ingresos:");
    if (pass === null) return;
    if (pass !== PRIVACY_PASSWORD) {
      alert("Contraseña incorrecta.");
      return;
    }
    setPrivacy(false);
  } else {
    setPrivacy(true);
  }
});

setPrivacy(isPrivacyOn());

// ============================================================
// INICIO
// ============================================================
checkSession();
