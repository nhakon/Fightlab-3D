create table if not exists public.fightlab_user_playback_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  saved_playbacks jsonb not null default '[]'::jsonb,
  playback_folders jsonb not null default '[]'::jsonb,
  saved_presets jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.fightlab_user_playback_data
  add column if not exists saved_presets jsonb not null default '[]'::jsonb;

alter table public.fightlab_user_playback_data enable row level security;

drop policy if exists "fightlab_user_playback_data_select_own" on public.fightlab_user_playback_data;
create policy "fightlab_user_playback_data_select_own"
on public.fightlab_user_playback_data
for select
using (auth.uid() = user_id);

drop policy if exists "fightlab_user_playback_data_insert_own" on public.fightlab_user_playback_data;
create policy "fightlab_user_playback_data_insert_own"
on public.fightlab_user_playback_data
for insert
with check (auth.uid() = user_id);

drop policy if exists "fightlab_user_playback_data_update_own" on public.fightlab_user_playback_data;
create policy "fightlab_user_playback_data_update_own"
on public.fightlab_user_playback_data
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "fightlab_user_playback_data_delete_own" on public.fightlab_user_playback_data;
create policy "fightlab_user_playback_data_delete_own"
on public.fightlab_user_playback_data
for delete
using (auth.uid() = user_id);

create or replace function public.set_fightlab_user_playback_data_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_fightlab_user_playback_data_updated_at on public.fightlab_user_playback_data;
create trigger set_fightlab_user_playback_data_updated_at
before update on public.fightlab_user_playback_data
for each row
execute function public.set_fightlab_user_playback_data_updated_at();
