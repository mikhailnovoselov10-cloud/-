// База SQLite (встроенная node:sqlite).
//
// Защита от двойной выдачи товара:
//  1. payments имеет UNIQUE(provider, external_id) — один и тот же платёж
//     (charge_id в Stars, invoice_id в CryptoBot) записывается ровно один раз.
//  2. Заказ переводится pending → paid условным UPDATE ... WHERE status='pending',
//     поэтому оплатить (и выдать) один заказ можно только один раз.
//  3. Всё это — в одной транзакции вместе с выдачей прав (entitlements).
// Выданное хранится в entitlements, поэтому повторный показ разбора бесплатен
// и не зависит от того, успели ли дойти сообщения.

import { DatabaseSync } from 'node:sqlite';
import { DB_PATH, SPHERE_KEYS } from './config.js';

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY,
  username       TEXT,
  first_name     TEXT,
  birth          TEXT,
  source         TEXT,
  state          TEXT,
  free_sphere    TEXT,
  compat_credits INTEGER NOT NULL DEFAULT 0,
  daily          INTEGER NOT NULL DEFAULT 1,
  last_daily     TEXT,
  blocked        INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  product      TEXT NOT NULL,
  param        TEXT,
  stars        INTEGER NOT NULL,
  usd          TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  created_at   INTEGER NOT NULL,
  paid_at      INTEGER,
  delivered_at INTEGER
);
CREATE TABLE IF NOT EXISTS payments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  provider    TEXT NOT NULL,
  external_id TEXT NOT NULL,
  order_id    INTEGER NOT NULL,
  user_id     INTEGER NOT NULL,
  amount      TEXT NOT NULL,
  currency    TEXT NOT NULL,
  status      TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  UNIQUE (provider, external_id)
);
CREATE TABLE IF NOT EXISTS crypto_invoices (
  invoice_id INTEGER PRIMARY KEY,
  order_id   INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  url        TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS entitlements (
  user_id    INTEGER NOT NULL,
  item       TEXT NOT NULL,
  order_id   INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, item)
);
CREATE INDEX IF NOT EXISTS idx_crypto_status ON crypto_invoices(status);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
`);

const now = () => Date.now();

function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ---------- пользователи ----------

const qUpsertUser = db.prepare(`
  INSERT INTO users (id, username, first_name, source, created_at) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET username = excluded.username, first_name = excluded.first_name, blocked = 0
`);
const qGetUser = db.prepare('SELECT * FROM users WHERE id = ?');

// Создаёт пользователя; метка трафика (source) сохраняется только при первом визите
export function touchUser(from, source = null) {
  qUpsertUser.run(from.id, from.username ?? null, from.first_name ?? null, source, now());
  return qGetUser.get(from.id);
}

export const getUser = (id) => qGetUser.get(id);

const qSetBirth = db.prepare('UPDATE users SET birth = ?, state = NULL WHERE id = ?');
export const setBirth = (id, iso) => qSetBirth.run(iso, id);

const qSetState = db.prepare('UPDATE users SET state = ? WHERE id = ?');
export const setState = (id, state) => qSetState.run(state, id);

const qSetDaily = db.prepare('UPDATE users SET daily = ? WHERE id = ?');
export const setDaily = (id, on) => qSetDaily.run(on ? 1 : 0, id);

const qSetBlocked = db.prepare('UPDATE users SET blocked = 1 WHERE id = ?');
export const setBlocked = (id) => qSetBlocked.run(id);

// Кому пора отправить ежедневный прогноз (ещё не получал сегодня)
const qDailyDue = db.prepare(`
  SELECT id, birth FROM users
  WHERE daily = 1 AND blocked = 0 AND birth IS NOT NULL AND (last_daily IS NULL OR last_daily <> ?)
  LIMIT 500
`);
export const dailyDue = (today) => qDailyDue.all(today);

const qMarkDaily = db.prepare('UPDATE users SET last_daily = ? WHERE id = ?');
export const markDaily = (id, today) => qMarkDaily.run(today, id);

// ---------- права на разборы ----------

const qEnt = db.prepare('SELECT 1 FROM entitlements WHERE user_id = ? AND item = ?');
export const hasItem = (userId, item) => !!qEnt.get(userId, item);

const qEntList = db.prepare('SELECT item FROM entitlements WHERE user_id = ? ORDER BY created_at');
export const listItems = (userId) => qEntList.all(userId).map((r) => r.item);

const qGrant = db.prepare(`
  INSERT INTO entitlements (user_id, item, order_id, created_at) VALUES (?, ?, ?, ?)
  ON CONFLICT DO NOTHING
