// Настройки бота: токены берутся из окружения (.env), цены и продукты — здесь.

import https from 'node:https';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';

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

// Прокси для запросов к Telegram и CryptoBot (если провайдер их блокирует).
// Тип задаётся приставкой: socks5:// (по умолчанию) или http://
// Форматы: [тип://]ip:порт:логин:пароль | [тип://]ip:порт | [тип://]логин:пароль@ip:порт
function proxyUrl(raw) {
  raw = (raw || '').trim();
  if (!raw) return '';
  let scheme = 'socks5';
  const sm = raw.match(/^(socks[45]?h?|https?):\/\//i);
  if (sm) {
    scheme = sm[1].toLowerCase();
    raw = raw.slice(sm[0].length);
  }
  // ip:порт или ip:порт:логин:пароль (в пароле могут быть любые символы)
  const m = raw.match(/^([\w.-]+):(\d+)(?::([^:]+):(.+))?$/);
  if (m) {
    const auth = m[3] ? `${encodeURIComponent(m[3])}:${encodeURIComponent(m[4])}@` : '';
    return `${scheme}://${auth}${m[1]}:${m[2]}`;
  }
  if (raw.includes('@')) return `${scheme}://${raw}`;
  throw new Error('PROXY_URL: непонятный формат, ожидается ip:порт:логин:пароль');
}
export const PROXY_URL = proxyUrl(env.PROXY_URL);
// Для логов — без логина и пароля
export const PROXY_LABEL = PROXY_URL ? PROXY_URL.replace(/\/\/[^@]*@/, '//') : '';

// Общий сетевой агент: через прокси, либо напрямую по IPv4
// (на части домашних сетей IPv6 «есть», но не работает, и запросы молча зависают)
function makeAgent() {
  if (!PROXY_URL) return new https.Agent({ keepAlive: true, family: 4 });
  if (/^https?:/.test(PROXY_URL)) return new HttpsProxyAgent(PROXY_URL, { keepAlive: true });
  return new SocksProxyAgent(PROXY_URL, { keepAlive: true, timeout: 20000 });
}
export const httpsAgent = makeAgent();

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
// Те же 7 тем, что в начале игры (ключ career = «Самореализация»)
export const SPHERES = {
  money: { emoji: '💰', name: 'Деньги' },
  love: { emoji: '❤️', name: 'Отношения' },
  purpose: { emoji: '✨', name: 'Предназначение' },
  career: { emoji: '🚀', name: 'Самореализация' },
  anxiety: { emoji: '🌀', name: 'Тревога и ясность' },
  energy: { emoji: '🪫', name: 'Энергия' },
  scale: { emoji: '📈', name: 'Масштаб' },
};

// Запрос из игры → тема разбора
export const REQUEST_TO_SPHERE = {
  money: 'money', love: 'love', purpose: 'purpose', self: 'career', anxiety: 'anxiety', energy: 'energy', scale: 'scale',
};
export const SPHERE_KEYS = Object.keys(SPHERES);

// Продукты: stars — цена в Telegram Stars, usd — цена счёта в CryptoBot
export const PRODUCTS = {
  sphere: {
    title: 'Разбор темы',
    description: 'Подробный разбор выбранной темы по дате рождения',
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
    description: 'Все 7 тем + прогноз на год + одна совместимость',
    stars: 349,
    usd: '4.99',
  },
};
