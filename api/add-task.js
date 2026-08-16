// Endpoint para crear tareas por voz desde un Atajo de iOS (Shortcuts) con
// Siri — pensado para capturar pendientes al vuelo sin abrir la app ni
// escribir nada. Ver instrucciones del Atajo en la conversación / README.
//
// Cómo funciona: Siri dicta el texto de la tarea → el Atajo hace un POST
// aquí con ese texto → esta función inserta la tarea directamente en
// Supabase (tabla "tasks", la misma que usa el tablero de la app) con
// estatus "Pendiente" y la fecha/hora de creación automática.
//
// Campos opcionales que puede mandar el Atajo (además de "title"):
//   due_date      → texto tipo "2026-08-20" (o cualquier cosa que empiece
//                    así, ej. "2026-08-20T00:00:00-06:00"). Si no viene o
//                    no tiene ese formato, la tarea queda sin fecha límite.
//   category       → "Trabajo" o "Personal" (default "Trabajo")
//   priority       → "Alta", "Media" o "Baja" (default "Media")
//
// Cliente: si el texto de la tarea (title) menciona el nombre de un
// cliente ya guardado en la app (ej. "Entregar video a Yerman"), esta
// función lo detecta solita y vincula la tarea a ese cliente — no hace
// falta que lo dictes aparte.
//
// Seguridad: esta función corre en el servidor, así que puede usar la
// "service role key" de Supabase (se salta el login/RLS). Por eso exige un
// token secreto en el header "x-task-token" — sin el token correcto, no
// hace nada. El texto de la tarea nunca queda en la URL (va en el cuerpo
// del POST), así no aparece expuesto en historiales/registros por accidente.
//
// Variables de entorno necesarias en Vercel (Project Settings → Environment
// Variables), NUNCA en el código ni en GitHub:
//   SUPABASE_URL              → misma URL que ya usas en config.js
//   SUPABASE_SERVICE_ROLE_KEY → Supabase → Settings → API Keys → "service_role" (secret)
//   TASK_API_TOKEN            → un texto largo y aleatorio (el que te dimos, o uno tuyo)

function normalizarFecha(str) {
  if (!str || typeof str !== "string") return null;
  const m = str.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
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
  const title = String(body.title || "").trim();
  if (!title) {
    res.status(400).json({ ok: false, error: "Falta el texto de la tarea (campo 'title')." });
    return;
  }
  if (title.length > 500) {
    res.status(400).json({ ok: false, error: "El texto de la tarea es demasiado largo (máx. 500 caracteres)." });
    return;
  }

  const CATEGORIAS_VALIDAS = ["Trabajo", "Personal"];
  const PRIORIDADES_VALIDAS = ["Alta", "Media", "Baja"];
  const category = CATEGORIAS_VALIDAS.includes(body.category) ? body.category : "Trabajo";
  const priority = PRIORIDADES_VALIDAS.includes(body.priority) ? body.priority : "Media";
  const dueDate = normalizarFecha(body.due_date);

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    res.status(500).json({ ok: false, error: "Faltan variables de entorno de Supabase en Vercel." });
    return;
  }

  try {
    const clientId = await buscarClienteEnTexto(SUPABASE_URL, SERVICE_KEY, title);

    const r = await fetch(`${SUPABASE_URL}/rest/v1/tasks`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        title,
        category,
        status: "Pendiente",
        priority,
        client_id: clientId,
        due_date: dueDate,
      }),
    });

    if (!r.ok) {
      const detail = await r.text();
      res.status(502).json({ ok: false, error: "Supabase rechazó la inserción.", detail });
      return;
    }

    const [inserted] = await r.json();
    const fechaTexto = dueDate ? ` (vence ${dueDate})` : "";
    res.status(200).json({
      ok: true,
      id: inserted && inserted.id,
      message: `Tarea agregada: ${title}${fechaTexto}`,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
};
