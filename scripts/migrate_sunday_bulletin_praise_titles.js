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

async function migrate() {
  const client = new Client(getDatabaseConfig());
  try {
    await client.connect();
    const ddl = [
      'CREATE TABLE IF NOT EXISTS public.sunday_bulletin_praise_titles (',
      '  title TEXT PRIMARY KEY,',
      '  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),',
      '  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),',
      '  updated_by TEXT DEFAULT \'praise-title-index\'',
      ');',
      '',
      'INSERT INTO public.sunday_bulletin_praise_titles (title, created_at, updated_at, updated_by)',
      'SELECT trim(title), COALESCE(min(created_at), now()), COALESCE(max(updated_at), now()), \'migration\'',
      'FROM public.sunday_bulletin_praise',
      'WHERE trim(title) <> \'\'',
      'GROUP BY trim(title)',
      'ON CONFLICT (title) DO NOTHING;',
      '',
      'ALTER TABLE public.sunday_bulletin_praise_titles ENABLE ROW LEVEL SECURITY;',
      '',
      'DO $$',
      'BEGIN',
      '  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = \'sunday_bulletin_praise_titles\' AND policyname = \'allow_anon_praise_title_index_select\') THEN',
      '    CREATE POLICY allow_anon_praise_title_index_select ON public.sunday_bulletin_praise_titles FOR SELECT TO anon, authenticated USING (true);',
      '  END IF;',
      '  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = \'sunday_bulletin_praise_titles\' AND policyname = \'allow_anon_praise_title_index_insert\') THEN',
      '    CREATE POLICY allow_anon_praise_title_index_insert ON public.sunday_bulletin_praise_titles FOR INSERT TO anon, authenticated WITH CHECK (true);',
      '  END IF;',
      '  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = \'sunday_bulletin_praise_titles\' AND policyname = \'allow_anon_praise_title_index_update\') THEN',
      '    CREATE POLICY allow_anon_praise_title_index_update ON public.sunday_bulletin_praise_titles FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);',
      '  END IF;',
      'END $$;',
      '',
      'GRANT SELECT, INSERT, UPDATE ON public.sunday_bulletin_praise_titles TO anon, authenticated, service_role;'
    ].join('\n');

    await client.query(ddl);
    console.log('Praise title index migration completed.');
  } finally {
    await client.end().catch(() => {});
  }
}

if (require.main === module) {
  migrate().catch(error => {
    console.error('Praise title index migration failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { getDatabaseConfig, migrate };
