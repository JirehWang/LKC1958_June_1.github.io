const { Client } = require('pg');

function getDatabaseConfig(env = process.env) {
  const required = ['SUPABASE_DB_USER', 'SUPABASE_DB_PASSWORD', 'SUPABASE_DB_HOST'];
  const missing = required.filter(name => !String(env[name] || '').trim());
  if (missing.length) {
    throw new Error('缺少 Supabase migration 環境變數：' + missing.join(', '));
  }

  const port = Number(env.SUPABASE_DB_PORT || 6543);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('SUPABASE_DB_PORT 必須是正整數');
  }

  return {
    user: env.SUPABASE_DB_USER,
    password: env.SUPABASE_DB_PASSWORD,
    host: env.SUPABASE_DB_HOST,
    port,
    database: env.SUPABASE_DB_NAME || 'postgres',
    ssl: { rejectUnauthorized: false }
  };
}

function buildMigrationSql() {
  return `
begin;

-- 歌曲本體只保存永久 UUID 與歌名；日期和歌詞由 GAS 管理。
alter table public.sunday_bulletin_praise_titles
  add column if not exists song_id uuid;

alter table public.sunday_bulletin_praise_titles
  add column if not exists deleted_at timestamptz;

alter table public.sunday_bulletin_praise_titles
  add column if not exists deleted_by text;

-- 既有歌名只補 UUID，不刪除、不搬移任何資料。
update public.sunday_bulletin_praise_titles
set song_id = gen_random_uuid()
where song_id is null;

alter table public.sunday_bulletin_praise_titles
  alter column song_id set default gen_random_uuid();

alter table public.sunday_bulletin_praise_titles
  alter column song_id set not null;

-- 將舊的 title 主鍵改成 song_id；若 migration 重跑，已是 UUID 主鍵時不動它。
do $$
declare
  title_pk_name text;
begin
  select c.conname
    into title_pk_name
  from pg_constraint c
  where c.conrelid = 'public.sunday_bulletin_praise_titles'::regclass
    and c.contype = 'p'
    and c.conkey = array[
      (select a.attnum
       from pg_attribute a
       where a.attrelid = c.conrelid
         and a.attname = 'title'
         and not a.attisdropped)
    ]::smallint[];

  if title_pk_name is not null then
    execute format(
      'alter table public.sunday_bulletin_praise_titles drop constraint %I',
      title_pk_name
    );
  end if;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.sunday_bulletin_praise_titles'::regclass
      and c.contype = 'p'
      and c.conkey = array[
        (select a.attnum
         from pg_attribute a
         where a.attrelid = c.conrelid
           and a.attname = 'song_id'
           and not a.attisdropped)
      ]::smallint[]
  ) then
    alter table public.sunday_bulletin_praise_titles
      add constraint sunday_bulletin_praise_titles_pkey primary key (song_id);
  end if;
end $$;

-- 有效歌名不可重複；已刪除歌曲可以保留歷史並以新 UUID 重新建立同名歌曲。
create unique index if not exists sunday_bulletin_praise_titles_active_title_uq
  on public.sunday_bulletin_praise_titles (lower(btrim(title)))
  where deleted_at is null;

-- 保留現有 RLS 與 grant；本 migration 不新增或擴大任何存取權限。

commit;
`;
}

async function migrate() {
  const client = new Client(getDatabaseConfig());
  try {
    await client.connect();
    await client.query(buildMigrationSql());
    console.log('Praise UUID migration completed.');
  } finally {
    await client.end().catch(() => {});
  }
}

if (require.main === module) {
  migrate().catch(error => {
    console.error('Praise UUID migration failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { getDatabaseConfig, buildMigrationSql, migrate };
