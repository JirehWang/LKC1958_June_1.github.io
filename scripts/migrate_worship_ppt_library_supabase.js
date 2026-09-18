const { Client } = require('pg');

function getDatabaseConfig(env = process.env) {
  if (String(env.SUPABASE_DB_URL || '').trim()) {
    return {
      connectionString: env.SUPABASE_DB_URL,
      ssl: { rejectUnauthorized: false }
    };
  }

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

async function migrate() {
  const client = new Client(getDatabaseConfig());
  try {
    await client.connect();
    const ddl = `
      -- PPTX 不進 Supabase；這張表只保存「如何找到原始 PPTX」的索引。
      CREATE TABLE IF NOT EXISTS public.worship_ppt_library_index (
          kind TEXT NOT NULL,
          number TEXT NOT NULL,
          file_id TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          file_name TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_by TEXT DEFAULT 'ppt-library-sync',
          PRIMARY KEY (kind, number)
      );

      CREATE INDEX IF NOT EXISTS worship_ppt_library_index_file_id_idx
        ON public.worship_ppt_library_index (file_id);

      ALTER TABLE public.worship_ppt_library_index ENABLE ROW LEVEL SECURITY;

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies
          WHERE schemaname = 'public'
            AND tablename = 'worship_ppt_library_index'
            AND policyname = 'allow_anon_ppt_library_index_select'
        ) THEN
          CREATE POLICY allow_anon_ppt_library_index_select
            ON public.worship_ppt_library_index
            FOR SELECT TO anon, authenticated USING (true);
        END IF;
      END $$;

      GRANT SELECT ON public.worship_ppt_library_index TO anon, authenticated, service_role;
    `;

    await client.query(ddl);
    console.log('Worship PPT Library index migration completed.');
  } finally {
    await client.end().catch(() => {});
  }
}

if (require.main === module) {
  try {
    require('dotenv').config();
  } catch (error) {
    if (error && error.code !== 'MODULE_NOT_FOUND') throw error;
  }
  migrate().catch(error => {
    console.error('Worship PPT Library index migration failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { getDatabaseConfig, migrate };
