-- PAI account + entitlement foundation for Supabase.
-- Run once in the Supabase SQL editor.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  plan text not null default 'free' check (plan in ('free','pro')),
  founding_supporter boolean not null default false,
  founding_supporter_purchased_at timestamptz,
  paypal_payer_id text,
  pro_subscription_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_events (
  id bigint generated always as identity primary key,
  payment_event_id text not null unique,
  provider text not null default 'paypal',
  event_type text not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.payment_events enable row level security;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
on public.profiles for select
to authenticated
using (auth.uid() = id);

-- Browser clients never write plan/entitlement fields. Those are updated only
-- by the trusted payment backend through the Supabase service-role key.

create or replace function public.handle_new_pai_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_pai on auth.users;
create trigger on_auth_user_created_pai
after insert on auth.users
for each row execute procedure public.handle_new_pai_user();
