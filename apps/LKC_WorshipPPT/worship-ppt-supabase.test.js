const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('./worship-ppt-supabase.js');

test('reads and normalizes the PPT Library index from Supabase', async () => {
  const previousSupabase = global._supabase;
  const calls = [];
  const query = {
    select(fields) {
      calls.push(['select', fields]);
      return this;
    },
    order(field, options) {
      calls.push(['order', field, options]);
      return Promise.resolve({
        data: [{
          file_id: 'drive-247',
          kind: 'hymn',
          number: '247',
          title: '主耶穌，我欲倚靠祢',
          file_name: '第247首 主耶穌，我欲倚靠祢.pptx'
        }],
        error: null
      });
    }
  };
  global._supabase = {
    from(table) {
      calls.push(['from', table]);
      return query;
    }
  };

  try {
    assert.deepEqual(await service.cal_getPptLibraryIndex(), {
      success: true,
      data: [{
        fileId: 'drive-247',
        kind: 'hymn',
        number: '247',
        title: '主耶穌，我欲倚靠祢',
        fileName: '第247首 主耶穌，我欲倚靠祢.pptx'
      }]
    });
    assert.deepEqual(calls, [
      ['from', 'worship_ppt_library_index'],
      ['select', '*'],
      ['order', 'number', { ascending: true }]
    ]);
  } finally {
    if (previousSupabase === undefined) delete global._supabase;
    else global._supabase = previousSupabase;
  }
});

test('returns null for an unavailable or empty PPT Library index so GAS can be used', async () => {
  const previousSupabase = global._supabase;
  global._supabase = {
    from() {
      return {
        select() { return this; },
        order() { return Promise.resolve({ data: [], error: null }); }
      };
    }
  };

  try {
    assert.equal(await service.cal_getPptLibraryIndex(), null);
  } finally {
    if (previousSupabase === undefined) delete global._supabase;
    else global._supabase = previousSupabase;
  }
});
