const { Client } = require('../node_modules/pg');

function getDatabaseConfig(env = process.env) {
  const required = ['SUPABASE_DB_USER', 'SUPABASE_DB_PASSWORD', 'SUPABASE_DB_HOST'];
  const missing = required.filter(name => !String(env[name] || '').trim());
  if (missing.length) {
    throw new Error(`缺少 Supabase migration 環境變數：${missing.join(', ')}`);
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

async function migrate() {
  let client;

  try {
    client = new Client(getDatabaseConfig());
    await client.connect();
    console.log('Connected to Supabase PostgreSQL database.');

    const ddl = `
      -- 1. 週報主存檔表 (Sunday Bulletins & Drafts)
      CREATE TABLE IF NOT EXISTS public.sunday_bulletins (
          date DATE PRIMARY KEY,
          service_type TEXT NOT NULL DEFAULT '台華語',
          taiwanese JSONB NOT NULL DEFAULT '{}'::jsonb,
          mandarin JSONB NOT NULL DEFAULT '{}'::jsonb,
          ministry JSONB NOT NULL DEFAULT '{}'::jsonb,
          attendance JSONB NOT NULL DEFAULT '{}'::jsonb,
          events JSONB NOT NULL DEFAULT '[]'::jsonb,
          announcements JSONB NOT NULL DEFAULT '[]'::jsonb,
          church_news JSONB NOT NULL DEFAULT '[]'::jsonb,
          prayer JSONB NOT NULL DEFAULT '{}'::jsonb,
          offering_report JSONB NOT NULL DEFAULT '{}'::jsonb,
          data JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_by TEXT DEFAULT 'bulletin-admin'
      );

      -- 2. 消息與代禱事項上傳表 (Sunday Bulletin Reports)
      CREATE TABLE IF NOT EXISTS public.sunday_bulletin_reports (
          date DATE PRIMARY KEY,
          announcements JSONB NOT NULL DEFAULT '[]'::jsonb,
          church_news JSONB NOT NULL DEFAULT '[]'::jsonb,
          prayer JSONB NOT NULL DEFAULT '{}'::jsonb,
          raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_by TEXT DEFAULT 'reports-admin'
      );

      -- 3. 讚美曲目與歌詞上傳表 (Sunday Bulletin Praise)
      CREATE TABLE IF NOT EXISTS public.sunday_bulletin_praise (
          date DATE PRIMARY KEY,
          title TEXT NOT NULL DEFAULT '',
          kicker TEXT NOT NULL DEFAULT '聖歌隊',
          lyrics TEXT NOT NULL DEFAULT '',
          raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_by TEXT DEFAULT 'praise-admin'
      );

      -- 4. 永久歌名索引：只保存歌名，完整歌詞與日期紀錄仍由 GAS 管理
      CREATE TABLE IF NOT EXISTS public.sunday_bulletin_praise_titles (
          title TEXT PRIMARY KEY,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_by TEXT DEFAULT 'praise-title-index'
      );

      -- 先把舊 Supabase 完整表中的歌名補入新索引；GAS 歷史資料由頁面首次載入時同步。
      INSERT INTO public.sunday_bulletin_praise_titles (title, created_at, updated_at, updated_by)
      SELECT
          trim(title),
          COALESCE(min(created_at), now()),
          COALESCE(max(updated_at), now()),
          'migration'
      FROM public.sunday_bulletin_praise
      WHERE trim(title) <> ''
      GROUP BY trim(title)
      ON CONFLICT (title) DO NOTHING;

      -- 啟用 RLS
      ALTER TABLE public.sunday_bulletins ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.sunday_bulletin_reports ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.sunday_bulletin_praise ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.sunday_bulletin_praise_titles ENABLE ROW LEVEL SECURITY;

      -- 建立或替換 RLS 政策 (允許 anon 與 authenticated 讀寫)
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sunday_bulletins' AND policyname = 'Allow anon all on sunday_bulletins') THEN
          CREATE POLICY "Allow anon all on sunday_bulletins" ON public.sunday_bulletins FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sunday_bulletin_reports' AND policyname = 'Allow anon all on sunday_bulletin_reports') THEN
          CREATE POLICY "Allow anon all on sunday_bulletin_reports" ON public.sunday_bulletin_reports FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sunday_bulletin_praise' AND policyname = 'Allow anon all on sunday_bulletin_praise') THEN
          CREATE POLICY "Allow anon all on sunday_bulletin_praise" ON public.sunday_bulletin_praise FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sunday_bulletin_praise_titles' AND policyname = 'Allow anon select on sunday_bulletin_praise_titles') THEN
          CREATE POLICY "Allow anon select on sunday_bulletin_praise_titles" ON public.sunday_bulletin_praise_titles FOR SELECT TO anon, authenticated USING (true);
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sunday_bulletin_praise_titles' AND policyname = 'Allow anon insert on sunday_bulletin_praise_titles') THEN
          CREATE POLICY "Allow anon insert on sunday_bulletin_praise_titles" ON public.sunday_bulletin_praise_titles FOR INSERT TO anon, authenticated WITH CHECK (true);
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sunday_bulletin_praise_titles' AND policyname = 'Allow anon update on sunday_bulletin_praise_titles') THEN
          CREATE POLICY "Allow anon update on sunday_bulletin_praise_titles" ON public.sunday_bulletin_praise_titles FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
        END IF;
      END $$;

      -- 授權 anon 與 authenticated 角色存取
      GRANT ALL ON public.sunday_bulletins TO anon, authenticated, service_role;
      GRANT ALL ON public.sunday_bulletin_reports TO anon, authenticated, service_role;
      GRANT ALL ON public.sunday_bulletin_praise TO anon, authenticated, service_role;
      GRANT SELECT, INSERT, UPDATE ON public.sunday_bulletin_praise_titles TO anon, authenticated, service_role;
    `;

    await client.query(ddl);
    console.log('Migration completed successfully: tables created and policies configured.');

    // 驗證建立結果
    const res = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name LIKE 'sunday_bulletin%'
      ORDER BY table_name;
    `);
    console.log('Verified tables:', res.rows.map(r => r.table_name));

    await client.end();
  } catch (err) {
    if (client) await client.end().catch(() => {});
    console.error('Migration failed:', err);
    process.exitCode = 1;
  }
}

if (require.main === module) migrate();

module.exports = { getDatabaseConfig, migrate };
