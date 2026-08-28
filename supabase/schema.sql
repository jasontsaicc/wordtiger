create table if not exists public.words (
  user_id uuid references auth.users on delete cascade not null,
  word text not null,
  status text not null check (status in ('unknown', 'known')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, word)
);

alter table public.words
  add column if not exists review_step integer not null default 0 check (review_step between 0 and 5),
  add column if not exists review_due_at timestamptz,
  -- FSRS 卡片整組狀態。欄位名對應 ts-fsrs 的 Card，Date 存成毫秒整數。
  add column if not exists fsrs_card jsonb,
  -- 收藏那天。null 代表按 X 排除，不是收藏，學習足跡不會算進「新收藏」。
  add column if not exists collected_at timestamptz;

create table if not exists public.contexts (
  id uuid not null,
  user_id uuid references auth.users on delete cascade not null,
  word text not null,
  sentence text not null,
  url text not null default '',
  title text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

create table if not exists public.lookup_cache (
  user_id uuid references auth.users on delete cascade not null,
  word text not null,
  payload text not null,
  model text,
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, word)
);

-- 打老虎逐次成績。只新增不修改，所以沒有 deleted_at，也不掛 updated_at trigger：
-- updated_at 停在寫入時間，重送同一列時不會被重新 pull 回來。
create table if not exists public.review_log (
  id uuid not null,
  user_id uuid references auth.users on delete cascade not null,
  word text not null,
  remembered boolean not null,
  at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- 主鍵只有 id 時，換帳號重傳同一個 uuid 會撞到別的帳號的列，RLS 擋下來會讓整輪同步失敗。
-- create table if not exists 不會回頭改既有資料表，所以舊部署要靠這段換成複合主鍵。
-- id 原本全域唯一，(user_id, id) 不可能有重複值，drop 後 add 一定成功。
alter table public.contexts drop constraint if exists contexts_pkey;
alter table public.contexts add primary key (user_id, id);
alter table public.review_log drop constraint if exists review_log_pkey;
alter table public.review_log add primary key (user_id, id);

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

drop trigger if exists lookup_cache_updated_at on public.lookup_cache;
create trigger lookup_cache_updated_at before update on public.lookup_cache
for each row execute function public.touch_updated_at();

-- 舊雲端資料沒有收藏事件，用跟本機 inferCollectedAt 相同的規則回填一次，
-- 否則全新裝置只會拉到 collected_at = null，學習足跡整段歷史都不見。
-- 必須排在 words_updated_at trigger 之後：靠它更新 updated_at，別台裝置才拉得到。
-- 只填 null 且判定為收藏過的列，不會把任何列寫成 null，因此可重複執行。
update public.words w
set collected_at = w.created_at
where w.collected_at is null
  and (
    w.status = 'unknown'
    or exists (select 1 from public.contexts c
               where c.user_id = w.user_id and c.word = w.word)
    or exists (select 1 from public.review_log r
               where r.user_id = w.user_id and r.word = w.word)
  );

alter table public.words enable row level security;
alter table public.contexts enable row level security;
alter table public.lookup_cache enable row level security;
alter table public.review_log enable row level security;

drop policy if exists "own words" on public.words;
create policy "own words" on public.words for all to authenticated
using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own contexts" on public.contexts;
create policy "own contexts" on public.contexts for all to authenticated
using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own lookup cache" on public.lookup_cache;
create policy "own lookup cache" on public.lookup_cache for all to authenticated
using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own review log" on public.review_log;
create policy "own review log" on public.review_log for all to authenticated
using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.sync_clock()
returns timestamptz language sql security invoker
as $$ select clock_timestamp(); $$;

grant execute on function public.sync_clock() to authenticated;
