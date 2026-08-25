create table if not exists public.words (
  user_id uuid references auth.users on delete cascade not null,
  word text not null,
  status text not null check (status in ('unknown', 'known')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, word)
);

create table if not exists public.contexts (
  id uuid primary key,
  user_id uuid references auth.users on delete cascade not null,
  word text not null,
  sentence text not null,
  url text not null default '',
  title text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

drop trigger if exists words_updated_at on public.words;
create trigger words_updated_at before update on public.words
for each row execute function public.touch_updated_at();

drop trigger if exists contexts_updated_at on public.contexts;
create trigger contexts_updated_at before update on public.contexts
for each row execute function public.touch_updated_at();

alter table public.words enable row level security;
alter table public.contexts enable row level security;

drop policy if exists "own words" on public.words;
create policy "own words" on public.words for all to authenticated
using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own contexts" on public.contexts;
create policy "own contexts" on public.contexts for all to authenticated
using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.sync_clock()
returns timestamptz language sql security invoker
as $$ select clock_timestamp(); $$;

grant execute on function public.sync_clock() to authenticated;
