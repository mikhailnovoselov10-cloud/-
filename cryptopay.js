// Crypto Pay API (@CryptoBot): https://help.crypt.bot/crypto-pay-api

import {
  CRYPTOPAY_TOKEN, CRYPTOPAY_TESTNET, CRYPTOPAY_ASSETS, CRYPTOPAY_INVOICE_TTL,
} from './config.js';

const BASE = CRYPTOPAY_TESTNET ? 'https://testnet-pay.crypt.bot/api' : 'https://pay.crypt.bot/api';

export const cryptoEnabled = () => !!CRYPTOPAY_TOKEN;

async function call(method, params = {}) {
  const res = await fetch(`${BASE}/${method}`, {
    method: 'POST',
    headers: {
      'Crypto-Pay-API-Token': CRYPTOPAY_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    throw new Error(`CryptoPay ${method}: ${JSON.stringify(data.error ?? res.status)}`);
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
