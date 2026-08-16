// Endpoint para registrar GASTOS por voz desde Atajos/Siri — mismo patrón e
// idéntica seguridad que api/add-task.js (mismo token, mismas variables de
// Supabase; no necesitas agregar nada nuevo en Vercel).
//
// Body esperado (JSON): { amount: number, description: string, payment_method?: string, client_name?: string }
//
// payment_method (opcional): "Transferencia", "Efectivo", "Tarjeta de débito",
// "Tarjeta de crédito" u "Otro" (igual que el formulario de la app). Si mandas
// otra cosa (o la dictas distinto, ej. "tarjeta"), se intenta hacer match
// flexible; si no coincide con nada, se guarda tal cual lo dictaste.
//
// Cliente: si en la descripción mencionas el nombre de un cliente ya
// guardado (ej. "Gasolina para entrega de Yerman"), se detecta solo y se
// vincula — no hace falta mandarlo aparte. También puedes mandar
// client_name explícito si lo prefieres.

function todayMX() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
}

const METODOS_PAGO_GASTO = ["Transferencia", "Efectivo", "Tarjeta de débito", "Tarjeta de crédito", "Otro"];

function normalizarMetodoPago(str, opciones) {
  if (!str || typeof str !== "string") return null;
  const limpio = str.trim();
  if (!limpio) return null;
  const limpioLower = limpio.toLowerCase();
  const exacto = opciones.find((o) => o.toLowerCase() === limpioLower);
  if (exacto) return exacto;
  // Coincidencias flexibles para lo que la gente suele decir al dictar
  if (/tarjeta.*d(e|é)bito|d(e|é)bito/.test(limpioLower)) return "Tarjeta de débito";
  if (/tarjeta.*cr(e|é)dito|cr(e|é)dito/.test(limpioLower)) return "Tarjeta de crédito";
  if (/tarjeta/.test(limpioLower)) return "Tarjeta de débito";
  if (/transferencia|deposito|dep(o|ó)sito/.test(limpioLower)) return "Transferencia";
  if (/efectivo|cash/.test(limpioLower)) return "Efectivo";
  return limpio; // se guarda tal cual si no reconocemos nada
}

async function buscarClienteEnTexto(SUPABASE_URL, SERVICE_KEY, texto) {
  if (!texto) return null;
  try {
    const url = `${SUPABASE_URL}/rest/v1/clients?select=id,name&limit=200`;
    const r = await fetch(url, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
    if (!r.ok) return null;
    const clients = await r.json();
    const textoLower = texto.toLowerCase();
    for (const c of clients) {
      if (!c.name) continue;
      const nameLower = String(c.name).toLowerCase().trim();
      if (!nameLower) continue;
      if (textoLower.includes(nameLower)) return c.id;
      const firstWord = nameLower.split(/\s+/)[0];
      if (firstWord && firstWord.length >= 3) {
        const escaped = firstWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(`\\b${escaped}\\b`, "i");
        if (re.test(textoLower)) return c.id;
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Usa POST." });
    return;
  }

  const token = req.headers["x-task-token"];
  const expectedToken = process.env.TASK_API_TOKEN;
  if (!expectedToken || !token || token !== expectedToken) {
    res.status(403).json({ ok: false, error: "Token inválido." });
    return;
  }

  const body = req.body || {};
  const amount = parseFloat(body.amount);
  const description = String(body.description || "").trim();

  if (!description) {
    res.status(400).json({ ok: false, error: "Falta la descripción del gasto." });
    return;
  }
  if (!isFinite(amount) || amount <= 0) {
    res.status(400).json({ ok: false, error: "El monto debe ser un número mayor a 0." });
    return;
  }
  if (description.length > 300) {
    res.status(400).json({ ok: false, error: "La descripción es demasiado larga (máx. 300 caracteres)." });
    return;
  }

  const paymentMethod = normalizarMetodoPago(body.payment_method, METODOS_PAGO_GASTO);

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    res.status(500).json({ ok: false, error: "Faltan variables de entorno de Supabase en Vercel." });
    return;
  }

  try {
    const clientId = body.client_name
      ? await buscarClienteEnTexto(SUPABASE_URL, SERVICE_KEY, String(body.client_name))
      : await buscarClienteEnTexto(SUPABASE_URL, SERVICE_KEY, description);

    const r = await fetch(`${SUPABASE_URL}/rest/v1/expenses`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        description,
        category: "Otro",
        client_id: clientId,
        detail: null,
        amount,
        recurrence: "Único",
        payment_method: paymentMethod,
        date: todayMX(),
      }),
    });

    if (!r.ok) {
      const detail = await r.text();
      res.status(502).json({ ok: false, error: "Supabase rechazó la inserción.", detail });
      return;
    }

    const [inserted] = await r.json();
    const metodoTexto = paymentMethod ? ` (${paymentMethod})` : "";
    res.status(200).json({
      ok: true,
      id: inserted && inserted.id,
      message: `Gasto agregado: $${amount} — ${description}${metodoTexto}`,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
};
