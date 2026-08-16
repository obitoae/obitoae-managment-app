// Endpoint para registrar INGRESOS por voz desde Atajos/Siri — mismo patrón
// e idéntica seguridad que api/add-task.js (mismo token, mismas variables
// de Supabase; no necesitas agregar nada nuevo en Vercel).
//
// Body esperado (JSON): { amount: number, service: string, client_name?: string }
// client_name es opcional: si mandas un nombre y coincide con un cliente
// existente (aunque sea parcial, ej. "Yerman"), la app lo vincula solo.
// El IVA lo dejamos en 0 — lo editas luego desde la app si aplica.

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
  const service = String(body.service || "").trim();

  if (!service) {
    res.status(400).json({ ok: false, error: "Falta la descripción del ingreso (campo 'service')." });
    return;
  }
  if (!isFinite(amount) || amount <= 0) {
    res.status(400).json({ ok: false, error: "El monto debe ser un número mayor a 0." });
    return;
  }
  if (service.length > 300) {
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

    const r = await fetch(`${SUPABASE_URL}/rest/v1/income`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        client_id: clientId,
        service,
        type: "Otro",
        amount,
        iva: 0,
        payment_method: null,
        is_recurring: false,
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
      message: `Ingreso agregado: $${amount} — ${service}`,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
};
