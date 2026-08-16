// Endpoint para crear tareas por voz desde un Atajo de iOS (Shortcuts) con
// Siri — pensado para capturar pendientes al vuelo sin abrir la app ni
// escribir nada. Ver instrucciones del Atajo en la conversación / README.
//
// Cómo funciona: Siri dicta el texto de la tarea → el Atajo hace un POST
// aquí con ese texto → esta función inserta la tarea directamente en
// Supabase (tabla "tasks", la misma que usa el tablero de la app) con
// estatus "Pendiente" y la fecha/hora de creación automática.
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

  // Categoría/prioridad opcionales por si algún día quieres un Atajo distinto
  // para tareas personales vs. de trabajo; si no se mandan, usa valores
  // por default sensatos.
  const CATEGORIAS_VALIDAS = ["Trabajo", "Personal"];
  const PRIORIDADES_VALIDAS = ["Alta", "Media", "Baja"];
  const category = CATEGORIAS_VALIDAS.includes(body.category) ? body.category : "Trabajo";
  const priority = PRIORIDADES_VALIDAS.includes(body.priority) ? body.priority : "Media";

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    res.status(500).json({ ok: false, error: "Faltan variables de entorno de Supabase en Vercel." });
    return;
  }

  try {
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
        client_id: null,
        due_date: null,
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
      message: `Tarea agregada: ${title}`,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
};
