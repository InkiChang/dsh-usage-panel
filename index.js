/**
 * Backend of the dsh-usage-panel plugin.
 *
 * Responsibilities:
 *  - keep the on-disk config (providers + credentials + refresh interval) in ~/.dsh/usage-panel/
 *  - poll each provider (DeepSeek official key, new-api style relays) on a timer
 *  - derive "spent today" for the official key from balance samples (the official API
 *    exposes balance only, so spend is the drop between samples)
 *  - expose it all to the sidebar UI through a small HTTP surface under /plugin/usage-panel
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROUTE_PREFIX = '/plugin/usage-panel';
const DEFAULT_INTERVAL_SECONDS = 300;
const SAMPLE_KEEP_MS = 4 * 24 * 60 * 60 * 1000;
const OFFICIAL_BALANCE_URL = 'https://api.deepseek.com/user/balance';

/* ------------------------------------------------------------------ paths */

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}

function dataDir() {
  return path.join(dshHome(), 'usage-panel');
}

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch {
    /* ignore */
  }
}

function readJson(file, fallback) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* ignore */
  }
}

/* --------------------------------------------------------------- defaults */

function defaultConfig() {
  return {
    intervalSeconds: DEFAULT_INTERVAL_SECONDS,
    holidayOverride: false,
    providers: [
      {
        id: 'official',
        kind: 'official',
        source: 'account',
        name: 'DeepSeek 官方',
        shortName: 'DeepSeek',
        key: '',
        show: true,
      },
    ],
  };
}

function normalizeConfig(raw) {
  const base = defaultConfig();
  const input = raw && typeof raw === 'object' ? raw : {};
  const interval = Number(input.intervalSeconds);
  const providers = Array.isArray(input.providers) ? input.providers : base.providers;
  return {
    intervalSeconds:
      Number.isFinite(interval) && interval >= 60 ? Math.round(interval) : base.intervalSeconds,
    holidayOverride: Boolean(input.holidayOverride),
    providers: providers
      .filter((p) => p && typeof p === 'object')
      .map((p, index) => {
        const kind = p.kind === 'official' ? 'official' : 'newapi';
        const baseUrl = typeof p.baseUrl === 'string' ? p.baseUrl.trim().replace(/\/+$/, '') : '';
        return {
          id: String(p.id || `p${index}`),
          kind,
          source: kind === 'official' ? (p.source === 'key' ? 'key' : 'account') : '',
          name: providerName(kind, p.name, baseUrl, index),
          shortName: p.shortName ? String(p.shortName) : '',
          key: typeof p.key === 'string' ? p.key : '',
          baseUrl,
          token: typeof p.token === 'string' ? p.token : '',
          userId:
            typeof p.userId === 'string'
              ? p.userId.trim()
              : typeof p.userId === 'number'
                ? String(p.userId)
                : '',
          show: p.show !== false,
        };
      }),
  };
}

/* A brand-new relay gets a placeholder name; showing 「新站点」 in the pop card
 * says nothing about which site it is. Fall back to the host it points at. */
const PLACEHOLDER_NAME = /^(新站点|新\s*API\s*站点|站点\s*\d+|new site|new station)$/i;

function hostLabel(baseUrl) {
  try {
    const host = new URL(baseUrl).hostname.replace(/^www\./i, '');
    return host ? host : '';
  } catch {
    return '';
  }
}

function providerName(kind, name, baseUrl, index) {
  const given = typeof name === 'string' ? name.trim() : '';
  if (kind === 'official') return given || 'DeepSeek 官方';
  if (given && !PLACEHOLDER_NAME.test(given)) return given;
  return hostLabel(baseUrl) || given || `站点 ${index + 1}`;
}

/* ------------------------------------------------------------------- time */

const BEIJING = 'Asia/Shanghai';
const PEAK_WINDOWS = [
  [540, 720],
  [840, 1080],
];

function beijingParts(at = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: BEIJING,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const parts = {};
  for (const p of fmt.formatToParts(at)) parts[p.type] = p.value;
  const hour = Number(parts.hour === '24' ? '0' : parts.hour);
  const minute = Number(parts.minute);
  const weekdayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    month: `${parts.year}-${parts.month}`,
    hour,
    minute,
    minuteOfDay: hour * 60 + minute,
    weekday: weekdayMap[parts.weekday] ?? 1,
    hhmm: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  };
}

