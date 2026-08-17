import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const money = (n) =>
  "$" + (Number(n) || 0).toLocaleString("es-MX", { maximumFractionDigits: 0 });

// Para Facturas: nada de redondear a peso cerrado — si redondeamos cada cifra
// por separado (subtotal, IVA, total) por separado, pueden dejar de cuadrar
// entre sí aunque el cálculo interno esté bien. Aquí siempre se muestran los
// centavos exactos.
const moneyExact = (n) =>
  "$" + (Number(n) || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

// El día de corte y el día límite de pago son 100% configurables por
// persona, desde "Mi perfil" — si alguien no los configura, no hay ningún
// valor por default: la sección de Tarjeta de crédito simplemente le pide
// que los configure antes de mostrar nada.
// La tarjeta de crédito es personal — cada quien ve y configura la suya.
// La única excepción: el dueño puede elegir "ver como" otra persona del
// equipo (selector en la vista de Tarjeta de crédito), y mientras esa
// selección esté activa, estas funciones leen el perfil y los datos de la
// persona elegida en vez de los del dueño.
function creditoViewUserId() {
  return (state.currentProfile && state.currentProfile.role === "owner" && state.creditoViewAsId) || state.currentUserId;
}

function creditoViewProfile() {
  const id = creditoViewUserId();
  if (id === state.currentUserId) return state.currentProfile;
  return state.profiles.find((p) => p.id === id) || state.currentProfile;
}

function getCorteDay() {
  const perfil = creditoViewProfile();
  const d = perfil && Number(perfil.credit_cutoff_day);
  return d && d >= 1 && d <= 31 ? d : null;
}

function getDueDay() {
  const perfil = creditoViewProfile();
  const d = perfil && Number(perfil.credit_due_day);
  return d && d >= 1 && d <= 31 ? d : null;
}

function creditoConfigurado() {
  return getCorteDay() !== null && getDueDay() !== null;
}

// Regla de pago de tarjeta: el pago del corte que cierra el día configurado
// de un mes vence el día límite configurado del mes siguiente.
function fechaPagoCorte(periodKey) {
  const dueDay = getDueDay();
  if (dueDay === null || !periodKey) return null;
  const [y, m] = periodKey.split("-").map(Number);
  let payYear = y;
  let payMonth = m + 1;
  if (payMonth > 12) {
    payMonth = 1;
    payYear += 1;
  }
  return `${payYear}-${String(payMonth).padStart(2, "0")}-${String(dueDay).padStart(2, "0")}`;
}

function fechaCorteCierre(periodKey) {
  const corteDay = getCorteDay();
  if (corteDay === null || !periodKey) return null;
  const [y, m] = periodKey.split("-").map(Number);
  return `${y}-${String(m).padStart(2, "0")}-${String(corteDay).padStart(2, "0")}`;
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

// ---- Cortes de tarjeta de crédito (cierran el día configurado de cada mes) ----
function cortePeriodKey(dateStr) {
  if (!dateStr) return null;
  const corteDay = getCorteDay();
  if (corteDay === null) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  let year = y;
  let month = m; // 1-12
  if (d > corteDay) {
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
  const corteDay = getCorteDay();
  if (corteDay === null || !periodKey) return "—";
  const inicio = corteDay >= 28 ? 1 : corteDay + 1;
  const [y, m] = periodKey.split("-").map(Number);
  let prevMonth = m - 1;
  let prevYear = y;
  if (prevMonth < 1) {
    prevMonth = 12;
    prevYear -= 1;
  }
  return `Corte del ${inicio} de ${MESES_ES[prevMonth - 1]} al ${corteDay} de ${MESES_ES[m - 1]} ${y}`;
}

// ============================================================
// APARIENCIA: color de acento + modo claro/oscuro, por persona
// (se guarda en el perfil de cada quien — ver "Mi perfil")
// ============================================================
const DEFAULT_ACCENT = "#a0bb37";
const DEFAULT_SECONDARY = "#1b1b1a";

// El color secundario (barra lateral / login / portada) solo se puede elegir
// de esta lista — a diferencia del acento, aquí no dejamos cualquier color
// libre porque esas pantallas tienen texto blanco/gris fijo por diseño; si
// alguien pusiera un color muy claro, ese texto dejaría de leerse. Por eso
// las 8 opciones son todas oscuras. Cada una trae su propio "-2" (un tono
// apenas más claro, para la tarjeta de login y el fondo de la portada).
const SECONDARY_PRESETS = {
  "#1b1b1a": "#262622",
  "#16233a": "#1f2f4d",
  "#241b36": "#322648",
  "#16241a": "#213321",
  "#2e1620": "#3d1f2b",
  "#2a2018": "#392c21",
  "#22262b": "#2e333a",
  "#142726": "#1d3634",
};

function hexToRgb(hex) {
  let h = String(hex || "").replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) h = "a0bb37";
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r, g, b) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

// Mezcla dos colores hex. ratio 0 = colorA puro, 1 = colorB puro.
function mixHex(colorA, colorB, ratio) {
  const a = hexToRgb(colorA);
  const b = hexToRgb(colorB);
  return rgbToHex(a.r + (b.r - a.r) * ratio, a.g + (b.g - a.g) * ratio, a.b + (b.b - a.b) * ratio);
}

// Luminancia relativa (WCAG) — para decidir si el texto sobre un color de
// acento debe ser negro o blanco, sin importar qué color haya elegido cada
// quien (para que siempre se pueda leer).
function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const chan = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
}

function onAccentColor(hex) {
  return relativeLuminance(hex) > 0.42 ? "#1b1b1a" : "#ffffff";
}

const THEME_MODE_TOKENS = {
  light: { bodyBg: "#f9fbf6", cardBg: "#ffffff", inputBg: "#ffffff", text: "#1b1b1a", muted: "#74786a", border: "#e3e6da" },
  dark: { bodyBg: "#171712", cardBg: "#222218", inputBg: "#2a2a1f", text: "#f2f1ea", muted: "#a6a996", border: "#3a3a2e" },
};

// Recalcula y aplica las variables CSS de color según el perfil actual (o
// los defaults de marca si todavía no hay nadie conectado). Se llama cada
// vez que cargamos o guardamos el perfil.
function applyTheme() {
  const perfil = state.currentProfile || {};
  const accent = /^#[0-9a-fA-F]{6}$/.test(perfil.theme_color || "") ? perfil.theme_color : DEFAULT_ACCENT;
  const secondary = SECONDARY_PRESETS[perfil.theme_secondary_color] ? perfil.theme_secondary_color : DEFAULT_SECONDARY;
  const secondary2 = SECONDARY_PRESETS[secondary] || SECONDARY_PRESETS[DEFAULT_SECONDARY];
  const mode = perfil.theme_mode === "dark" ? "dark" : "light";
  const tokens = THEME_MODE_TOKENS[mode];

  const root = document.documentElement.style;
  root.setProperty("--green", accent);
  root.setProperty("--green-soft", mixHex(accent, "#ffffff", 0.25));
  root.setProperty("--green-bg", mode === "dark" ? mixHex(accent, tokens.cardBg, 0.78) : mixHex(accent, "#ffffff", 0.85));
  root.setProperty("--on-accent", onAccentColor(accent));
  root.setProperty("--dark", secondary);
  root.setProperty("--dark-2", secondary2);
  root.setProperty("--body-bg", tokens.bodyBg);
  root.setProperty("--card-bg", tokens.cardBg);
  root.setProperty("--input-bg", tokens.inputBg);
  root.setProperty("--text", tokens.text);
  root.setProperty("--muted", tokens.muted);
  root.setProperty("--border", tokens.border);
}

let state = {
  clients: [],
  income: [],
  expenses: [],
  tasks: [],
  savingsFunds: [],
  savingsMoves: [],
  creditPayments: [],
  invoicesIssued: [],
  invoicesReceived: [],
  profiles: [],
  currentUserId: null,
  currentProfile: null, // { id, email, full_name, role }
  // Solo el dueño puede cambiar esto — le permite ver la tarjeta de crédito
  // de otra persona del equipo. Para cualquier otro rol siempre queda en
  // null (o sea, "la mía"). Se resetea al cerrar sesión.
  creditoViewAsId: null,
};

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

// Carga quién eres (tu id de Supabase Auth) y tu perfil (nombre + rol:
// "owner" ve todo, "member" solo lo suyo — esto ya lo filtra Supabase solo
// por las políticas de seguridad, aquí nada más lo usamos para mostrar tu
// nombre/rol en la barra lateral y para etiquetar lo que creas como tuyo).
async function loadCurrentProfile() {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData && userData.user;
  if (!user) {
    state.currentUserId = null;
    state.currentProfile = null;
    return;
  }
  state.currentUserId = user.id;
  state.creditoViewAsId = null;

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  state.currentProfile = profile || { id: user.id, email: user.email, full_name: null, role: "member" };
  applyTheme();

  const nombre = state.currentProfile.full_name || state.currentProfile.email || "";

  const infoEl = document.getElementById("user-info");
  if (infoEl) {
    const roleLabels = { owner: "Dueño", member: "Colaborador", client: "Cliente" };
    const roleClass = { owner: "", member: "member", client: "client" };
    const role = state.currentProfile.role || "member";
    infoEl.innerHTML =
      `<span>${nombre}</span>` + `<span class="user-role-tag ${roleClass[role] || ""}">${roleLabels[role] || role}</span>`;
    infoEl.hidden = false;
  }

  // Nota: la portada ("By Eduardo Valentin") es fija para todos — ya no se
  // personaliza con el nombre de quien entra. El saludo que sí cambia por
  // persona está adentro, en "Inicio" ("Bienvenido, ...").

  // Ahora que ya sabemos si tiene contraseña de privacidad propia, mostramos
  // (o no) el botón de ocultar montos.
  if (typeof refreshPrivacyUI === "function") refreshPrivacyUI();

  applyAccountTypeUI();
}

// ============================================================
// TIPO DE CUENTA: "empresarial" (todo el sistema, con clientes/facturación)
// o "personal" (versión sencilla, solo organización propia — sin clientes ni
// facturación). Se elige al registrarse y se puede cambiar luego desde
// "Mi perfil". Aquí solo ajustamos qué se ve — los datos de cada quien ya
// están aislados por owner_id sin importar el tipo de cuenta.
// ============================================================
function applyAccountTypeUI() {
  const isPersonal = !!state.currentProfile && state.currentProfile.account_type === "personal";

  document.querySelectorAll(".nav-business-only").forEach((el) => {
    el.hidden = isPersonal;
  });
  document.querySelectorAll(".gasto-business-only").forEach((el) => {
    el.hidden = isPersonal;
  });

  // Si el tipo de cuenta ya no incluye la vista en la que estabas parado
  // (por ejemplo, cambiaste de "empresarial" a "personal" mientras veías
  // Facturas), regresamos a Inicio para no dejar una pantalla vacía.
  if (isPersonal) {
    const vistasSoloEmpresariales = ["view-dashboard", "view-clientes", "view-ingresos", "view-facturas", "view-ahorro", "view-historico"];
    const vistaActiva = document.querySelector(".view:not([hidden])");
    if (vistaActiva && vistasSoloEmpresariales.includes(vistaActiva.id) && typeof switchView === "function") {
      switchView("inicio");
    }
  }
}

// Portada: efecto de entrada letra por letra para el nombre — se reconstruye
// cada vez que se muestra la portada, para que la animación se repita.
function animateCoverName() {
  const el = document.getElementById("cover-name");
  if (!el) return;
  if (!el.dataset.text) el.dataset.text = el.textContent;
  const text = el.dataset.text;
  el.innerHTML = text
    .split("")
    .map((ch, i) => {
      // Espacio normal (no &nbsp;) para que el navegador SÍ pueda cortar la
      // línea entre palabras — si no, "Valentin" se puede partir a la mitad
      // en pantallas angostas por no tener dónde más cortar.
      if (ch === " ") return " ";
      return `<span class="cover-letter" style="animation-delay:${(i * 0.035).toFixed(3)}s">${ch}</span>`;
    })
    .join("");
}

// Portada: se muestra siempre después de entrar, antes de la app. Los datos
// se cargan de fondo mientras el usuario la ve, así que al tocar "Ingresar"
// todo ya está listo.
async function showApp() {
  loginScreen.hidden = true;
  appEl.hidden = true;
  coverScreen.hidden = false;
  animateCoverName();
  document.getElementById("cover-fecha").textContent = fechaLargaHoy();
  await loadCurrentProfile();

  // Las cuentas de cliente tienen su propio portal, muy distinto a la app
  // interna — no cargan ni ven nada de esto.
  if (state.currentProfile && state.currentProfile.role === "client") {
    window.location.href = "portal.html";
    return;
  }

  await loadAll();
  renderAll();
}

document.getElementById("btn-cover-ingresar").addEventListener("click", (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  coverScreen.classList.add("cover-exit");
  setTimeout(() => {
    coverScreen.hidden = true;
    coverScreen.classList.remove("cover-exit");
    btn.disabled = false;
    appEl.hidden = false;
    appEl.classList.add("app-enter");
    setTimeout(() => appEl.classList.remove("app-enter"), 500);
  }, 480);
});

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const errEl = document.getElementById("login-error");
  errEl.hidden = true;
  const submitBtn = document.querySelector("#login-form button[type='submit']");
  if (submitBtn) submitBtn.classList.add("btn-loading");
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (submitBtn) submitBtn.classList.remove("btn-loading");
  if (error) {
    errEl.textContent = "No pudimos entrar: " + error.message;
    errEl.hidden = false;
    const loginCard = document.querySelector(".login-card");
    if (loginCard) {
      loginCard.classList.remove("shake");
      void loginCard.offsetWidth;
      loginCard.classList.add("shake");
    }
    return;
  }
  await showApp();
});

