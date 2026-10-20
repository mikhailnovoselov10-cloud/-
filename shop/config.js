// Настройки сайта закупок: берутся из окружения (.env рядом с server.js).

import crypto from 'node:crypto';

try {
  process.loadEnvFile();
} catch {
  // .env не обязателен — переменные можно задать в окружении
}

const env = process.env;

export const PORT = Number(env.PORT || 3000);
export const SITE_NAME = env.SITE_NAME || 'Совместные закупки';
// Пароль входа в админку /admin
export const ADMIN_PASSWORD = env.ADMIN_PASSWORD || '';
// Подпись cookie. Пусто — выводится из пароля (смена пароля разлогинит всех)
export const SESSION_SECRET = env.SESSION_SECRET
  || crypto.createHash('sha256').update(`sp-shop:${ADMIN_PASSWORD}`).digest('hex');
export const DB_PATH = env.DB_PATH || './shop.sqlite';
export const UPLOAD_DIR = env.UPLOAD_DIR || './uploads';
export const CURRENCY = env.CURRENCY || '₽';
// Контакт организатора, показывается клиентам (телефон, @telegram и т.п.)
export const CONTACT = env.CONTACT || '';
// Уведомления о новых записях в Telegram (необязательно)
export const TG_BOT_TOKEN = env.TG_BOT_TOKEN || '';
export const TG_CHAT_ID = env.TG_CHAT_ID || '';
