import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const money = (n) =>
  "$" + (Number(n) || 0).toLocaleString("es-MX", { maximumFractionDigits: 0 });

const todayISO = () => new Date().toISOString().slice(0, 10);
const currentPeriodKey = () => new Date().toISOString().slice(0, 7); // "YYYY-MM"

let state = { clients: [], income: [], expenses: [], tasks: [] };

// ============================================================
// AUTH
// ============================================================
const loginScreen = document.getElementById("login-screen");
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
  appEl.hidden = true;
}

async function showApp() {
  loginScreen.hidden = true;
  appEl.hidden = false;
  await loadAll();
  renderAll();
}

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
document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".view").forEach((v) => (v.hidden = true));
    document.getElementById("view-" + btn.dataset.view).hidden = false;
  });
});

// ============================================================
// CARGA DE DATOS
// ============================================================
async function loadAll() {
  const [{ data: clients }, { data: income }, { data: expenses }, { data: tasks }] = await Promise.all([
    supabase.from("clients").select("*").order("name"),
    supabase.from("income").select("*").order("date", { ascending: false }),
    supabase.from("expenses").select("*").order("date", { ascending: false }),
    supabase.from("tasks").select("*").order("due_date", { ascending: true, nullsFirst: false }),
  ]);
  state.clients = clients || [];
  state.income = income || [];
  state.expenses = expenses || [];
  state.tasks = tasks || [];
}

function clientName(id) {
  const c = state.clients.find((c) => c.id === id);
  return c ? c.name : "—";
}

function renderAll() {
  renderClientSelects();
  renderClientesView();
  renderTareasView();
  renderIngresosView();
  renderGastosView();
  renderDashboard();
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
  if (id) {
    await supabase.from("clients").update({ name, notes }).eq("id", id);
  } else {
    await supabase.from("clients").insert({ name, notes });
  }
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

function renderTareasView() {
  const activas = state.tasks.filter((t) => t.status !== "Hecho");
  const hechas = state.tasks
    .filter((t) => t.status === "Hecho")
    .slice(0, 10);

  document.getElementById("tabla-tareas-activas").innerHTML = activas
    .map(
      (t) => `
    <tr>
      <td>${t.title}</td>
      <td>${t.category}</td>
      <td>${t.client_id ? clientName(t.client_id) : "—"}</td>
      <td><span class="priority-tag ${t.priority}">${t.priority}</span></td>
      <td>${fechaTareaHTML(t)}</td>
      <td>${t.status}</td>
      <td>
        <button class="btn-done" data-id="${t.id}" data-kind="tasks">Hecho</button>
        <button class="btn-edit" data-id="${t.id}" data-kind="tasks">Editar</button>
        <button class="btn-delete" data-id="${t.id}" data-kind="tasks">Eliminar</button>
      </td>
    </tr>`
    )
    .join("") || `<tr><td colspan="7" class="muted">No tienes tareas pendientes. 🎉</td></tr>`;

  document.getElementById("tabla-tareas-hechas").innerHTML = hechas
    .map(
      (t) => `
    <tr>
      <td>${t.title}</td>
      <td>${t.category}</td>
      <td>${t.client_id ? clientName(t.client_id) : "—"}</td>
      <td>${t.due_date || "—"}</td>
      <td><button class="btn-delete" data-id="${t.id}" data-kind="tasks">Eliminar</button></td>
    </tr>`
    )
    .join("") || `<tr><td colspan="5" class="muted">Aún no marcas ninguna tarea como hecha.</td></tr>`;
}

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
  if (id) {
    await supabase.from("tasks").update(row).eq("id", id);
  } else {
    await supabase.from("tasks").insert(row);
  }
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
  tbody.innerHTML = state.income
    .map(
      (i) => `
    <tr>
      <td>${i.date}</td>
      <td>${clientName(i.client_id)}</td>
      <td>${i.service}</td>
      <td>${i.type}</td>
      <td>${money(i.amount)}</td>
      <td>${money(i.iva)}</td>
      <td>${i.payment_method || ""}</td>
      <td>${i.is_recurring ? "Sí" : "No"}</td>
      <td>
        <button class="btn-edit" data-id="${i.id}" data-kind="income">Editar</button>
        <button class="btn-delete" data-id="${i.id}" data-kind="income">Eliminar</button>
      </td>
    </tr>`
    )
    .join("");
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
  };
  if (id) {
    await supabase.from("income").update(row).eq("id", id);
  } else {
    await supabase.from("income").insert(row);
  }
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
  tbody.innerHTML = state.expenses
    .map(
      (g) => `
    <tr>
      <td>${g.date}</td>
      <td>${g.description}</td>
      <td>${g.category}</td>
      <td>${g.client_id ? clientName(g.client_id) : "—"}</td>
      <td>${money(g.amount)}</td>
      <td>${g.recurrence}</td>
      <td>${g.payment_method || ""}</td>
      <td>
        <button class="btn-edit" data-id="${g.id}" data-kind="expenses">Editar</button>
        <button class="btn-delete" data-id="${g.id}" data-kind="expenses">Eliminar</button>
      </td>
    </tr>`
    )
    .join("");
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
  };
  if (id) {
    await supabase.from("expenses").update(row).eq("id", id);
  } else {
    await supabase.from("expenses").insert(row);
  }
  resetGastoForm();
  await loadAll();
  renderAll();
});