function peakState(config, at = new Date()) {
  const parts = beijingParts(at);
  const weekend = parts.weekday >= 6;
  const holiday = Boolean(config && config.holidayOverride);
  const workday = !weekend && !holiday;
  const inWindow =
    workday && PEAK_WINDOWS.some(([a, b]) => parts.minuteOfDay >= a && parts.minuteOfDay < b);
  return {
    window: inWindow ? 'peak' : 'offpeak',
    workday,
    weekend,
    holiday,
    hhmm: parts.hhmm,
    date: parts.date,
    month: parts.month,
  };
}

/* ------------------------------------------------------------------ fetch */

async function fetchJson(url, init, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return { ok: res.ok, status: res.status, body, text: text.slice(0, 400) };
  } finally {
    clearTimeout(timer);
  }
}

function friendlyError(status, body, text) {
  const message = body && typeof body.message === 'string' ? body.message : '';
  // new-api 部分部署要求额外的 New-Api-User 请求头（用户数字 id）。
  if (/New-Api-User/i.test(message)) {
    return /不匹配/.test(message) ? '用户 ID 与令牌不匹配' : '该站点要求填写用户 ID';
  }
  if (status === 401 || status === 403) return message || '令牌无效';
  if (status === 404) return '接口不存在';
  if (status === 429) return '请求过多';
  if (status >= 500) return `服务端错误 ${status}`;
  if (message) return message;
  return `HTTP ${status}`;
}

/* --------------------------------------------------------- official key */

async function fetchOfficial(provider) {
  if (!provider.key) return { status: 'unconfigured', error: '未填写 key' };
  const { ok, status, body, text } = await fetchJson(OFFICIAL_BALANCE_URL, {
    headers: { Authorization: `Bearer ${provider.key}`, Accept: 'application/json' },
  });
  if (!ok || !body) return { status: 'error', error: friendlyError(status, body, text) };
  const infos = Array.isArray(body.balance_infos) ? body.balance_infos : [];
  const pick = infos.find((i) => i && i.currency === 'CNY') || infos[0];
  if (!pick) return { status: 'error', error: '余额为空' };
  const balance = Number(pick.total_balance);
  if (!Number.isFinite(balance)) return { status: 'error', error: '余额格式异常' };
  return {
    status: 'ok',
    balance,
    currency: pick.currency === 'CNY' ? 'CNY' : pick.currency || 'CNY',
    symbol: pick.currency === 'USD' ? '$' : '¥',
    available: body.is_available !== false,
  };
}

/* ------------------------------------------- official via signed-in account */

function accountClientMetadata() {
  return {
    version: '0.1.0',
    locale: 'zh-CN',
    // JS getTimezoneOffset() is minutes behind UTC; the account API wants the
    // offset from UTC in seconds (Beijing = +28800).
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
  };
}

/**
 * Read the official balance from the account the Harness has already signed in
 * with, so an API key is not required. Returns null when the service is absent,
 * the account is signed out, or the read fails — callers then fall back to the
 * manually configured key.
 */
