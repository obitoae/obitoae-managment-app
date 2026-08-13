-- Retórica OS (Eduardo) — esquema Fase 1: Clientes + Finanzas
-- Ejecutar esto completo en Supabase: panel del proyecto → SQL Editor → New query → pegar → Run

create extension if not exists "pgcrypto";

-- =========================================================
-- Clientes
-- =========================================================
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- =========================================================
-- Ingresos
-- =========================================================
create table if not exists income (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete set null,
  service text not null,
  type text not null default 'Otro',           -- "canal de origen" (ej. Freelance, Retainer, Proyecto)
  amount numeric not null default 0,
  iva numeric not null default 0,
  payment_method text,
  is_recurring boolean not null default false,
  date date not null default current_date,
  created_at timestamptz not null default now()
);

-- =========================================================
-- Gastos
-- =========================================================
create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  description text not null,
  category text not null default 'Otro',
  client_id uuid references clients(id) on delete set null,
  detail text,
  amount numeric not null default 0,
  recurrence text not null default 'Único',     -- Único / Mensual / Semanal / Anual
  payment_method text,
  date date not null default current_date,
  created_at timestamptz not null default now()
);

-- =========================================================
-- Seguridad: solo usuarios autenticados (tú) pueden leer/escribir.
-- No hay registro público en la app — tu usuario se crea manualmente
-- en Supabase (Authentication → Users → Add user).
-- =========================================================
alter table clients enable row level security;
alter table income enable row level security;
alter table expenses enable row level security;

create policy "authenticated_all_clients" on clients
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "authenticated_all_income" on income
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "authenticated_all_expenses" on expenses
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create index if not exists income_date_idx on income(date);
create index if not exists income_client_idx on income(client_id);
create index if not exists expenses_date_idx on expenses(date);
create index if not exists expenses_client_idx on expenses(client_id);