// ---- Crear cuenta (registro público con código de invitación) ----
const loginFormEl = document.getElementById("login-form");
const signupFormEl = document.getElementById("signup-form");
const btnShowSignup = document.getElementById("btn-show-signup");
const btnShowLogin = document.getElementById("btn-show-login");

btnShowSignup.addEventListener("click", () => {
  loginFormEl.hidden = true;
  btnShowSignup.hidden = true;
  signupFormEl.hidden = false;
  btnShowLogin.hidden = false;
});

btnShowLogin.addEventListener("click", () => {
  signupFormEl.hidden = true;
  btnShowLogin.hidden = true;
  loginFormEl.hidden = false;
  btnShowSignup.hidden = false;
});

// ---- Tipo de cuenta al registrarse (empresarial / personal) ----
const signupAccountTypeInput = document.getElementById("signup-account-type");
document.querySelectorAll("#signup-account-type-row .account-type-card").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#signup-account-type-row .account-type-card").forEach((b) => b.classList.remove("selected"));
    btn.classList.add("selected");
    signupAccountTypeInput.value = btn.dataset.type;
  });
});

signupFormEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fullName = document.getElementById("signup-name").value.trim();
  const email = document.getElementById("signup-email").value.trim();
  const password = document.getElementById("signup-password").value;
  const accountType = signupAccountTypeInput.value === "personal" ? "personal" : "empresarial";
  const errEl = document.getElementById("signup-error");
  const okEl = document.getElementById("signup-success");
  errEl.hidden = true;
  okEl.hidden = true;

  const submitBtn = document.querySelector("#signup-form button[type='submit']");
  if (submitBtn) submitBtn.classList.add("btn-loading");
  // El nombre y el tipo de cuenta viajan como metadatos del registro — el
  // trigger de Supabase los guarda solo en el perfil en cuanto se crea la
  // cuenta (ver handle_new_user() en part6_tipo_cuenta.sql).
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName, account_type: accountType } },
  });
  if (submitBtn) submitBtn.classList.remove("btn-loading");

  if (error) {
    errEl.textContent = "No se pudo crear la cuenta: " + error.message;
    errEl.hidden = false;
    return;
  }

  // Si tu proyecto de Supabase pide confirmar el correo (así viene por
  // default), la sesión no queda activa todavía — hay que avisarle a la
  // persona que revise su correo antes de poder entrar.
  if (data && data.session) {
    await showApp();
  } else {
    signupFormEl.reset();
    okEl.textContent = "¡Cuenta creada! Revisa tu correo para confirmarla, y ya podrás entrar.";
    okEl.hidden = false;
  }
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  await supabase.auth.signOut();
  state.currentUserId = null;
  state.currentProfile = null;
  applyTheme();
  const infoEl = document.getElementById("user-info");
  if (infoEl) infoEl.hidden = true;
  if (typeof refreshPrivacyUI === "function") refreshPrivacyUI();
  showLogin();
});