async function fetchOfficialFromAccount(account) {
  if (!account || typeof account.getBalance !== 'function') return null;
  try {
    const view = typeof account.getState === 'function' ? await account.getState() : null;
    if (!view || view.status !== 'credential-stored') return null;
  } catch {
    return null;
  }
  try {
    const result = await account.getBalance(accountClientMetadata());
    if (!result || result.status !== 'ready') return null;
    const wallets = [
      ...(Array.isArray(result.value) ? result.value : []),
      ...(Array.isArray(result.bonusWallets) ? result.bonusWallets : []),
    ].filter((w) => w && (w.currency === 'CNY' || w.currency === 'USD'));
    if (!wallets.length) return null;
    const cny = wallets.filter((w) => w.currency === 'CNY');
    const use = cny.length ? cny : wallets;
    const currency = cny.length ? 'CNY' : 'USD';
    const total = use.reduce((sum, w) => sum + (Number(w.balance) || 0), 0);
    if (!Number.isFinite(total)) return null;
    return {
      status: 'ok',
      balance: round(total),
      currency,
      symbol: currency === 'USD' ? '$' : '¥',
      source: 'account',
    };
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------- new-api */

function newApiHeaders(provider) {
  const headers = { Accept: 'application/json' };
  if (provider.token) headers.Authorization = `Bearer ${provider.token}`;
  // 新版 new-api 用访问令牌调用 /api/* 时要求回传令牌所属用户的数字 id。
  if (provider.userId) headers['New-Api-User'] = String(provider.userId);
  return headers;
}

function startOfTodaySeconds() {
  const now = Date.now();
  const parts = beijingParts();
  const [y, m, d] = parts.date.split('-').map(Number);
  // Beijing midnight expressed in epoch seconds.
  const utcMidnight = Date.UTC(y, m - 1, d);
  return Math.floor((utcMidnight - 8 * 60 * 60 * 1000) / 1000 + 0.001) || Math.floor(now / 1000);
}

function startOfMonthSeconds() {
  const parts = beijingParts();
  const [y, m] = parts.date.split('-').map(Number);
  const utcMidnight = Date.UTC(y, m - 1, 1);
  return Math.floor((utcMidnight - 8 * 60 * 60 * 1000) / 1000);
}

async function fetchNewApiStatus(provider) {
  if (!provider.baseUrl) return null;
  const url = `${provider.baseUrl}/api/status`;
  const { ok, body } = await fetchJson(url, { headers: { Accept: 'application/json' } }, 8000);
  if (!ok || !body) return null;
  const data = body.data && typeof body.data === 'object' ? body.data : body;
  const perUnit = Number(data.quota_per_unit);
  const rate = Number(data.usd_exchange_rate);
  return {
    quotaPerUnit: Number.isFinite(perUnit) && perUnit > 0 ? perUnit : 500000,
    displayInCurrency: Boolean(data.display_in_currency),
    exchangeRate: Number.isFinite(rate) && rate > 0 ? rate : 7,
    siteName: typeof data.system_name === 'string' ? data.system_name : '',
  };
}

function toMoney(quota, status) {
  const value = Number(quota);
  if (!Number.isFinite(value)) return null;
  const unit = status ? status.quotaPerUnit : 500000;
  let amount = value / unit;
  if (status && status.displayInCurrency) amount *= status.exchangeRate;
  return amount;
}

async function fetchNewApiConsumed(provider, startSeconds) {
  const headers = newApiHeaders(provider);
  const base = provider.baseUrl;
  const now = Math.floor(Date.now() / 1000);
  const candidates = [
    {
      source: 'data/self',
      url: `${base}/api/data/self?start_timestamp=${startSeconds}&end_timestamp=${now}`,
      pick: (b) => (b && b.data && typeof b.data === 'object' ? b.data.quota : undefined),
    },
    {
      source: 'log/self/stat',
      url: `${base}/api/log/self/stat?type=2&start_timestamp=${startSeconds}&end_timestamp=${now}`,
      pick: (b) => (b && b.data ? b.data.quota : undefined),
    },
    {
      source: 'log/self',
      url: `${base}/api/log/self?p=0&page_size=100&type=2&start_timestamp=${startSeconds}&end_timestamp=${now}`,
      pick: (b) => {
        const items = b && Array.isArray(b.data) ? b.data : null;
        if (!items) return undefined;
        if (items.length >= 100) return undefined; // page cap reached, treat as unreliable
        return items.reduce((sum, item) => sum + (Number(item && item.quota) || 0), 0);
      },
    },
  ];
  for (const candidate of candidates) {
    try {
      const { ok, body } = await fetchJson(candidate.url, { headers }, 12000);
      if (!ok || !body) continue;
      const value = candidate.pick(body);
      if (value === undefined || value === null) continue;
      const num = Number(value);
      if (!Number.isFinite(num)) continue;
      return { quota: num, source: candidate.source };
    } catch {
      /* try next */
    }
  }
  return null;
}

async function fetchNewApi(provider) {
  if (!provider.baseUrl) return { status: 'unconfigured', error: '未填写站点地址' };
  const status = await fetchNewApiStatus(provider);
  const headers = newApiHeaders(provider);
  const selfUrl = `${provider.baseUrl}/api/user/self`;
  const self = await fetchJson(selfUrl, { headers }, 12000);
  if (!self.ok || !self.body) {
    return { status: 'error', error: friendlyError(self.status, self.body, self.text) };
  }
  const user = self.body.data && typeof self.body.data === 'object' ? self.body.data : self.body;
  const remaining = Number(user.quota);
  if (!Number.isFinite(remaining)) return { status: 'error', error: '余额格式异常' };

  const todayStart = startOfTodaySeconds();
  const monthStart = startOfMonthSeconds();
  const today = await fetchNewApiConsumed(provider, todayStart);
  const month = todayStart === monthStart ? today : await fetchNewApiConsumed(provider, monthStart);

  const symbol = status && status.displayInCurrency ? '¥' : '$';
  const currency = status && status.displayInCurrency ? 'CNY' : 'USD';

  return {
    status: 'ok',
    balance: toMoney(remaining, status),
    symbol,
    currency,
    spentToday: today ? toMoney(today.quota, status) : null,
    spentSource: today ? today.source : '',
    monthUsed: month ? toMoney(month.quota, status) : null,
    monthStartLabel: beijingParts().date.slice(5, 7) + '-01',
    siteName: status ? status.siteName : '',
  };
}

/* --------------------------------------------------------------- samples */

function round(value) {
  return Math.round(value * 10000) / 10000;
}

function recordOfficialSample(providerId, balance, at = Date.now()) {
  const file = path.join(dataDir(), 'samples.json');
  const store = readJson(file, {});
  const rows = Array.isArray(store[providerId]) ? store[providerId] : [];
  const cutoff = at - SAMPLE_KEEP_MS;
  const kept = rows.filter((r) => r && r.t > cutoff);
  const last = kept[kept.length - 1];
  if (!last || Math.abs(last.b - balance) > 1e-9 || at - last.t > 10 * 60 * 1000) {
    kept.push({ t: at, b: balance });
  }
  store[providerId] = kept;
  writeJson(file, store);
  return kept;
}

function deriveOfficialSpend(providerId, balance, config) {
  const file = path.join(dataDir(), 'samples.json');
  const store = readJson(file, {});
  const rows = (Array.isArray(store[providerId]) ? store[providerId] : []).filter(
    (r) => r && Number.isFinite(r.b),
  );
  const parts = beijingParts();
  const todayRows = rows.filter((r) => beijingParts(new Date(r.t)).date === parts.date);
  if (!todayRows.length) return { spentToday: null, spentPeak: null, spentOffpeak: null };

  const firstToday = todayRows[0];
  let spentToday = firstToday.b - balance;
  if (spentToday < 0) spentToday = 0;
  if (Date.now() - firstToday.t < 60000) spentToday = null;

  let peak = 0;
  let offpeak = 0;
  const series = [...todayRows, { t: Date.now(), b: balance }];
  for (let i = 1; i < series.length; i += 1) {
    const prev = series[i - 1];
    const delta = prev.b - series[i].b;
    if (!(delta > 0)) continue;
    const state = peakState(config, new Date(prev.t));
    if (state.window === 'peak') peak += delta;
    else offpeak += delta;
  }
  return {
    spentToday: spentToday === null ? null : round(spentToday),
    spentPeak: round(peak),
    spentOffpeak: round(offpeak),
  };
}

/* ----------------------------------------------------------------- store */

/* The account service is registered asynchronously (sign-in restore), and a hard
 * dependency would keep this host fiber PENDING — fatal at the boot gate. So it is
 * bound dynamically: `apply` uses ctx.inject() and parks the service here. */
let accountService = null;

function createHostState(ctx) {
  const configFile = () => path.join(dataDir(), 'config.json');
  let config = normalizeConfig(readJson(configFile(), defaultConfig()));
  let state = { providers: {}, refreshedAt: null, refreshing: false, lastError: null };
  let accountInfo = { available: false, signedIn: false, name: '' };

  function getAccount() {
    if (accountService) return accountService;
    try {
      return typeof ctx.get === 'function' ? ctx.get('deepseekAccount') : undefined;
    } catch {
      return undefined;
    }
  }

  async function readAccountInfo() {
    const account = getAccount();
    if (!account || typeof account.getState !== 'function') {
      accountInfo = { available: false, signedIn: false, name: '' };
      return accountInfo;
    }
    try {
      const view = await account.getState();
      const signedIn = Boolean(view && view.status === 'credential-stored');
      let name = '';
      if (signedIn && typeof account.getProfile === 'function') {
        try {
          const profile = await account.getProfile(accountClientMetadata());
          if (profile && profile.status === 'ready' && profile.value) name = profile.value.name || '';
        } catch {
          name = '';
        }
      }
      accountInfo = { available: true, signedIn, name };
    } catch {
      accountInfo = { available: false, signedIn: false, name: '' };
    }
    return accountInfo;
  }

  function saveConfig(next) {
    config = normalizeConfig(next);
    writeJson(configFile(), config);
    return config;
  }

  function loadConfig() {
    config = normalizeConfig(readJson(configFile(), defaultConfig()));
    return config;
  }

  async function refreshProvider(provider) {
    const at = Date.now();
    let result;
    try {
      if (provider.kind === 'official') {
        // source=account reads the account the Harness already signed in with;
        // source=key reads the key stored on this provider only.
        if (provider.source === 'key') {
          result = await fetchOfficial(provider);
        } else {
          result = await fetchOfficialFromAccount(getAccount());
          if (!result) {
            result = {
              status: 'error',
              error: accountInfo.signedIn ? '官方账号没有返回余额' : '未登录 DSH 官方账号',
            };
          }
        }
      } else {
        result = await fetchNewApi(provider);
      }
    } catch (error) {
      result = { status: 'error', error: shortError(error) };
    }
    if (provider.kind === 'official' && result.status === 'ok') {
      recordOfficialSample(provider.id, result.balance, at);
      const spend = deriveOfficialSpend(provider.id, result.balance, config);
      result = { ...result, ...spend, spentSource: spend.spentToday === null ? '' : 'sampled' };
    }
    return { ...result, id: provider.id, kind: provider.kind, at };
  }

  async function refreshAll() {
    if (state.refreshing) return state.providers;
    state.refreshing = true;
    try {
      await readAccountInfo();
      const results = await Promise.all(config.providers.map((p) => refreshProvider(p)));
      const byId = {};
      for (const row of results) byId[row.id] = row;
      state.providers = byId;
      state.refreshedAt = Date.now();
      state.lastError = null;
    } catch (error) {
      state.lastError = shortError(error);
    } finally {
      state.refreshing = false;
    }
    return state.providers;
  }

  function snapshot() {
    const parts = beijingParts();
    const peak = peakState(config);
    const providers = config.providers.map((provider) => {
      const row = state.providers[provider.id] || {};
      return {
        id: provider.id,
        kind: provider.kind,
        name: provider.name,
        shortName: provider.shortName || provider.name,
        show: provider.show,
        configured:
          provider.kind === 'official'
            ? provider.source === 'key'
              ? Boolean(provider.key)
              : accountInfo.signedIn
            : Boolean(provider.baseUrl),
        status: provider.show === false ? 'hidden' : row.status || 'pending',
        balance: row.balance ?? null,
        symbol: row.symbol || (provider.kind === 'official' ? '¥' : '$'),
        currency: row.currency || 'CNY',
        spentToday: row.spentToday ?? null,
        spentPeak: row.spentPeak ?? null,
        spentOffpeak: row.spentOffpeak ?? null,
        spentSource: row.spentSource || '',
        monthUsed: row.monthUsed ?? null,
        monthStartLabel: row.monthStartLabel || '',
        error: row.error || '',
        updatedAt: row.at ? beijingParts(new Date(row.at)).hhmm : '',
      };
    });
    const refreshed = state.refreshedAt ? beijingParts(new Date(state.refreshedAt)) : null;
    return {
      date: parts.date,
      weekdayLabel: weekdayLabel(parts.weekday),
      peak,
      peakWindows: PEAK_WINDOWS,
      intervalSeconds: config.intervalSeconds,
      holidayOverride: config.holidayOverride,
      refreshedAt: refreshed ? refreshed.hhmm : '',
      refreshing: state.refreshing,
      lastError: state.lastError,
      account: accountInfo,
      providers,
    };
  }

  return { get config() { return config; }, loadConfig, saveConfig, refreshAll, refreshProvider, snapshot };
}

function weekdayLabel(n) {
  return ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][n - 1] || '';
}

function shortError(error) {
  if (!error) return '未知错误';
  if (error.name === 'AbortError') return '请求超时';
  const message = String(error.message || error);
  return message.length > 80 ? `${message.slice(0, 80)}…` : message;
}

/* ---------------------------------------------------------------- routes */

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 512 * 1024) throw new Error('payload too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

function sendJson(res, status, value) {
  const text = JSON.stringify(value);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(text);
}

function publicConfig(config) {
  return {
    intervalSeconds: config.intervalSeconds,
    holidayOverride: config.holidayOverride,
    providers: config.providers.map((p) => ({
      id: p.id,
      kind: p.kind,
      source: p.source || '',
      name: p.name,
      shortName: p.shortName,
      baseUrl: p.baseUrl || '',
      userId: p.userId || '',
      show: p.show,
      hasKey: Boolean(p.key),
      hasToken: Boolean(p.token),
      keyHint: hint(p.key),
      tokenHint: hint(p.token),
    })),
  };
}

function hint(secret) {
  if (!secret) return '';
  if (secret.length <= 8) return '已保存';
  return `${secret.slice(0, 3)}…${secret.slice(-4)}`;
}

function mergeSecrets(next, current) {
  const incoming = Array.isArray(next && next.providers) ? next.providers : [];
  const byId = new Map(current.providers.map((p) => [p.id, p]));
  return {
    ...next,
    providers: incoming.map((p, index) => {
      const prev = byId.get(p.id);
      const key = typeof p.key === 'string' && p.key ? p.key : prev ? prev.key : '';
      const token = typeof p.token === 'string' && p.token ? p.token : prev ? prev.token : '';
      return { ...p, id: p.id || `p${index}`, key, token };
    }),
  };
}

export const inject = ['webServer'];

export function apply(ctx) {
  /**
   * Last geometry report posted by the browser half. Kept in memory only: it is
   * a debugging channel for the overlay block's placement, not user data.
   */
  let clientReport = null;
  const store = createHostState(ctx);

  /* The account service is registered asynchronously (it waits for the stored
   * credential to be restored), and hard-injecting it would keep this fiber in
   * PENDING — which the boot gate treats as a failure. Bind it when it shows up,
   * then re-read the providers so the official card fills in. */
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['deepseekAccount'], (scope) => {
        accountService = scope.deepseekAccount || null;
        store.refreshAll().catch(() => {});
        return () => {
          accountService = null;
        };
      });
    } catch (error) {
      ctx.logger?.warn?.(`[usage-panel] account binding failed: ${shortError(error)}`);
    }
  }

  ctx.effect(() => {
    let cancelled = false;
    let timer = null;

    const loop = async () => {
      if (cancelled) return;
      try {
        await store.refreshAll();
      } catch {
        /* state carries the error */
      }
      if (cancelled) return;
      const delay = Math.max(60, store.config.intervalSeconds) * 1000;
      timer = setTimeout(loop, delay);
      if (timer && typeof timer.unref === 'function') timer.unref();
    };

    loop();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  });

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      handler: async (req, res) => {
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        const sub = url.pathname.slice(ROUTE_PREFIX.length) || '/';
        const method = (req.method || 'GET').toUpperCase();
        try {
          if (method === 'GET' && sub === '/state') {
            sendJson(res, 200, store.snapshot());
            return;
          }
          if (method === 'POST' && sub === '/refresh') {
            await store.refreshAll();
            sendJson(res, 200, store.snapshot());
            return;
          }
          if (method === 'GET' && sub === '/config') {
            sendJson(res, 200, publicConfig(store.config));
            return;
          }
          if (method === 'POST' && sub === '/config') {
            const body = await readBody(req);
            const merged = mergeSecrets(body, store.config);
            store.saveConfig(merged);
            sendJson(res, 200, publicConfig(store.config));
            setTimeout(() => {
              store.refreshAll().catch(() => {});
            }, 0);
            return;
          }
          if (method === 'POST' && sub === '/test') {
            const body = await readBody(req);
            const merged = mergeSecrets({ providers: [body] }, store.config);
            const provider = normalizeConfig(merged).providers[0];
            const result = await store.refreshProvider(provider);
            sendJson(res, 200, result);
            return;
          }
          if (method === 'POST' && sub === '/report') {
            const body = await readBody(req);
            clientReport = { at: new Date().toISOString(), ...(body || {}) };
            sendJson(res, 200, { ok: true });
            return;
          }
          if (method === 'GET' && sub === '/report') {
            sendJson(res, 200, clientReport || null);
            return;
          }
          sendJson(res, 404, { error: 'not found' });
        } catch (error) {
          sendJson(res, 500, { error: shortError(error) });
        }
      },
    }),
  );

  ctx.logger?.info?.('[usage-panel] host ready');
}
