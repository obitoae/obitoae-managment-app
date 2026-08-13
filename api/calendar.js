// Feed de calendario (.ics) que se suscribe UNA vez en Google Calendar / Apple
// Calendar / Outlook y de ahí en adelante se actualiza solo: cada que tu
// calendario vuelve a pedir esta URL (lo hace automáticamente cada cierto
// tiempo), regresa las tareas pendientes con fecha de vencimiento más
// vigentes desde Supabase, junto con los recordatorios fijos de corte y pago
// de tarjeta de crédito.
//
// Seguridad: esta función corre en el servidor (nunca en el navegador del
// usuario), así que puede usar la "service role key" de Supabase — una llave
// secreta que se salta la seguridad por usuario (RLS) para poder leer los
// datos sin necesitar que el calendario haga login. Por eso la URL exige un
// "token" secreto largo (ver variables de entorno abajo): sin el token
// correcto, no regresa nada.
//
// Variables de entorno necesarias en Vercel (Project Settings → Environment
// Variables), NUNCA en el código ni en GitHub:
//   SUPABASE_URL              → misma URL que ya usas en config.js
//   SUPABASE_SERVICE_ROLE_KEY → Supabase → Settings → API Keys → "service_role" (secret)
//   CALENDAR_FEED_TOKEN       → un texto largo y aleatorio que tú inventes (o el que te dimos)

function icsEscape(text) {
  return String(text || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

module.exports = async (req, res) => {
  const token = req.query && req.query.token;
  const expectedToken = process.env.CALENDAR_FEED_TOKEN;

  if (!expectedToken || !token || token !== expectedToken) {
    res.status(403).send("Forbidden");
    return;
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  let tasks = [];
  if (SUPABASE_URL && SERVICE_KEY) {
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/tasks?select=id,title,due_date,status,priority&status=neq.Hecho&due_date=not.is.null&order=due_date.asc`,
        {
          headers: {
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
          },
        }
      );
      if (r.ok) {
        const data = await r.json();
        if (Array.isArray(data)) tasks = data;
      }
    } catch (e) {
      // Si Supabase falla, seguimos y regresamos al menos los recordatorios fijos de abajo.
    }
  }

  const dtstamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Obitoae Management//ES",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:Obitoae Management",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
  ];

  tasks.forEach((t) => {
    if (!t.due_date) return;
    const dt = String(t.due_date).replace(/-/g, "");
    lines.push(
      "BEGIN:VEVENT",
      `UID:task-${t.id}@obitoae-management`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${dt}`,
      `SUMMARY:${icsEscape("Tarea: " + t.title)}`,
      `DESCRIPTION:${icsEscape("Prioridad: " + (t.priority || ""))}`,
      "END:VEVENT"
    );
  });

  // Recordatorios fijos y recurrentes de tarjeta de crédito (no dependen de
  // Supabase): corte cierra el día 26, pago vence el día 5 del mes siguiente.
  lines.push(
    "BEGIN:VEVENT",
    "UID:corte-tarjeta-recurrente@obitoae-management",
    `DTSTAMP:${dtstamp}`,
    "DTSTART;VALUE=DATE:20240126",
    "RRULE:FREQ=MONTHLY;BYMONTHDAY=26",
    "SUMMARY:Corte de tarjeta de crédito",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:pago-tarjeta-recurrente@obitoae-management",
    `DTSTAMP:${dtstamp}`,
    "DTSTART;VALUE=DATE:20240205",
    "RRULE:FREQ=MONTHLY;BYMONTHDAY=5",
    "SUMMARY:Pago de tarjeta de crédito",
    "END:VEVENT"
  );

  lines.push("END:VCALENDAR");

  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=1800");
  res.status(200).send(lines.join("\r\n"));
};