// ============================================================
// MI PERFIL (nombre, contraseña de privacidad personal, régimen fiscal)
// ============================================================
const perfilModal = document.getElementById("perfil-modal");
const perfilRegimenWrap = document.getElementById("perfil-regimen-wrap");
const perfilCreditoWrap = document.getElementById("perfil-credito-wrap");
const perfilColorInput = document.getElementById("perfil-color");
const perfilColorCustom = document.getElementById("perfil-color-custom");
const perfilColorSwatches = document.querySelectorAll("#perfil-color-swatches .color-swatch");

function setPerfilColorSeleccionado(hex) {
  perfilColorInput.value = hex;
  perfilColorCustom.value = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : DEFAULT_ACCENT;
  perfilColorSwatches.forEach((btn) => {
    btn.classList.toggle("selected", btn.dataset.color.toLowerCase() === hex.toLowerCase());
  });
}

perfilColorSwatches.forEach((btn) => {
  btn.addEventListener("click", () => setPerfilColorSeleccionado(btn.dataset.color));
});
perfilColorCustom.addEventListener("input", () => setPerfilColorSeleccionado(perfilColorCustom.value));

const perfilColor2Input = document.getElementById("perfil-color2");
const perfilColor2Swatches = document.querySelectorAll("#perfil-color2-swatches .color-swatch");

function setPerfilColor2Seleccionado(hex) {
  const valido = SECONDARY_PRESETS[hex] ? hex : DEFAULT_SECONDARY;
  perfilColor2Input.value = valido;
  perfilColor2Swatches.forEach((btn) => {
    btn.classList.toggle("selected", btn.dataset.color.toLowerCase() === valido.toLowerCase());
  });
}

perfilColor2Swatches.forEach((btn) => {
  btn.addEventListener("click", () => setPerfilColor2Seleccionado(btn.dataset.color));
});

// ---- Tipo de cuenta (empresarial / personal), editable desde "Mi perfil" ----
const perfilTipoCuentaWrap = document.getElementById("perfil-tipo-cuenta-wrap");
const perfilTipoCuentaInput = document.getElementById("perfil-tipo-cuenta");
const perfilTipoCuentaCards = document.querySelectorAll("#perfil-tipo-cuenta-row .account-type-card");

function setPerfilTipoCuentaSeleccionado(tipo) {
  const valido = tipo === "personal" ? "personal" : "empresarial";
  perfilTipoCuentaInput.value = valido;
  perfilTipoCuentaCards.forEach((btn) => {
    btn.classList.toggle("selected", btn.dataset.type === valido);
  });
}

perfilTipoCuentaCards.forEach((btn) => {
  btn.addEventListener("click", () => setPerfilTipoCuentaSeleccionado(btn.dataset.type));
});

document.getElementById("user-info").addEventListener("click", () => {
  if (!state.currentProfile) return;
  document.getElementById("perfil-nombre").value = state.currentProfile.full_name || "";
  setPerfilTipoCuentaSeleccionado(state.currentProfile.account_type || "empresarial");
  if (perfilTipoCuentaWrap) perfilTipoCuentaWrap.hidden = state.currentProfile.role === "client";
  document.getElementById("perfil-privacy-password").value = state.currentProfile.privacy_password || "";
  document.getElementById("perfil-regimen").value = state.currentProfile.tax_regime || "";
  document.getElementById("perfil-iva-default").value = state.currentProfile.default_iva_rate ?? "";
  document.getElementById("perfil-isr-default").value = state.currentProfile.default_isr_rate ?? "";
  document.getElementById("perfil-corte-dia").value = state.currentProfile.credit_cutoff_day ?? "";
  document.getElementById("perfil-pago-dia").value = state.currentProfile.credit_due_day ?? "";
  setPerfilColorSeleccionado(state.currentProfile.theme_color || DEFAULT_ACCENT);
  setPerfilColor2Seleccionado(state.currentProfile.theme_secondary_color || DEFAULT_SECONDARY);
  document.getElementById("perfil-tema-modo").value = state.currentProfile.theme_mode === "dark" ? "dark" : "light";
  // El régimen fiscal / tasas de factura solo aplica a quien factura en el
  // negocio (cuentas "empresarial", y nunca a un cliente). La tarjeta de
  // crédito sí aplica también a cuentas "personal".
  perfilRegimenWrap.hidden = state.currentProfile.role === "client" || state.currentProfile.account_type === "personal";
  if (perfilCreditoWrap) perfilCreditoWrap.hidden = state.currentProfile.role === "client";
  document.getElementById("perfil-error").hidden = true;
  perfilModal.hidden = false;
});

document.getElementById("perfil-cancel-btn").addEventListener("click", () => {
  perfilModal.hidden = true;
});

document.getElementById("form-perfil").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("perfil-error");
  errEl.hidden = true;

  const update = {
    full_name: document.getElementById("perfil-nombre").value.trim() || null,
    account_type: perfilTipoCuentaInput.value === "personal" ? "personal" : "empresarial",
    privacy_password: document.getElementById("perfil-privacy-password").value || null,
    tax_regime: document.getElementById("perfil-regimen").value || null,
    default_iva_rate: document.getElementById("perfil-iva-default").value
      ? Number(document.getElementById("perfil-iva-default").value)
      : null,
    default_isr_rate: document.getElementById("perfil-isr-default").value
      ? Number(document.getElementById("perfil-isr-default").value)
      : null,
    credit_cutoff_day: document.getElementById("perfil-corte-dia").value
      ? Number(document.getElementById("perfil-corte-dia").value)
      : null,
    credit_due_day: document.getElementById("perfil-pago-dia").value
      ? Number(document.getElementById("perfil-pago-dia").value)
      : null,
    theme_color: /^#[0-9a-fA-F]{6}$/.test(perfilColorInput.value) ? perfilColorInput.value : null,
    theme_secondary_color: SECONDARY_PRESETS[perfilColor2Input.value] ? perfilColor2Input.value : null,
    theme_mode: document.getElementById("perfil-tema-modo").value === "dark" ? "dark" : "light",
  };

  const { error } = await supabase.from("profiles").update(update).eq("id", state.currentUserId);
  if (error) {
    errEl.textContent = "No se pudo guardar: " + error.message;
    errEl.hidden = false;
    return;
  }

  perfilModal.hidden = true;
  await loadCurrentProfile();
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