`);
const grant = (userId, item, orderId = null) => qGrant.run(userId, item, orderId, now());

// Бесплатная сфера: выдаётся атомарно и только один раз на пользователя
const qClaimFree = db.prepare('UPDATE users SET free_sphere = ? WHERE id = ? AND free_sphere IS NULL');
export function claimFreeSphere(userId, sphere) {
  return tx(() => {
    if (qClaimFree.run(sphere, userId).changes !== 1) return false;
    grant(userId, `sphere:${sphere}`);
    return true;
  });
}

// Использовать кредит совместимости из пакета
const qUseCredit = db.prepare('UPDATE users SET compat_credits = compat_credits - 1 WHERE id = ? AND compat_credits > 0');
export function useCompatCredit(userId, partnerIso) {
  return tx(() => {
    const item = `compat:${partnerIso}`;
    if (qEnt.get(userId, item)) return true;
    if (qUseCredit.run(userId).changes !== 1) return false;
    grant(userId, item);
    return true;
  });
}

// ---------- заказы ----------

const qNewOrder = db.prepare(`
  INSERT INTO orders (user_id, product, param, stars, usd, created_at) VALUES (?, ?, ?, ?, ?, ?)
`);
export function createOrder(userId, product, param, stars, usd) {
  const r = qNewOrder.run(userId, product, param, stars, usd, now());
  return getOrder(Number(r.lastInsertRowid));
}

const qGetOrder = db.prepare('SELECT * FROM orders WHERE id = ?');
export const getOrder = (id) => qGetOrder.get(id);

const qDelivered = db.prepare('UPDATE orders SET delivered_at = ? WHERE id = ?');
export const markDelivered = (orderId) => qDelivered.run(now(), orderId);

// Какие права даёт заказ
function grantOrder(order) {
  const { user_id: uid, id } = order;
  switch (order.product) {
    case 'sphere':
      grant(uid, `sphere:${order.param}`, id);
      break;
    case 'year':
      grant(uid, `year:${order.param}`, id);
      break;
    case 'compat':
      grant(uid, `compat:${order.param}`, id);
      break;
    case 'pack':
      for (const s of SPHERE_KEYS) grant(uid, `sphere:${s}`, id);
      grant(uid, `year:${order.param}`, id);
      db.prepare('UPDATE users SET compat_credits = compat_credits + 1 WHERE id = ?').run(uid);
      break;
    default:
      throw new Error(`Неизвестный продукт: ${order.product}`);
  }
}

const qInsertPayment = db.prepare(`
  INSERT INTO payments (provider, external_id, order_id, user_id, amount, currency, status, created_at)
  VALUES (?, ?, ?, ?, ?, ?, 'ok', ?)
  ON CONFLICT(provider, external_id) DO NOTHING
`);
const qPayOrder = db.prepare(`UPDATE orders SET status = 'paid', paid_at = ? WHERE id = ? AND status = 'pending'`);
const qPaymentStatus = db.prepare('UPDATE payments SET status = ? WHERE provider = ? AND external_id = ?');

/**
 * Проводит платёж. Возвращает:
 *  - { result: 'granted', order }        — новый платёж, заказ оплачен, права выданы;
 *  - { result: 'duplicate' }             — этот платёж уже обработан ранее (ничего не делаем);
 *  - { result: 'order_not_pending', order } — платёж новый, но заказ уже был оплачен
 *    другим платежом: товар повторно НЕ выдаётся, платёж помечается 'extra' для возврата.
 */
export function fulfillPayment({ provider, externalId, orderId, userId, amount, currency }) {
  return tx(() => {
    const ins = qInsertPayment.run(provider, String(externalId), orderId, userId, String(amount), currency, now());
    if (ins.changes !== 1) return { result: 'duplicate' };

    const order = qGetOrder.get(orderId);
    if (!order || qPayOrder.run(now(), orderId).changes !== 1) {
      qPaymentStatus.run('extra', provider, String(externalId));
      return { result: 'order_not_pending', order };
    }
    grantOrder(order);
    return { result: 'granted', order: qGetOrder.get(orderId) };
  });
}

export const markPaymentRefunded = (provider, externalId) =>
  qPaymentStatus.run('refunded', provider, String(externalId));

// ---------- счета CryptoBot ----------

const qAddInvoice = db.prepare(`
  INSERT INTO crypto_invoices (invoice_id, order_id, user_id, url, created_at) VALUES (?, ?, ?, ?, ?)
