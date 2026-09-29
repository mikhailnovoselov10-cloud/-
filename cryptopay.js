// Crypto Pay API (@CryptoBot): https://help.crypt.bot/crypto-pay-api

import https from 'node:https';
import {
  CRYPTOPAY_TOKEN, CRYPTOPAY_TESTNET, CRYPTOPAY_ASSETS, CRYPTOPAY_INVOICE_TTL, httpsAgent,
} from './config.js';

const BASE = CRYPTOPAY_TESTNET ? 'https://testnet-pay.crypt.bot/api' : 'https://pay.crypt.bot/api';

export const cryptoEnabled = () => !!CRYPTOPAY_TOKEN;

// POST через общий агент (он же ходит через прокси, если задан PROXY_URL)
function post(url, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST',
      agent: httpsAgent,
      timeout: 15000,
      headers: {
        'Crypto-Pay-API-Token': CRYPTOPAY_TOKEN,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

async function call(method, params = {}) {
  const res = await post(`${BASE}/${method}`, JSON.stringify(params));
  let data = {};
  try {
    data = JSON.parse(res.text);
  } catch {}
  if (!data.ok) {
    // Текст ответа (без токена) помогает понять причину: неверный токен, сбой CryptoBot и т.п.
    const detail = data.error ? JSON.stringify(data.error) : `${res.status} ${res.text.replace(/\s+/g, ' ').slice(0, 200)}`;
    throw new Error(`CryptoPay ${method}: ${detail}`);
  }
  return data.result;
}

// Проверка токена при старте
export const getMe = () => call('getMe');

// Счёт в USD, оплачивается любой из разрешённых монет
export function createInvoice({ usd, description, payload, botUsername }) {
  const params = {
    currency_type: 'fiat',
    fiat: 'USD',
    amount: usd,
    description: description.slice(0, 1024),
    payload: String(payload),
    expires_in: CRYPTOPAY_INVOICE_TTL,
    allow_comments: false,
    allow_anonymous: true,
  };
  if (CRYPTOPAY_ASSETS) params.accepted_assets = CRYPTOPAY_ASSETS;
  if (botUsername) {
    params.paid_btn_name = 'callback';
    params.paid_btn_url = `https://t.me/${botUsername}`;
  }
  return call('createInvoice', params);
}

// Статусы счетов по id (до 1000 за запрос)
export async function getInvoices(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const r = await call('getInvoices', { invoice_ids: chunk.join(','), count: chunk.length });
    out.push(...(r.items ?? []));
  }
  return out;
}

export const deleteInvoice = (id) => call('deleteInvoice', { invoice_id: id });
