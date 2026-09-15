import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const RETENTION_MONTHS = 3;
export const DEFAULT_DATABASE_URL =
  'https://lkc1958june1-default-rtdb.asia-southeast1.firebasedatabase.app';
export const GOOGLE_TOKEN_URI = 'https://oauth2.googleapis.com/token';
export const FIREBASE_DATABASE_SCOPE = 'https://www.googleapis.com/auth/firebase.database';

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function pad(value, width = 2) {
  return String(value).padStart(width, '0');
}

function formatDateKey(year, monthIndex, day) {
  return String(year).padStart(4, '0')
    + '-' + pad(monthIndex + 1)
    + '-' + pad(day);
}

function daysInMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function assertValidDate(value, label) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError(label + ' must be a valid Date');
  }
}

function parseDateKey(value) {
  const key = String(value || '').trim();
  if (!DATE_KEY_RE.test(key)) return null;
  const date = new Date(key + 'T00:00:00.000Z');
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10) === key ? date : null;
}

export function getRetentionCutoffDateKey(now = new Date(), months = RETENTION_MONTHS) {
  assertValidDate(now, 'now');
  if (!Number.isInteger(months) || months < 1 || months > 120) {
    throw new RangeError('retention months must be an integer between 1 and 120');
  }

  const currentMonthIndex = now.getUTCMonth();
  const shiftedMonthIndex = currentMonthIndex - months;
  const targetYear = now.getUTCFullYear() + Math.floor(shiftedMonthIndex / 12);
  const targetMonthIndex = ((shiftedMonthIndex % 12) + 12) % 12;
  const targetDay = Math.min(
    now.getUTCDate(),
    daysInMonth(targetYear, targetMonthIndex)
  );
  return formatDateKey(targetYear, targetMonthIndex, targetDay);
}

export function getExpiredDateKeys(dateKeys, cutoffDateKey) {
  if (!parseDateKey(cutoffDateKey)) {
    throw new TypeError('cutoffDateKey must be a valid YYYY-MM-DD date');
  }

  return [...new Set((dateKeys || [])
    .map(value => String(value || '').trim())
    .filter(value => parseDateKey(value))
    .filter(value => value < cutoffDateKey))]
    .sort();
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function createServiceAccountAssertion(serviceAccount, now = new Date()) {
  assertValidDate(now, 'now');
  if (!serviceAccount || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON must contain client_email and private_key');
  }

  const issuedAt = Math.floor(now.getTime() / 1000);
  const unsigned = [
    base64UrlJson({ alg: 'RS256', typ: 'JWT' }),
    base64UrlJson({
      iss: serviceAccount.client_email,
      scope: FIREBASE_DATABASE_SCOPE,
      aud: GOOGLE_TOKEN_URI,
      iat: issuedAt,
      exp: issuedAt + 3600
    })
  ].join('.');
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  return unsigned + '.' + signer.sign(serviceAccount.private_key, 'base64url');
}

function readServiceAccount(env = process.env) {
  const raw = String(env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is required for log cleanup');
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON');
  }
}

async function getGoogleAccessToken(serviceAccount, fetchImpl = fetch, now = new Date()) {
  const assertion = createServiceAccountAssertion(serviceAccount, now);
  const response = await fetchImpl(GOOGLE_TOKEN_URI, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  if (!response.ok) {
    throw new Error('Google OAuth token request failed with HTTP ' + response.status);
  }
  const payload = await response.json();
  if (!payload || typeof payload.access_token !== 'string' || !payload.access_token) {
    throw new Error('Google OAuth token response did not contain access_token');
  }
  return payload.access_token;
}

function encodePathSegment(value) {
  return encodeURIComponent(String(value));
}

function buildDatabaseUrl(databaseUrl, path, query = {}) {
  const base = String(databaseUrl || DEFAULT_DATABASE_URL).replace(/\/+$/, '') + '/';
  const relativePath = String(path || '').replace(/^\/+/, '').replace(/\/+$/, '');
  const url = new URL(relativePath + '.json', base);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  });
  return url;
}

async function firebaseRequest(databaseUrl, path, accessToken, options = {}, fetchImpl = fetch) {
  const method = options.method || 'GET';
  const response = await fetchImpl(buildDatabaseUrl(databaseUrl, path, options.query), {
    method,
    headers: {
      accept: 'application/json',
      authorization: 'Bearer ' + accessToken,
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' })
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
  });
  if (!response.ok) {
    throw new Error('Firebase REST ' + method + ' failed with HTTP ' + response.status);
  }
  if (method === 'DELETE' || response.status === 204) return null;
  return response.json();
}

export async function cleanupObservabilityLogs(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const cutoffDateKey = getRetentionCutoffDateKey(now);
  const databaseUrl = options.databaseUrl || DEFAULT_DATABASE_URL;
  const fetchImpl = options.fetchImpl || fetch;
  const accessToken = options.accessToken
    || await getGoogleAccessToken(
      options.serviceAccount || readServiceAccount(options.env || process.env),
      fetchImpl,
      now
    );
  const dryRun = options.dryRun === true;
  const systems = await firebaseRequest(
    databaseUrl,
    'logs',
    accessToken,
    { query: { shallow: true } },
    fetchImpl
  );
  const systemIds = Object.keys(systems || {}).sort();
  const deleted = [];
  const planned = [];

  for (const systemId of systemIds) {
    const dateNodes = await firebaseRequest(
      databaseUrl,
      'logs/' + encodePathSegment(systemId),
      accessToken,
      { query: { shallow: true } },
      fetchImpl
    );
    const expiredDateKeys = getExpiredDateKeys(Object.keys(dateNodes || {}), cutoffDateKey);
    for (const dateKey of expiredDateKeys) {
      const target = { system: systemId, date: dateKey };
      planned.push(target);
      if (!dryRun) {
        await firebaseRequest(
          databaseUrl,
          'logs/' + encodePathSegment(systemId) + '/' + encodePathSegment(dateKey),
          accessToken,
          { method: 'DELETE' },
          fetchImpl
        );
        deleted.push(target);
      }
    }
  }

  return {
    retentionMonths: RETENTION_MONTHS,
    cutoffDateKey,
    systemsScanned: systemIds.length,
    planned,
    deleted
  };
}

async function main() {
  const result = await cleanupObservabilityLogs({
    dryRun: process.argv.includes('--dry-run')
  });
  console.log(JSON.stringify({
    retentionMonths: result.retentionMonths,
    cutoffDateKey: result.cutoffDateKey,
    systemsScanned: result.systemsScanned,
    plannedBuckets: result.planned.length,
    deletedBuckets: result.deleted.length,
    dryRun: process.argv.includes('--dry-run')
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error('Observability log cleanup failed: ' + error.message);
    process.exitCode = 1;
  });
}