// ---- Menú deslizable (móvil): el sidebar se abre/cierra como cajón ----
const sidebarEl = document.querySelector(".sidebar");
const sidebarOverlayEl = document.getElementById("sidebar-overlay");
const btnMobileMenu = document.getElementById("btn-mobile-menu");

function setSidebarOpen(open) {
  sidebarEl.classList.toggle("open", open);
  sidebarOverlayEl.hidden = !open;
}

if (btnMobileMenu) {
  btnMobileMenu.addEventListener("click", () => setSidebarOpen(!sidebarEl.classList.contains("open")));
}
if (sidebarOverlayEl) {
  sidebarOverlayEl.addEventListener("click", () => setSidebarOpen(false));
}
document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => setSidebarOpen(false));
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
    supabase.from("invoices_issued").select("*").order("date", { ascending: false }),
    supabase.from("invoices_received").select("*").order("date", { ascending: false }),
    supabase.from("profiles").select("*").order("full_name"),
  ];
}

async function loadAll() {
  const tableNames = [
    "clients",
    "income",
    "expenses",
    "tasks",
    "savings_funds",
    "savings_moves",
    "credit_payments",
    "invoices_issued",
    "invoices_received",
    "profiles",
  ];
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
  const [
    { data: clients },
    { data: income },
    { data: expenses },
    { data: tasks },
    { data: savingsFunds },
    { data: savingsMoves },
    { data: creditPayments },
    { data: invoicesIssued },
    { data: invoicesReceived },
    { data: profiles },
  ] = results;
  state.clients = clients || [];
  state.income = income || [];
  state.expenses = expenses || [];
  state.tasks = tasks || [];
  state.savingsFunds = savingsFunds || [];
  state.savingsMoves = savingsMoves || [];
  state.creditPayments = creditPayments || [];
  state.invoicesIssued = invoicesIssued || [];
  state.invoicesReceived = invoicesReceived || [];
  state.profiles = profiles || [];
}

function clientName(id) {
  const c = state.clients.find((c) => c.id === id);
  return c ? c.name : "—";
}

// ---- Guardar con manejo de errores: si Supabase rechaza el insert/update
// (por ejemplo porque falta correr el SQL de esa tabla), avisa en vez de
// fallar en silencio. Regresa true si se guardó bien, false si no. ----
// En los registros NUEVOS (sin id) le ponemos owner_id = tu usuario, para
// que las políticas de privacidad sepan que es tuyo (esto es indispensable
// desde que existen cuentas de colaborador — sin esto, el insert lo
// rechaza Supabase).
async function saveRow(table, id, row) {
  const payload = id ? row : { ...row, owner_id: state.currentUserId };
  const { error } = id
    ? await supabase.from(table).update(row).eq("id", id)
    : await supabase.from(table).insert(payload);
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
  renderFacturasView();
  renderHistoricoDetalle();
  renderDashboard();
  renderInicioView();
  applyMobileTableLabels();
}

// En móvil cada tabla se ve como una lista de tarjetas (una por fila) con
// pares etiqueta/valor en vez de columnas angostas con scroll horizontal.
// Esta función toma la etiqueta de cada tarjeta directamente del <th> real
// de cada tabla, así que no hay que tocar cada render*View() por separado.
function applyMobileTableLabels() {
  document.querySelectorAll(".data-table").forEach((table) => {
    const headers = Array.from(table.querySelectorAll("thead th")).map((th) => th.textContent.trim());
    table.querySelectorAll("tbody tr").forEach((tr) => {
      Array.from(tr.children).forEach((td, i) => {
        if (td.hasAttribute("colspan")) return;
        if (headers[i]) td.setAttribute("data-label", headers[i]);
        // La etiqueta de arriba (::before, solo visible en móvil) vive en el
        // propio <td>. Si el <td> trae la clase de privacidad "ing-amount",
        // el filtro de blur del CSS difumina TODO el elemento — incluida la
        // etiqueta generada por ::before, que quedaría ilegible. Por eso
        // movemos esa clase a un <span> interno que envuelve solo el valor:
        // así el blur tapa el dato, pero la etiqueta ("FECHA", "MONTO"...)
        // se sigue viendo bien.
        if (td.classList.contains("ing-amount")) {
          td.classList.remove("ing-amount");
          const inner = document.createElement("span");
          inner.className = "ing-amount";
          while (td.firstChild) inner.appendChild(td.firstChild);
          td.appendChild(inner);
        }
      });
    });
  });
}

// ============================================================
// INICIO / BIENVENIDA
// ============================================================
function renderInicioView() {
  const nombreCompleto = (state.currentProfile && state.currentProfile.full_name) || "";
  const primerNombreInicio = nombreCompleto.trim().split(" ")[0];
  document.getElementById("inicio-saludo").textContent = `${saludoSegunHora()}${primerNombreInicio ? ", " + primerNombreInicio : ""}`;
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
  if (!creditoConfigurado()) {
    document.getElementById("inicio-credito").innerHTML = `
      <div class="stat-row"><span class="muted">Configura el día de corte y de pago de tu tarjeta en "Mi perfil" para ver esto aquí.</span></div>
    `;
  } else {
    const proximoCorte = proximaFechaDelMes(getCorteDay());
    const proximoPago = proximaFechaDelMes(getDueDay());
    const diasCorte = diasEntreHoyY(proximoCorte);
    const diasPago = diasEntreHoyY(proximoPago);
    const actual = currentCorteKey();
    const saldoActual = totalCorte(actual) - pagadoCorte(actual);

    document.getElementById("inicio-credito").innerHTML = `
      <div class="stat-row"><span>Próximo corte</span><span class="amount">${fechaCortaES(proximoCorte)} (en ${diasCorte} día${diasCorte === 1 ? "" : "s"})</span></div>
      <div class="stat-row"><span>Próximo pago</span><span class="amount ${diasPago <= 3 ? "negative" : ""}">${fechaCortaES(proximoPago)} (en ${diasPago} día${diasPago === 1 ? "" : "s"})</span></div>
      <div class="stat-row"><span>Saldo actual del corte</span><span class="amount ing-amount">${money(saldoActual)}</span></div>
    `;
  }

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
  const facturaClienteEl = document.getElementById("factura-emitida-cliente");
  if (facturaClienteEl) facturaClienteEl.innerHTML = opts;
}

