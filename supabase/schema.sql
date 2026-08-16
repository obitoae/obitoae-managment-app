-- Obitoae Management — esquema completo
-- Este archivo es ACUMULATIVO y SEGURO DE VOLVER A CORRER cuantas veces quieras:
-- todas las tablas usan "if not exists" y todas las políticas se borran y se
-- vuelven a crear, así que no truena aunque ya lo hayas corrido antes.
-- Ejecutar completo en Supabase: panel del proyecto → SQL Editor → New query → pegar → Run

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

drop policy if exists "authenticated_all_clients" on clients;
create policy "authenticated_all_clients" on clients
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "authenticated_all_income" on income;
create policy "authenticated_all_income" on income
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "authenticated_all_expenses" on expenses;
create policy "authenticated_all_expenses" on expenses
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create index if not exists income_date_idx on income(date);
create index if not exists income_client_idx on income(client_id);
create index if not exists expenses_date_idx on expenses(date);
create index if not exists expenses_client_idx on expenses(client_id);

-- =========================================================
-- Tareas (reemplaza la base de Tareas de Notion)
-- =========================================================
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default 'Trabajo',     -- Trabajo / Personal
  client_id uuid references clients(id) on delete set null,
  status text not null default 'Pendiente',     -- Pendiente / En curso / Hecho
  priority text not null default 'Media',       -- Alta / Media / Baja
  due_date date,
  created_at timestamptz not null default now()
);

alter table tasks enable row level security;

drop policy if exists "authenticated_all_tasks" on tasks;
create policy "authenticated_all_tasks" on tasks
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create index if not exists tasks_status_idx on tasks(status);
create index if not exists tasks_due_date_idx on tasks(due_date);
create index if not exists tasks_client_idx on tasks(client_id);

-- =========================================================
-- Control de facturación (Ingresos y Gastos)
-- =========================================================
alter table income add column if not exists invoiced boolean not null default false;
alter table income add column if not exists invoice_folio text;
alter table income add column if not exists invoice_date date;

alter table expenses add column if not exists invoiced boolean not null default false;
alter table expenses add column if not exists invoice_folio text;
alter table expenses add column if not exists invoice_date date;

-- =========================================================
-- Ahorro (fondos + movimientos)
-- =========================================================
create table if not exists savings_funds (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  goal_amount numeric,                          -- meta, opcional
  created_at timestamptz not null default now()
);

create table if not exists savings_moves (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references savings_funds(id) on delete cascade,
  type text not null default 'Depósito',        -- Depósito / Retiro
  amount numeric not null default 0,
  date date not null default current_date,
  note text,
  created_at timestamptz not null default now()
);

alter table savings_funds enable row level security;
alter table savings_moves enable row level security;

drop policy if exists "authenticated_all_savings_funds" on savings_funds;
create policy "authenticated_all_savings_funds" on savings_funds
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "authenticated_all_savings_moves" on savings_moves;
create policy "authenticated_all_savings_moves" on savings_moves
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create index if not exists savings_moves_fund_idx on savings_moves(fund_id);
create index if not exists savings_moves_date_idx on savings_moves(date);

-- =========================================================
-- Tarjeta de crédito (cortes y pagos quincenales)
-- =========================================================
create table if not exists credit_payments (
  id uuid primary key default gen_random_uuid(),
  period_key text not null,                     -- "YYYY-MM" = corte que cierra el día 26 de ese mes
  amount numeric not null default 0,
  date date not null default current_date,
  note text,
  created_at timestamptz not null default now()
);

alter table credit_payments enable row level security;

drop policy if exists "authenticated_all_credit_payments" on credit_payments;
create policy "authenticated_all_credit_payments" on credit_payments
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create index if not exists credit_payments_period_idx on credit_payments(period_key);

-- =========================================================
-- Facturas emitidas (a tus clientes) y recibidas (de proveedores)
-- Sirve para llevar el control de IVA trasladado/acreditable e ISR
-- retenido, ya que cada cliente puede tener un tratamiento fiscal
-- distinto (ej. algunos solo retienen ISR y no aplican IVA).
-- =========================================================
create table if not exists invoices_issued (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete set null,
  folio text,
  date date not null default current_date,
  subtotal numeric not null default 0,
  iva_rate numeric not null default 16,          -- porcentaje, ej. 16 = 16%
  iva_amount numeric not null default 0,
  isr_rate numeric not null default 0,           -- porcentaje retenido, ej. 1.25 = 1.25%
  isr_amount numeric not null default 0,
  status text not null default 'Pendiente',      -- Pendiente / Cobrada
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists invoices_received (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  expense_id uuid references expenses(id) on delete set null,
  folio text,
  date date not null default current_date,
  subtotal numeric not null default 0,
  iva_rate numeric not null default 16,
  iva_amount numeric not null default 0,
  status text not null default 'Pendiente',      -- Pendiente / Pagada
  notes text,
  created_at timestamptz not null default now()
);

alter table invoices_issued enable row level security;
alter table invoices_received enable row level security;

drop policy if exists "authenticated_all_invoices_issued" on invoices_issued;
create policy "authenticated_all_invoices_issued" on invoices_issued
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "authenticated_all_invoices_received" on invoices_received;
create policy "authenticated_all_invoices_received" on invoices_received
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create index if not exists invoices_issued_date_idx on invoices_issued(date);
create index if not exists invoices_issued_client_idx on invoices_issued(client_id);
create index if not exists invoices_received_date_idx on invoices_received(date);
