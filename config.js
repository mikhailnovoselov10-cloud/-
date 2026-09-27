// Настройки бота: токены берутся из окружения (.env), цены и продукты — здесь.

import https from 'node:https';
import { SocksProxyAgent } from 'socks-proxy-agent';

try {
  process.loadEnvFile();
} catch {
  // .env не обязателен — переменные можно задать в окружении
}

const env = process.env;

export const BOT_TOKEN = env.BOT_TOKEN || '';

// Crypto Pay API (@CryptoBot). Пустой токен — оплата криптой просто скрыта.
export const CRYPTOPAY_TOKEN = env.CRYPTOPAY_TOKEN || '';
// true — тестовая сеть (@CryptoTestnetBot), удобно проверять оплату без денег
export const CRYPTOPAY_TESTNET = env.CRYPTOPAY_TESTNET === 'true';
// Какие монеты принимать (пусто — все, что поддерживает CryptoBot)
export const CRYPTOPAY_ASSETS = env.CRYPTOPAY_ASSETS || 'USDT,TON,BTC,ETH,LTC,BNB,TRX,USDC';
// Как часто проверять оплату счетов CryptoBot, мс
export const CRYPTOPAY_POLL_MS = Number(env.CRYPTOPAY_POLL_MS || 15000);
// Срок жизни счёта CryptoBot, секунды
export const CRYPTOPAY_INVOICE_TTL = 3600;

// Telegram ID админов через запятую: им доступна /stats и уведомления
export const ADMIN_IDS = (env.ADMIN_IDS || '')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter(Boolean);

export const DB_PATH = env.DB_PATH || './bot.sqlite';

// SOCKS5-прокси для запросов к Telegram и CryptoBot (если провайдер их блокирует).
// Форматы: ip:порт:логин:пароль | ip:порт | логин:пароль@ip:порт | socks5://логин:пароль@ip:порт
function proxyUrl(raw) {
  raw = (raw || '').trim();
  if (!raw) return '';
  if (/^socks[45]?h?:\/\//i.test(raw)) return raw;
  // ip:порт или ip:порт:логин:пароль (в пароле могут быть любые символы)
  const m = raw.match(/^([\w.-]+):(\d+)(?::([^:]+):(.+))?$/);
  if (m) {
    const auth = m[3] ? `${encodeURIComponent(m[3])}:${encodeURIComponent(m[4])}@` : '';
    return `socks5://${auth}${m[1]}:${m[2]}`;
  }
  if (raw.includes('@')) return `socks5://${raw}`;
  throw new Error('PROXY_URL: непонятный формат, ожидается ip:порт:логин:пароль');
}
export const PROXY_URL = proxyUrl(env.PROXY_URL);
// Для логов — без логина и пароля
export const PROXY_LABEL = PROXY_URL ? PROXY_URL.replace(/\/\/[^@]*@/, '//') : '';

// Общий сетевой агент: через прокси, либо напрямую по IPv4
// (на части домашних сетей IPv6 «есть», но не работает, и запросы молча зависают)
export const httpsAgent = PROXY_URL
  ? new SocksProxyAgent(PROXY_URL, { keepAlive: true, timeout: 20000 })
  : new https.Agent({ keepAlive: true, family: 4 });

// Часовой пояс для «сегодня», личного года и утренней рассылки
export const TIMEZONE = env.TIMEZONE || 'Europe/Moscow';
// Во сколько (по TIMEZONE) присылать ежедневный прогноз
export const DAILY_HOUR = Number(env.DAILY_HOUR ?? 9);

// Паузы между сообщениями разбора, мс
export const FREE_PAUSE_MS = Number(env.FREE_PAUSE_MS || 2500);
export const PAID_PAUSE_MS = Number(env.PAID_PAUSE_MS || 1500);

// Контакт поддержки (для /paysupport)
export const SUPPORT_CONTACT = env.SUPPORT_CONTACT || '';

// Сферы разбора
export const SPHERES = {
  love: { emoji: '💖', name: 'Любовь и отношения' },
  money: { emoji: '💰', name: 'Деньги и изобилие' },
  career: { emoji: '🚀', name: 'Карьера и призвание' },
  purpose: { emoji: '🌟', name: 'Предназначение' },
  energy: { emoji: '⚡', name: 'Энергия и ресурс' },
};
export const SPHERE_KEYS = Object.keys(SPHERES);

// Продукты: stars — цена в Telegram Stars, usd — цена счёта в CryptoBot
export const PRODUCTS = {
  sphere: {
    title: 'Разбор сферы',
    description: 'Подробный разбор выбранной сферы по дате рождения',
    stars: 99,
    usd: '1.49',
  },
  compat: {
    title: 'Совместимость',
    description: 'Разбор совместимости двух людей по датам рождения',
    stars: 149,
    usd: '1.99',
  },
  year: {
    title: 'Прогноз на год',
    description: 'Личный год: главная тема, помесячный прогноз и акценты по сферам',
    stars: 199,
    usd: '2.99',
  },
  pack: {
    title: 'Пакет «Всё включено»',
    description: 'Все сферы + прогноз на год + одна совместимость',
    stars: 349,
    usd: '4.99',
  },
};