function renderClientesView() {
  const tbody = document.getElementById("tabla-clientes");
  const esDueno = state.currentProfile && state.currentProfile.role === "owner";
  // Cuentas que se pueden vincular a un cliente: no son el dueño, y no están
  // ya vinculadas a OTRO cliente distinto de este.
  const perfiles = state.profiles || [];
  tbody.innerHTML = state.clients
    .map((c) => {
      const vinculado = perfiles.find((p) => p.client_id === c.id);
      let portalCell;
      if (vinculado) {
        portalCell = `<span class="ing-amount">${vinculado.full_name || vinculado.email || "Cuenta vinculada"}</span>`;
        if (esDueno) {
          portalCell += ` <button class="btn-delete btn-desvincular" data-client-id="${c.id}" data-profile-id="${vinculado.id}">Desvincular</button>`;
        }
      } else if (esDueno) {
        const disponibles = perfiles.filter((p) => p.role !== "owner" && !p.client_id);
        if (disponibles.length) {
          const opts = disponibles
            .map((p) => `<option value="${p.id}">${p.full_name || p.email}</option>`)
            .join("");
          portalCell = `
            <select class="select-vincular" data-client-id="${c.id}">
              <option value="">— Elegir cuenta —</option>
              ${opts}
            </select>
            <button class="btn-edit btn-vincular" data-client-id="${c.id}">Vincular</button>`;
        } else {
          portalCell = `<span class="muted">Sin cuentas disponibles</span>`;
        }
      } else {
        portalCell = `<span class="muted">—</span>`;
      }
      return `
    <tr>
      <td class="ing-amount">${c.name}</td>
      <td>${c.notes || ""}</td>
      <td>${c.active ? "Sí" : "No"}</td>
      <td>${portalCell}</td>
      <td>
        <button class="btn-edit" data-id="${c.id}" data-kind="clients">Editar</button>
        <button class="btn-delete" data-id="${c.id}" data-kind="clients">Eliminar</button>
      </td>
    </tr>`;
    })
    .join("");

  tbody.querySelectorAll(".btn-vincular").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const clientId = btn.dataset.clientId;
      const select = tbody.querySelector(`.select-vincular[data-client-id="${clientId}"]`);
      const profileId = select ? select.value : "";
      if (!profileId) return;
      const { error } = await supabase.from("profiles").update({ role: "client", client_id: clientId }).eq("id", profileId);
      if (error) {
        alert("No se pudo vincular la cuenta: " + error.message);
        return;
      }
      await loadAll();
      renderAll();
    });
  });

  tbody.querySelectorAll(".btn-desvincular").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const profileId = btn.dataset.profileId;
      if (!confirm("¿Quitarle a esta cuenta el acceso al portal de este cliente?")) return;
      const { error } = await supabase.from("profiles").update({ role: "member", client_id: null }).eq("id", profileId);
      if (error) {
        alert("No se pudo desvincular la cuenta: " + error.message);
        return;
      }
      await loadAll();
      renderAll();
    });
  });
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
    moveButtons.push(`<button class="kanban-move-btn" data-id="${t.id}" data-to="Cancelado">✕ Cancelar</button>`);
  } else if (t.status === "En curso") {
    moveButtons.push(`<button class="kanban-move-btn" data-id="${t.id}" data-to="Pendiente">← Pendiente</button>`);
    moveButtons.push(`<button class="kanban-move-btn" data-id="${t.id}" data-to="Hecho">→ Hecho</button>`);
    moveButtons.push(`<button class="kanban-move-btn" data-id="${t.id}" data-to="Cancelado">✕ Cancelar</button>`);
  } else if (t.status === "Hecho") {
    moveButtons.push(`<button class="kanban-move-btn" data-id="${t.id}" data-to="En curso">← Reabrir</button>`);
  } else if (t.status === "Cancelado") {
    moveButtons.push(`<button class="kanban-move-btn" data-id="${t.id}" data-to="Pendiente">← Reabrir</button>`);
  }
  return `
    <div class="kanban-card" draggable="true" data-id="${t.id}">
      <div class="kanban-card-title">${t.title}</div>
      <div class="kanban-card-meta">
        <span class="priority-tag ${t.priority}">${t.priority}</span>
        <span>${t.category}</span>
        ${t.client_id ? `<span class="ing-amount">${clientName(t.client_id)}</span>` : ""}
        ${t.due_date ? `<span>${fechaTareaHTML(t)}</span>` : ""}
      </div>
      <div class="kanban-card-actions">
        ${moveButtons.join("")}
        ${t.due_date && t.status !== "Hecho" && (t.owner_id === state.currentUserId || (state.currentProfile && state.currentProfile.role === "owner")) ? `<button class="btn-calendar" data-id="${t.id}" data-kind="task">📅 Calendario</button>` : ""}
        <button class="btn-edit" data-id="${t.id}" data-kind="tasks">Editar</button>
        <button class="btn-delete" data-id="${t.id}" data-kind="tasks">Eliminar</button>
      </div>
    </div>`;
}

