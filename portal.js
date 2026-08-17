import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const money = (n) =>
  "$" + (Number(n) || 0).toLocaleString("es-MX", { maximumFractionDigits: 0 });

const loadingEl = document.getElementById("portal-loading");
const appEl = document.getElementById("portal-app");

function showError(msg) {
  loadingEl.textContent = msg;
}

async function init() {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    window.location.href = "/";
    return;
  }

  const { data: userData } = await supabase.auth.getUser();
  const user = userData && userData.user;
  if (!user) {
    window.location.href = "/";
    return;
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    showError("No se pudo cargar tu perfil. Intenta cerrar sesión y volver a entrar.");
    return;
  }

  // Si la cuenta no es de tipo cliente (por ejemplo el dueño o un colaborador
  // llegaron aquí por error), los mandamos de vuelta a la app normal.
  if (profile.role !== "client") {
    window.location.href = "/";
    return;
  }

  if (!profile.client_id) {
    showError(
      "Tu cuenta todavía no está vinculada a ningún cliente. Pídele a Obitoae Management que la vincule desde su panel."
    );
    return;
  }

  document.getElementById("portal-nombre").textContent = profile.full_name || profile.email || "";
  const primerNombre = (profile.full_name || "").trim().split(" ")[0];
  document.getElementById("portal-saludo").textContent = primerNombre ? "Bienvenido, " + primerNombre : "Bienvenido";

  const [{ data: income, error: incomeError }, { data: tasks, error: tasksError }] = await Promise.all([
    supabase.from("income").select("*").eq("client_id", profile.client_id).order("date", { ascending: false }),
    supabase.from("tasks").select("*").eq("client_id", profile.client_id).order("due_date", { ascending: true, nullsFirst: false }),
  ]);

  if (incomeError || tasksError) {
    showError("No se pudo cargar tu información. Intenta recargar la página.");
    return;
  }

  renderIngresos(income || []);
  renderTareas(tasks || []);

  loadingEl.hidden = true;
  appEl.hidden = false;
}

function renderIngresos(income) {
  const tbody = document.getElementById("portal-tabla-ingresos");
  tbody.innerHTML =
    income
      .map(
        (i) => `
    <tr>
      <td>${i.date || "—"}</td>
      <td>${i.service || ""}</td>
      <td>${i.type || ""}</td>
      <td class="ing-amount">${money(i.amount)}</td>
      <td>${i.payment_method || ""}</td>
      <td><span class="invoiced-tag ${i.invoiced ? "si" : "no"}">${i.invoiced ? "Sí" : "No"}</span></td>
    </tr>`
      )
      .join("") || `<tr><td colspan="6" class="muted">Todavía no hay servicios registrados.</td></tr>`;
}

function renderTareas(tasks) {
  const el = document.getElementById("portal-tareas");
  el.innerHTML =
    tasks
      .map(
        (t) => `
    <div class="stat-row">
      <span>${t.title}${t.category ? ` <span class="muted">(${t.category})</span>` : ""}</span>
      <span class="amount">${t.status || "—"}${t.due_date ? ` · ${t.due_date}` : ""}</span>
    </div>`
      )
      .join("") || `<div class="muted">Todavía no hay tareas registradas para ti.</div>`;
}

document.getElementById("portal-logout-btn").addEventListener("click", async () => {
  await supabase.auth.signOut();
  window.location.href = "/";
});

init();
