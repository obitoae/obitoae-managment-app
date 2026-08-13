import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const money = (n) =>
  "$" + (Number(n) || 0).toLocaleString("es-MX", { maximumFractionDigits: 0 });

const todayISO = () => new Date().toISOString().slice(0, 10);
const currentPeriodKey = () => new Date().toISOString().slice(0, 7); // "YYYY-MM"

let state = { clients: [], income: [], expenses: [] };

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
  const [{ data: clients }, { data: income }, { data: expenses }] = await Promise.all([
    supabase.from("clients").select("*").order("name"),
    supabase.from("income").select("*").order("date", { ascending: false }),
    supabase.from("expenses").select("*").order("date", { ascending: false }),
  ]);
  state.clients = clients || [];
  state.income = income || [];
  state.expenses = expenses || [];
}

function clientName(id) {
  const c = state.clients.find((c) => c.id === id);
  return c ? c.name : "—";
}

function renderAll() {
  renderClientSelects();
  renderClientesView();
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
      <td><button class="btn-delete" data-id="${c.id}" data-kind="clients">Eliminar</button></td>
    </tr>`
    )
    .join("");
}

document.getElementById("form-cliente").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("cliente-nombre").value.trim();
  const notes = document.getElementById("cliente-notas").value.trim();
  if (!name) return;
  await supabase.from("clients").insert({ name, notes });
  document.getElementById("form-cliente").reset();
  await loadAll();
  renderAll();
});

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
      <td><button class="btn-delete" data-id="${i.id}" data-kind="income">Eliminar</button></td>
    </tr>`
    )
    .join("");
}

document.getElementById("form-ingreso").addEventListener("submit", async (e) => {
  e.preventDefault();
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
  await supabase.from("income").insert(row);
  e.target.reset();
  document.getElementById("ingreso-fecha").value = todayISO();
  await loadAll();
  renderAll();
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
      <td><button class="btn-delete" data-id="${g.id}" data-kind="expenses">Eliminar</button></td>
    </tr>`
    )
    .join("");
}

document.getElementById("form-gasto").addEventListener("submit", async (e) => {
  e.preventDefault();
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
  await supabase.from("expenses").insert(row);
  e.target.reset();
  document.getElementById("gasto-fecha").value = todayISO();
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
}

// ============================================================
// INICIO
// ============================================================
checkSession();