function renderTareasView() {
  const porEstado = { Pendiente: [], "En curso": [], Hecho: [], Cancelado: [] };
  state.tasks.forEach((t) => {
    if (porEstado[t.status]) porEstado[t.status].push(t);
  });

  porEstado["Pendiente"].sort(sortByDue);
  porEstado["En curso"].sort(sortByDue);
  const hechoOrdenado = porEstado["Hecho"]
    .slice()
    .sort((a, b) => (b.due_date || "").localeCompare(a.due_date || ""))
    .slice(0, 15);
  const canceladoOrdenado = porEstado["Cancelado"]
    .slice()
    .sort((a, b) => (b.due_date || "").localeCompare(a.due_date || ""))
    .slice(0, 15);

  document.getElementById("count-pendiente").textContent = porEstado["Pendiente"].length;
  document.getElementById("count-encurso").textContent = porEstado["En curso"].length;
  document.getElementById("count-hecho").textContent = porEstado["Hecho"].length;
  document.getElementById("count-cancelado").textContent = porEstado["Cancelado"].length;

  document.getElementById("kanban-pendiente").innerHTML =
    porEstado["Pendiente"].map(tareaCardHTML).join("") || `<p class="muted">Sin tareas aquí. 🎉</p>`;
  document.getElementById("kanban-encurso").innerHTML =
    porEstado["En curso"].map(tareaCardHTML).join("") || `<p class="muted">Sin tareas aquí.</p>`;
  document.getElementById("kanban-hecho").innerHTML =
    hechoOrdenado.map(tareaCardHTML).join("") || `<p class="muted">Sin tareas aquí todavía.</p>`;
  document.getElementById("kanban-cancelado").innerHTML =
    canceladoOrdenado.map(tareaCardHTML).join("") || `<p class="muted">Sin tareas canceladas.</p>`;
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
      <td class="ing-amount">${t.client_id ? clientName(t.client_id) : "—"}</td>
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

// ---- Arrastrar y soltar tarjetas de tareas entre columnas ----
document.addEventListener("dragstart", (e) => {
  const card = e.target.closest && e.target.closest(".kanban-card");
  if (!card) return;
  card.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", card.dataset.id);
});

document.addEventListener("dragend", (e) => {
  const card = e.target.closest && e.target.closest(".kanban-card");
  if (!card) return;
  card.classList.remove("dragging");
  document.querySelectorAll(".kanban-dropzone.drag-over").forEach((z) => z.classList.remove("drag-over"));
});

document.querySelectorAll(".kanban-dropzone").forEach((zone) => {
  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    zone.classList.add("drag-over");
  });
  zone.addEventListener("dragleave", (e) => {
    if (e.target === zone) zone.classList.remove("drag-over");
  });
  zone.addEventListener("drop", async (e) => {
    e.preventDefault();
    zone.classList.remove("drag-over");
    const id = e.dataTransfer.getData("text/plain");
    const column = zone.closest(".kanban-column");
    const to = column && column.dataset.status;
    if (!id || !to) return;
    const tarea = state.tasks.find((t) => String(t.id) === String(id));
    if (tarea && tarea.status === to) return;
    await supabase.from("tasks").update({ status: to }).eq("id", id);
    await loadAll();
    renderAll();
  });
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
      <td class="ing-amount">${clientName(i.client_id)}</td>
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
      <td class="ing-amount">${g.client_id ? clientName(g.client_id) : "—"}</td>
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

// La tarjeta de crédito es personal — aunque como dueño veas todo lo demás
// del negocio, aquí cada quien (tú incluido) solo ve y agrega a su propio
// calendario los gastos y pagos de SU tarjeta, nunca los de otra persona.
function gastosCreditoDelCorte(periodKey) {
  if (!periodKey) return []; // sin corte configurado, no hay nada que agrupar
  const uid = creditoViewUserId();
  return state.expenses.filter(
    (g) =>
      g.payment_method === "Tarjeta de crédito" &&
      g.owner_id === uid &&
      cortePeriodKey(g.date) === periodKey
  );
}

function totalCorte(periodKey) {
  return gastosCreditoDelCorte(periodKey).reduce((s, g) => s + Number(g.amount || 0), 0);
}

function pagadoCorte(periodKey) {
  if (!periodKey) return 0;
  const uid = creditoViewUserId();
  return state.creditPayments
    .filter((p) => p.period_key === periodKey && p.owner_id === uid)
    .reduce((s, p) => s + Number(p.amount || 0), 0);
}

function allCortePeriods() {
  const uid = creditoViewUserId();
  const keys = new Set([currentCorteKey()]);
  state.expenses.forEach((g) => {
    if (g.payment_method === "Tarjeta de crédito" && g.owner_id === uid && g.date)
      keys.add(cortePeriodKey(g.date));
  });
  state.creditPayments.forEach((p) => {
    if (p.owner_id === uid) keys.add(p.period_key);
  });
  return Array.from(keys).sort((a, b) => b.localeCompare(a));
}

// El selector "ver como" solo lo arma/usa el dueño — para cualquier otro
// rol se queda oculto y creditoViewUserId() siempre regresa la suya propia.
function renderCreditoVerComoSelector() {
  const wrap = document.getElementById("credito-ver-como-wrap");
  const sel = document.getElementById("credito-ver-como");
  if (!wrap || !sel) return;

  const esDueño = state.currentProfile && state.currentProfile.role === "owner";
  wrap.hidden = !esDueño;
  if (!esDueño) {
    state.creditoViewAsId = null;
    return;
  }

  const otros = state.profiles.filter((p) => p.id !== state.currentUserId && p.role !== "client");
  const opciones =
    `<option value="">Yo mismo</option>` +
    otros.map((p) => `<option value="${p.id}">${p.full_name || p.email || "Sin nombre"}</option>`).join("");
  if (sel.innerHTML !== opciones) sel.innerHTML = opciones;
  sel.value = state.creditoViewAsId || "";
}

document.getElementById("credito-ver-como").addEventListener("change", (e) => {
  state.creditoViewAsId = e.target.value || null;
  renderCreditoView();
});

function renderCreditoView() {
  renderCreditoVerComoSelector();

  const viendoOtro = creditoViewUserId() !== state.currentUserId;
  const notaOtro = document.getElementById("credito-viendo-otro-nota");
  const registrarWrap = document.getElementById("credito-registrar-pago-wrap");
  const btnCalCreditoEl = document.getElementById("btn-add-credito-calendar");
  if (notaOtro) notaOtro.hidden = !viendoOtro;
  if (registrarWrap) registrarWrap.hidden = viendoOtro;
  if (btnCalCreditoEl) btnCalCreditoEl.hidden = viendoOtro;

  const sinConfigurar = document.getElementById("credito-sin-configurar");
  const configWrap = document.getElementById("credito-config-wrap");
  if (!creditoConfigurado()) {
    if (sinConfigurar) {
      sinConfigurar.hidden = false;
      const p = sinConfigurar.querySelector("p");
      if (p) {
        p.textContent = viendoOtro
          ? "Esta persona todavía no configura el día de corte y el día límite de pago de su tarjeta en su propio perfil."
          : "Pon el día de corte y el día límite de pago de tu tarjeta en \"Mi perfil\" (barra lateral, donde sale tu nombre) para activar esta sección.";
      }
    }
    if (configWrap) configWrap.hidden = true;
    return;
  }
  if (sinConfigurar) sinConfigurar.hidden = true;
  if (configWrap) configWrap.hidden = false;

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
      .filter((p) => p.owner_id === creditoViewUserId())
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
// FACTURAS (emitidas a clientes + recibidas de proveedores)
// ============================================================
document.getElementById("factura-emitida-fecha").value = todayISO();
document.getElementById("factura-recibida-fecha").value = todayISO();

function facturaEmitidaMontos(f) {
  const subtotal = Number(f.subtotal || 0);
  const ivaAmount = f.iva_amount != null ? Number(f.iva_amount) : (subtotal * Number(f.iva_rate || 0)) / 100;
  const isrAmount = f.isr_amount != null ? Number(f.isr_amount) : (subtotal * Number(f.isr_rate || 0)) / 100;
  const total = subtotal + ivaAmount - isrAmount;
  return { subtotal, ivaAmount, isrAmount, total };
}

function facturaRecibidaMontos(f) {
  const subtotal = Number(f.subtotal || 0);
  const ivaAmount = f.iva_amount != null ? Number(f.iva_amount) : (subtotal * Number(f.iva_rate || 0)) / 100;
  const total = subtotal + ivaAmount;
  return { subtotal, ivaAmount, total };
}

// ---- RESICO: tabla de tasas de ISR (Art. 113-E LISR, personas físicas) ----
// La tasa se determina según el ingreso ACUMULADO del año (desde enero), y esa
// tasa se aplica sobre lo COBRADO en el mes en curso para el pago provisional.
const RESICO_ISR_BRACKETS = [
  { max: 25000, rate: 1.0 },
  { max: 50000, rate: 1.1 },
  { max: 83333.33, rate: 1.5 },
  { max: 208333.33, rate: 2.0 },
  { max: 291666.66, rate: 2.5 },
  { max: Infinity, rate: 2.5 }, // por si el acumulado supera el tope de RESICO, referencia con la tasa más alta
];

function resicoIsrRate(ingresoAcumuladoAnio) {
  const bracket = RESICO_ISR_BRACKETS.find((b) => ingresoAcumuladoAnio <= b.max);
  return bracket ? bracket.rate : RESICO_ISR_BRACKETS[RESICO_ISR_BRACKETS.length - 1].rate;
}

function renderFacturasView() {
  // ---- Resumen IVA/ISR ----
  const ivaTrasladado = state.invoicesIssued.reduce((s, f) => s + facturaEmitidaMontos(f).ivaAmount, 0);
  const isrRetenido = state.invoicesIssued.reduce((s, f) => s + facturaEmitidaMontos(f).isrAmount, 0);
  const ivaAcreditable = state.invoicesReceived.reduce((s, f) => s + facturaRecibidaMontos(f).ivaAmount, 0);
  const ivaNeto = ivaTrasladado - ivaAcreditable;

  document.getElementById("kpi-iva-trasladado").textContent = moneyExact(ivaTrasladado);
  document.getElementById("kpi-iva-acreditable").textContent = moneyExact(ivaAcreditable);
  document.getElementById("kpi-iva-neto").textContent = moneyExact(Math.abs(ivaNeto));
  document.getElementById("kpi-iva-neto-label").textContent = ivaNeto >= 0 ? "IVA a pagar" : "IVA a favor";
  document.getElementById("kpi-isr-retenido").textContent = moneyExact(isrRetenido);
  document.getElementById("facturas-resumen-nota").textContent =
    "El % de IVA/ISR de cada factura se captura manualmente porque varía según el cliente (ej. con clientes que solo retienen ISR, deja el % de IVA en 0).";

  // ---- ISR retenido (a tu favor) vs. ISR que tú pagas (pago provisional RESICO) ----
  // Este panel solo aplica a quien tributa en RESICO. Si el perfil no tiene
  // régimen configurado (cuentas viejas, como la de Eduardo) se sigue mostrando
  // para no romper lo que ya existía; si el régimen es otro, se oculta.
  const regimenActual = (state.currentProfile && state.currentProfile.tax_regime) || null;
  const resicoPanel = document.getElementById("resico-panel");
  if (regimenActual && regimenActual !== "RESICO") {
    if (resicoPanel) resicoPanel.hidden = true;
  } else {
    if (resicoPanel) resicoPanel.hidden = false;
    const periodo = currentPeriodKey(); // "YYYY-MM"
    const anioActual = periodo.slice(0, 4);
    const emitidasCobradas = state.invoicesIssued.filter((f) => f.status === "Cobrada" && f.date);
    const ingresoMes = emitidasCobradas
      .filter((f) => f.date.slice(0, 7) === periodo)
      .reduce((s, f) => s + facturaEmitidaMontos(f).subtotal, 0);
    const ingresoAcumuladoAnio = emitidasCobradas
      .filter((f) => f.date.slice(0, 4) === anioActual)
      .reduce((s, f) => s + facturaEmitidaMontos(f).subtotal, 0);
    const tasaResico = resicoIsrRate(ingresoAcumuladoAnio);
    const isrCausadoMes = (ingresoMes * tasaResico) / 100;
    const isrRetenidoMes = emitidasCobradas
      .filter((f) => f.date.slice(0, 7) === periodo)
      .reduce((s, f) => s + facturaEmitidaMontos(f).isrAmount, 0);
    const isrNetoAPagar = isrCausadoMes - isrRetenidoMes;

    document.getElementById("facturas-isr-resico").innerHTML = `
      <div class="stat-row"><span>Ingresos cobrados este mes</span><span class="amount ing-amount">${moneyExact(ingresoMes)}</span></div>
      <div class="stat-row"><span>Ingreso acumulado del año (define tu tasa)</span><span class="amount ing-amount">${moneyExact(ingresoAcumuladoAnio)}</span></div>
      <div class="stat-row"><span>Tasa RESICO aplicable</span><span class="amount ing-amount">${tasaResico}%</span></div>
      <div class="stat-row"><span>ISR causado del mes (tasa × cobrado)</span><span class="amount ing-amount">${moneyExact(isrCausadoMes)}</span></div>
      <div class="stat-row"><span>− ISR retenido este mes (a tu favor)</span><span class="amount ing-amount">${moneyExact(isrRetenidoMes)}</span></div>
      <div class="stat-row"><span><strong>${isrNetoAPagar >= 0 ? "ISR neto a pagar" : "ISR a favor (saldo para el próximo mes)"}</strong></span><span class="amount ing-amount ${isrNetoAPagar >= 0 ? "negative" : "positive"}"><strong>${moneyExact(Math.abs(isrNetoAPagar))}</strong></span></div>
    `;
  }

  // ---- Tabla: emitidas ----
  const emitidasOrdenadas = state.invoicesIssued.slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  document.getElementById("tabla-facturas-emitidas").innerHTML =
    emitidasOrdenadas
      .map((f) => {
        const { subtotal, ivaAmount, isrAmount, total } = facturaEmitidaMontos(f);
        return `
    <tr>
      <td>${f.date || "—"}</td>
      <td class="ing-amount">${clientName(f.client_id)}</td>
      <td class="ing-amount">${f.folio || "—"}</td>
      <td class="ing-amount">${moneyExact(subtotal)}</td>
      <td class="ing-amount">${moneyExact(ivaAmount)} <span class="muted">(${f.iva_rate || 0}%)</span></td>
      <td class="ing-amount">${moneyExact(isrAmount)} <span class="muted">(${f.isr_rate || 0}%)</span></td>
      <td class="ing-amount">${moneyExact(total)}</td>
      <td><span class="invoiced-tag ${f.status === "Cobrada" ? "si" : "no"}">${f.status || "Pendiente"}</span></td>
      <td>
        <button class="btn-edit" data-id="${f.id}" data-kind="invoices_issued">Editar</button>
        <button class="btn-delete" data-id="${f.id}" data-kind="invoices_issued">Eliminar</button>
      </td>
    </tr>`;
      })
      .join("") || `<tr><td colspan="9" class="muted">Todavía no registras facturas emitidas.</td></tr>`;

  // ---- Tabla: recibidas ----
  const recibidasOrdenadas = state.invoicesReceived.slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  document.getElementById("tabla-facturas-recibidas").innerHTML =
    recibidasOrdenadas
      .map((f) => {
        const { subtotal, ivaAmount, total } = facturaRecibidaMontos(f);
        return `
    <tr>
      <td>${f.date || "—"}</td>
      <td class="ing-amount">${f.provider}</td>
      <td class="ing-amount">${f.folio || "—"}</td>
      <td class="ing-amount">${moneyExact(subtotal)}</td>
      <td class="ing-amount">${moneyExact(ivaAmount)} <span class="muted">(${f.iva_rate || 0}%)</span></td>
      <td class="ing-amount">${moneyExact(total)}</td>
      <td><span class="invoiced-tag ${f.status === "Pagada" ? "si" : "no"}">${f.status || "Pendiente"}</span></td>
      <td>
        <button class="btn-edit" data-id="${f.id}" data-kind="invoices_received">Editar</button>
        <button class="btn-delete" data-id="${f.id}" data-kind="invoices_received">Eliminar</button>
      </td>
    </tr>`;
      })
      .join("") || `<tr><td colspan="8" class="muted">Todavía no registras facturas recibidas.</td></tr>`;
}

function resetFacturaEmitidaForm() {
  const perfil = state.currentProfile || {};
  const ivaDefault = perfil.default_iva_rate != null ? perfil.default_iva_rate : 16;
  const isrDefault = perfil.default_isr_rate != null ? perfil.default_isr_rate : 1.25;
  document.getElementById("form-factura-emitida").reset();
  document.getElementById("factura-emitida-id").value = "";
  document.getElementById("factura-emitida-fecha").value = todayISO();
  document.getElementById("factura-emitida-iva-rate").value = String(ivaDefault);
  document.getElementById("factura-emitida-isr-rate").value = String(isrDefault);
  document.getElementById("factura-emitida-submit-btn").textContent = "Agregar factura";
  document.getElementById("factura-emitida-cancel-btn").hidden = true;
}

document.getElementById("form-factura-emitida").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("factura-emitida-id").value;
  const subtotal = parseFloat(document.getElementById("factura-emitida-subtotal").value) || 0;
  const ivaRate = parseFloat(document.getElementById("factura-emitida-iva-rate").value) || 0;
  const isrRate = parseFloat(document.getElementById("factura-emitida-isr-rate").value) || 0;
  const row = {
    client_id: document.getElementById("factura-emitida-cliente").value,
    folio: document.getElementById("factura-emitida-folio").value.trim(),
    date: document.getElementById("factura-emitida-fecha").value,
    subtotal,
    iva_rate: ivaRate,
    iva_amount: (subtotal * ivaRate) / 100,
    isr_rate: isrRate,
    isr_amount: (subtotal * isrRate) / 100,
    status: document.getElementById("factura-emitida-estatus").value,
    notes: document.getElementById("factura-emitida-notas").value.trim(),
  };
  if (!row.client_id) return;
  const ok = await saveRow("invoices_issued", id, row);
  if (!ok) return;
  resetFacturaEmitidaForm();
  await loadAll();
  renderAll();
});

