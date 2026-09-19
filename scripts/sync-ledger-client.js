'use strict';

const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 500;
const DEFAULT_BATCH_SIZE = 50;

function sleep(ms) {
  if (!ms) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

function ensureUrl(url) {
  const value = String(url || '').trim();
  if (!value) throw new Error('缺少 SYNC_LEDGER_GAS_URL');
  return value;
}

function ensureSuccess(payload, action) {
  if (!payload || payload.success !== true) {
    const message = payload && (payload.error || payload.message);
    throw new Error('GAS sync ledger ' + action + ' 失敗' + (message ? '：' + message : ''));
  }
  return payload.data === undefined ? payload : payload.data;
}

class SyncLedgerClient {
  constructor(options = {}) {
    this.url = ensureUrl(options.url);
    this.token = String(options.token || '').trim();
    if (!this.token) throw new Error('缺少 SYNC_LEDGER_GAS_TOKEN');
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') throw new Error('找不到 fetch 實作');
    this.retryAttempts = Math.max(1, Number(options.retryAttempts || DEFAULT_RETRY_ATTEMPTS));
    this.retryDelayMs = Math.max(0, Number(options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS));
    this.batchSize = Math.max(1, Number(options.batchSize || DEFAULT_BATCH_SIZE));
    this.timeoutMs = Math.max(0, Number(options.timeoutMs || 30000));
  }

  async post(action, data = {}) {
    let lastError;
    for (let attempt = 1; attempt <= this.retryAttempts; attempt += 1) {
      let timer;
      let controller;
      try {
        if (typeof AbortController === 'function' && this.timeoutMs > 0) {
          controller = new AbortController();
          timer = setTimeout(() => controller.abort(), this.timeoutMs);
        }

        const result = await this.fetchImpl(this.url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action, token: this.token, data }),
          signal: controller ? controller.signal : undefined
        });
        if (!result || result.ok === false) {
          throw new Error('HTTP ' + (result && result.status ? result.status : '錯誤'));
        }
        const payload = await result.json();
        return ensureSuccess(payload, action);
      } catch (error) {
        lastError = error;
        if (attempt < this.retryAttempts) {
          await sleep(this.retryDelayMs * attempt);
        }
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    throw lastError || new Error('GAS sync ledger ' + action + ' 失敗');
  }

  startRun(run) {
    return this.post('syncLedger_startRun', run);
  }

  async appendItems(runId, items = []) {
    const rows = Array.isArray(items) ? items : [];
    const results = [];
    for (let index = 0; index < rows.length; index += this.batchSize) {
      results.push(await this.post('syncLedger_appendItems', {
        runId,
        items: rows.slice(index, index + this.batchSize)
      }));
    }
    return results;
  }

  finishRun(runId, summary, error) {
    return this.post('syncLedger_finishRun', {
      runId,
      summary: summary || {},
      error: error ? String(error) : ''
    });
  }

  recordEvent(event) {
    return this.post('syncLedger_recordEvent', event || {});
  }

  async enqueueRepairs(runId, items = []) {
    const rows = Array.isArray(items) ? items : [];
    const results = [];
    for (let index = 0; index < rows.length; index += this.batchSize) {
      results.push(await this.post('syncLedger_enqueueRepairs', {
        runId,
        items: rows.slice(index, index + this.batchSize)
      }));
    }
    return results;
  }

  getHealth() {
    return this.post('syncLedger_getHealth');
  }
}

module.exports = {
  DEFAULT_BATCH_SIZE,
  DEFAULT_RETRY_ATTEMPTS,
  DEFAULT_RETRY_DELAY_MS,
  SyncLedgerClient,
  ensureSuccess
};
