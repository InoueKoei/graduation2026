-- ============================================================
--  kana_lines — 字と線の表（KanaDance）
--  身振りスケッチ（sketch/）が書き、KanaDance が読む。1字1行。
--  座標は別の表（poses）。2つは letter で突き合わせるだけ。
--
--  Supabase の SQL エディタで1回だけ流す。何度流しても壊れない。
-- ============================================================

create table if not exists public.kana_lines (
  letter     text primary key,                    -- 字（カタカナ1字）
  strokes    jsonb not null default '[]'::jsonb,  -- 一筆書きの線（例: ["LH-RH", "H-W"]）
  sketch     jsonb,                               -- 作図用の仮の点（身振りスケッチの姿勢。判定には使わない）
  updated_at timestamptz not null default now()
);

alter table public.kana_lines enable row level security;

-- poses と同じく、公開キー（anon）で読み書きできるようにする。
-- 公開キーはページのソースから誰でも読めるので、誰でも書き換えられる点は poses と同じ。
grant select, insert, update, delete on public.kana_lines to anon, authenticated;

drop policy if exists "kana_lines read"   on public.kana_lines;
drop policy if exists "kana_lines insert" on public.kana_lines;
drop policy if exists "kana_lines update" on public.kana_lines;
drop policy if exists "kana_lines delete" on public.kana_lines;

create policy "kana_lines read"   on public.kana_lines for select to anon, authenticated using (true);
create policy "kana_lines insert" on public.kana_lines for insert to anon, authenticated with check (true);
create policy "kana_lines update" on public.kana_lines for update to anon, authenticated using (true) with check (true);
create policy "kana_lines delete" on public.kana_lines for delete to anon, authenticated using (true);