document.getElementById("factura-emitida-cancel-btn").addEventListener("click", resetFacturaEmitidaForm);

function resetFacturaRecibidaForm() {
  document.getElementById("form-factura-recibida").reset();
  document.getElementById("factura-recibida-id").value = "";
  document.getElementById("factura-recibida-fecha").value = todayISO();
  document.getElementById("factura-recibida-iva-rate").value = "16";
  document.getElementById("factura-recibida-submit-btn").textContent = "Agregar factura";
  document.getElementById("factura-recibida-cancel-btn").hidden = true;
}

document.getElementById("form-factura-recibida").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("factura-recibida-id").value;
  const total = parseFloat(document.getElementById("factura-recibida-total").value) || 0;
  const ivaRate = parseFloat(document.getElementById("factura-recibida-iva-rate").value) || 0;
  // El usuario captura el TOTAL de la factura (como viene impreso, con IVA incluido).
  // Sacamos el IVA "hacia atrás": subtotal = total / (1 + tasa), iva = total - subtotal.
  const subtotal = ivaRate ? total / (1 + ivaRate / 100) : total;
  const ivaAmount = total - subtotal;
  const row = {
    provider: document.getElementById("factura-recibida-proveedor").value.trim(),
    folio: document.getElementById("factura-recibida-folio").value.trim(),
    date: document.getElementById("factura-recibida-fecha").value,
    subtotal,
    iva_rate: ivaRate,
    iva_amount: ivaAmount,
    status: document.getElementById("factura-recibida-estatus").value,
    notes: document.getElementById("factura-recibida-notas").value.trim(),
  };
  if (!row.provider) return;
  const ok = await saveRow("invoices_received", id, row);
  if (!ok) return;
  resetFacturaRecibidaForm();
  await loadAll();
  renderAll();
});

