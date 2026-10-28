// Настройки сайта, которые меняются в админке (хранятся в базе, значения из .env — по умолчанию).

import { SITE_NAME, CONTACT, CURRENCY, TG_BOT_TOKEN, TG_CHAT_ID } from './config.js';
import { getSettings, saveSettings } from './db.js';

const DEFAULTS = {
  site_name: SITE_NAME,
  welcome: 'Совместные закупки напрямую с фабрик. Выбирайте модели, записывайтесь — после стопа закажем у фабрики.',
  contact: CONTACT,
  currency: CURRENCY,
  tg_bot_token: TG_BOT_TOKEN,
  tg_chat_id: TG_CHAT_ID,
};

export const SETTING_KEYS = Object.keys(DEFAULTS);

let cache = null;

export function settings() {
  cache ??= getSettings(DEFAULTS);
  return cache;
}

export function updateSettings(values) {
  saveSettings(values);
  cache = null;
}