document.getElementById("gasto-cancel-btn").addEventListener("click", resetGastoForm);

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
    document.getElementById("ingreso-eur-monto").value = "";
    document.getElementById("ingreso-eur-tc").value = "";
    document.getElementById("ingreso-submit-btn").textContent = "Guardar cambios";
    document.getElementById("ingreso-cancel-btn").hidden = false;
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
    document.getElementById("gasto-submit-btn").textContent = "Guardar cambios";
    document.getElementById("gasto-cancel-btn").hidden = false;
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
    document.getElementById("form-tarea").scrollIntoView({ behavior: "smooth", block: "center" });
  }
});

// ============================================================
// MARCAR TAREA COMO HECHA (delegado, acción rápida)
// ============================================================
document.addEventListener("click", async (e) => {
  if (!e.target.matches(".btn-done")) return;
  const { id, kind } = e.target.dataset;
  await supabase.from(kind).update({ status: "Hecho" }).eq("id", id);
  await loadAll();
  renderAll();
});

// ============================================================
// ELIMINAR (delegado, cualquier tabla)
// ============================================================
document.addEventListener("click", async (e) => {
  if (!e.target.matches(".btn-delete")) return;
  const { id, kind } = e.target.dataset;
  if (!confirm("¿Eliminar este registro?")) return;
  await supabase.from(kind).delete().eq("id", id);
  await loadAll();
  renderAll();
});

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
    alertBox.className = "alert-box";
    alertBox.textContent = `Alta dependencia de ingresos: ${entries[0].name} representa ${Math.round(
      entries[0].pct * 100
    )}% de lo que has facturado — si ese cliente se va, el golpe es grande. Vale la pena diversificar.`;
  } else if (entries.length) {
    alertBox.hidden = false;
    alertBox.className = "alert-box alert-ok";
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
    options: { plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } } } },
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
    <div class="stat-row"><span>Ingreso recurrente / mes</span><span class="amount positive">${money(ingresoRecurrente)}</span></div>
    <div class="stat-row"><span>Gasto recurrente / mes</span><span class="amount negative">${money(gastoRecurrente)}</span></div>
    <div class="stat-row"><span>Neto recurrente / mes</span><span class="amount">${money(ingresoRecurrente - gastoRecurrente)}</span></div>
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
          `<div class="stat-row"><span>${u.name}</span><span class="amount ${u.utilidad >= 0 ? "positive" : "negative"}">${money(u.utilidad)}</span></div>`
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
}

// ============================================================
// INICIO
// ============================================================
checkSession();