`);
export const addCryptoInvoice = (invoiceId, orderId, userId, url) =>
  qAddInvoice.run(invoiceId, orderId, userId, url, now());

const qActiveInvoiceForOrder = db.prepare(
  `SELECT * FROM crypto_invoices WHERE order_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
);
export const activeInvoiceForOrder = (orderId) => qActiveInvoiceForOrder.get(orderId);

const qActiveInvoices = db.prepare(`SELECT * FROM crypto_invoices WHERE status = 'active' LIMIT 1000`);
export const activeCryptoInvoices = () => qActiveInvoices.all();

const qOtherInvoices = db.prepare(
  `SELECT invoice_id FROM crypto_invoices WHERE order_id = ? AND status = 'active' AND invoice_id <> ?`,
);
export const otherActiveInvoices = (orderId, exceptId = 0) =>
  qOtherInvoices.all(orderId, exceptId).map((r) => r.invoice_id);

const qInvoiceStatus = db.prepare('UPDATE crypto_invoices SET status = ? WHERE invoice_id = ?');
export const setInvoiceStatus = (invoiceId, status) => qInvoiceStatus.run(status, invoiceId);

// ---------- статистика ----------

export function stats() {
  const dayAgo = now() - 24 * 3600e3;
  const weekAgo = now() - 7 * 24 * 3600e3;
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  return {
    users: one('SELECT COUNT(*) c FROM users').c,
    users24h: one('SELECT COUNT(*) c FROM users WHERE created_at > ?', dayAgo).c,
    users7d: one('SELECT COUNT(*) c FROM users WHERE created_at > ?', weekAgo).c,
    withBirth: one('SELECT COUNT(*) c FROM users WHERE birth IS NOT NULL').c,
    freeUsed: one('SELECT COUNT(*) c FROM users WHERE free_sphere IS NOT NULL').c,
    daily: one('SELECT COUNT(*) c FROM users WHERE daily = 1 AND blocked = 0 AND birth IS NOT NULL').c,
    blocked: one('SELECT COUNT(*) c FROM users WHERE blocked = 1').c,
    stars: one(`SELECT COUNT(*) n, COALESCE(SUM(CAST(amount AS INTEGER)), 0) s FROM payments WHERE provider = 'stars' AND status = 'ok'`),
    crypto: one(`SELECT COUNT(*) n, COALESCE(SUM(CAST(amount AS REAL)), 0) s FROM payments WHERE provider = 'cryptobot' AND status = 'ok'`),
    stars24h: one(`SELECT COALESCE(SUM(CAST(amount AS INTEGER)), 0) s FROM payments WHERE provider = 'stars' AND status = 'ok' AND created_at > ?`, dayAgo).s,
    crypto24h: one(`SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) s FROM payments WHERE provider = 'cryptobot' AND status = 'ok' AND created_at > ?`, dayAgo).s,
    byProduct: db.prepare(`SELECT product, COUNT(*) n FROM orders WHERE status = 'paid' GROUP BY product ORDER BY n DESC`).all(),
    bySource: db.prepare(`
      SELECT COALESCE(u.source, '—') source, COUNT(*) users,
        SUM(CASE WHEN u.free_sphere IS NOT NULL THEN 1 ELSE 0 END) free,
        (SELECT COUNT(DISTINCT p.user_id) FROM payments p JOIN users u2 ON u2.id = p.user_id
          WHERE p.status = 'ok' AND COALESCE(u2.source, '—') = COALESCE(u.source, '—')) buyers,
        (SELECT COALESCE(SUM(CAST(p.amount AS INTEGER)), 0) FROM payments p JOIN users u2 ON u2.id = p.user_id
          WHERE p.status = 'ok' AND p.provider = 'stars' AND COALESCE(u2.source, '—') = COALESCE(u.source, '—')) stars,
        (SELECT COALESCE(SUM(CAST(p.amount AS REAL)), 0) FROM payments p JOIN users u2 ON u2.id = p.user_id
          WHERE p.status = 'ok' AND p.provider = 'cryptobot' AND COALESCE(u2.source, '—') = COALESCE(u.source, '—')) usd
      FROM users u GROUP BY COALESCE(u.source, '—') ORDER BY users DESC LIMIT 20
    `).all(),
  };
}