document.getElementById("factura-recibida-cancel-btn").addEventListener("click", resetFacturaRecibidaForm);

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
  } else if (kind === "invoices_issued") {
    const f = state.invoicesIssued.find((x) => x.id === id);
    if (!f) return;
    document.getElementById("factura-emitida-id").value = f.id;
    document.getElementById("factura-emitida-cliente").value = f.client_id || "";
    document.getElementById("factura-emitida-folio").value = f.folio || "";
    document.getElementById("factura-emitida-fecha").value = f.date || todayISO();
    document.getElementById("factura-emitida-subtotal").value = f.subtotal;
    document.getElementById("factura-emitida-iva-rate").value = f.iva_rate;
    document.getElementById("factura-emitida-isr-rate").value = f.isr_rate;
    document.getElementById("factura-emitida-estatus").value = f.status || "Pendiente";
    document.getElementById("factura-emitida-notas").value = f.notes || "";
    document.getElementById("factura-emitida-submit-btn").textContent = "Guardar cambios";
    document.getElementById("factura-emitida-cancel-btn").hidden = false;
    switchView("facturas");
    document.getElementById("form-factura-emitida").scrollIntoView({ behavior: "smooth", block: "center" });
  } else if (kind === "invoices_received") {
    const f = state.invoicesReceived.find((x) => x.id === id);
    if (!f) return;
    document.getElementById("factura-recibida-id").value = f.id;
    document.getElementById("factura-recibida-proveedor").value = f.provider || "";
    document.getElementById("factura-recibida-folio").value = f.folio || "";
    document.getElementById("factura-recibida-fecha").value = f.date || todayISO();
    document.getElementById("factura-recibida-total").value = Number(f.subtotal || 0) + Number(f.iva_amount || 0);
    document.getElementById("factura-recibida-iva-rate").value = f.iva_rate;
    document.getElementById("factura-recibida-estatus").value = f.status || "Pendiente";
    document.getElementById("factura-recibida-notas").value = f.notes || "";
    document.getElementById("factura-recibida-submit-btn").textContent = "Guardar cambios";
    document.getElementById("factura-recibida-cancel-btn").hidden = false;
    switchView("facturas");
    document.getElementById("form-factura-recibida").scrollIntoView({ behavior: "smooth", block: "center" });
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
      <td class="ing-amount">${clientName(i.client_id)}</td>
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
      <td class="ing-amount">${g.client_id ? clientName(g.client_id) : "—"}</td>
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
  if (creditoConfigurado()) {
    const saldoCreditoActual = totalCorte(currentCorteKey()) - pagadoCorte(currentCorteKey());
    document.getElementById("kpi-credito").textContent = money(saldoCreditoActual);
  } else {
    document.getElementById("kpi-credito").textContent = "—";
  }

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
          `<div class="stat-row"><span class="ing-amount">${u.name}</span><span class="amount ing-amount ${u.utilidad >= 0 ? "positive" : "negative"}">${money(u.utilidad)}</span></div>`
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
          `<div class="stat-row"><span>${t.title}${t.client_id ? ` — <span class="ing-amount">${clientName(t.client_id)}</span>` : ""}</span><span class="amount">${fechaTareaHTML(t)}</span></div>`
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
// PRIVACIDAD (ocultar montos con blur + contraseña — 100% opcional, cada
// quien la activa configurando su propia contraseña en "Mi perfil". Quien
// no la configura nunca ve nada oculto ni ve el botón.)
// ============================================================
const PRIVACY_KEY = "obitoae_privacy_hidden";
const privacyBtn = document.getElementById("btn-privacy-toggle");

function privacyEnabledForUser() {
  return !!(state.currentProfile && state.currentProfile.privacy_password);
}

function isPrivacyOn() {
  if (!privacyEnabledForUser()) return false; // sin contraseña propia, nunca se oculta nada
  const v = localStorage.getItem(PRIVACY_KEY);
  return v === "1"; // visible por default — solo se oculta si tú lo activaste antes en este dispositivo
}

function setPrivacy(on) {
  appEl.classList.toggle("privacy-on", on);
  localStorage.setItem(PRIVACY_KEY, on ? "1" : "0");
  if (privacyBtn) privacyBtn.textContent = on ? "🙈 Montos ocultos" : "🙈 Ocultar mis montos";
}

// Vuelve a evaluar si este usuario tiene la privacidad habilitada (se llama
// después de cargar/actualizar el perfil, y al cerrar sesión).
function refreshPrivacyUI() {
  const enabled = privacyEnabledForUser();
  if (privacyBtn) privacyBtn.hidden = !enabled;
  setPrivacy(isPrivacyOn());
}

if (privacyBtn) {
  privacyBtn.addEventListener("click", () => {
    if (!privacyEnabledForUser()) return;
    if (isPrivacyOn()) {
      const pass = prompt("Tu contraseña de privacidad para ver tus montos:");
      if (pass === null) return;
      const personal = state.currentProfile && state.currentProfile.privacy_password;
      if (!personal || pass !== personal) {
        alert("Contraseña incorrecta.");
        return;
      }
      setPrivacy(false);
    } else {
      setPrivacy(true);
    }
  });
}

refreshPrivacyUI();

// ============================================================
// INICIO
// ============================================================
checkSession();
