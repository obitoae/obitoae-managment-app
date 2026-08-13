# Obitoae Managment — app propia (Fase 1: Clientes + Ingresos + Gastos)

App web con el estilo del video de referencia: login, Clientes, Registrar ingreso/gasto,
historiales, y un Panel con concentración de ingresos por cliente, rentabilidad por canal,
proyección recurrente y utilidad por cliente.

Es un sitio 100% estático (HTML/CSS/JS, sin paso de "build") que se conecta directo a
Supabase (base de datos + login). Costo: $0/mes en los planes gratuitos de Vercel + Supabase
para uso de una sola persona.

## Paso 1 — Supabase (base de datos + login)

1. Entra a tu proyecto en [supabase.com](https://supabase.com).
2. Menú izquierdo → **SQL Editor** → **New query**.
3. Abre el archivo `supabase/schema.sql` de esta carpeta, copia TODO su contenido, pégalo ahí, y dale **Run**.
   Esto crea las tablas de Clientes, Ingresos y Gastos, ya protegidas (solo tú puedes leer/escribir).
4. Menú izquierdo → **Authentication** → **Users** → **Add user** → pon tu correo y una contraseña.
   Esa es la cuenta con la que vas a entrar a la app (no hay registro público, solo tú).
5. Menú izquierdo → **Settings** (⚙️) → **API** → copia:
   - **Project URL**
   - la llave **anon / public** (NO la "service_role", esa es secreta)

## Paso 2 — Conectar el código a tu Supabase

1. Abre el archivo `config.js` de esta carpeta.
2. Reemplaza `PON_AQUI_TU_PROJECT_URL` y `PON_AQUI_TU_ANON_PUBLIC_KEY` con los dos valores del paso anterior.
3. Guarda el archivo.

## Paso 3 — Subir el código a GitHub

1. Entra a [github.com](https://github.com) → botón verde **New** (nuevo repositorio).
2. Nómbralo, por ejemplo, `finanzas-app` → **Create repository**.
3. En la página del repo recién creado, click en **uploading an existing file** (o "Add file" → "Upload files").
4. Arrastra TODOS los archivos de esta carpeta (`index.html`, `style.css`, `app.js`, `config.js`, `README.md`, y la carpeta `supabase/`) → **Commit changes**.

## Paso 4 — Desplegar en Vercel (gratis)

1. Entra a [vercel.com](https://vercel.com) → **Add New** → **Project**.
2. Elige el repositorio `finanzas-app` que acabas de subir → **Import**.
3. Vercel va a detectar que es un sitio estático — no necesitas tocar nada en "Build settings", déjalo por defecto → **Deploy**.
4. En 30-60 segundos te da una dirección tipo `finanzas-app.vercel.app` — esa es tu app, ya accesible desde tu celular o cualquier dispositivo.

## Uso diario

- Entra con el correo/contraseña que creaste en el Paso 1.4.
- **Clientes**: da de alta ahí a un cliente antes de poder asignárselo a un ingreso o gasto.
- **Ingresos** / **Gastos**: registra cada movimiento — el Panel se actualiza solo.
- **Panel**: KPIs del mes, concentración de ingresos por cliente (con alerta si dependes >50% de uno solo), rentabilidad por canal, proyección recurrente mensual, y utilidad por cliente.

## Si algún día quieres cambiarle algo

Vuelve a esta conversación y dime qué quieres ajustar — yo edito el código y te doy los archivos actualizados; solo tienes que volver a subirlos a GitHub (Vercel los redespliega solo, en automático, cada vez que actualizas el repo).

## Próximas fases (cuando quieras)

Este es el arranque (Clientes + Finanzas). El video también tenía Proyectos, Tareas y un panel de "Salud de la empresa" — quedan pendientes para cuando quieras seguirle.
