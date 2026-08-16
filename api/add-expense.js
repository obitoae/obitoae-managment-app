// Endpoint para registrar GASTOS por voz desde Atajos/Siri — mismo patrón e
// idéntica seguridad que api/add-task.js (mismo token, mismas variables de
// Supabase; no necesitas agregar nada nuevo en Vercel).
//
// Body esperado (JSON): { amount: number, description: string, client_name?: string }
// client_name es opcional: si mandas un nombre y coincide con un cliente
// existente (aunque sea parcial, ej. "Yerman"), la app lo vincula solo.

function todayMX() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
}

async function buscarClientePorNombre(SUPABASE_URL, SERVICE_KEY, nombre) {
  if (!nombre) return null;
  const url = `${SUPABASE_URL}/rest/v1/clients?select=id,name&name=ilike.*${encodeURIComponent(nombre)}*&limit=1`;
  const r = await fetch(url, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows && rows[0] ? rows[0].id : null;
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

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    res.status(500).json({ ok: false, error: "Faltan variables de entorno de Supabase en Vercel." });
    return;
  }

  try {
    const clientId = await buscarClientePorNombre(SUPABASE_URL, SERVICE_KEY, body.client_name);

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
        payment_method: null,
        date: todayMX(),
      }),
    });

    if (!r.ok) {
      const detail = await r.text();
      res.status(502).json({ ok: false, error: "Supabase rechazó la inserción.", detail });
      return;
    }

    const [inserted] = await r.json();
    res.status(200).json({
      ok: true,
      id: inserted && inserted.id,
      message: `Gasto agregado: $${amount} — ${description}`,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
};
