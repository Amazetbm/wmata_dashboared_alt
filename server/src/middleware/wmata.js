'use strict';

const axios      = require('axios');
const wmataUsage = require('../lib/wmataUsage');

const PER_SEC     = parseInt(process.env.WMATA_RATE_LIMIT_PER_SEC ?? '8', 10);
const MAX_RETRIES = 2;

class TokenBucket {
  constructor(perSec) {
    this._tokens = perSec;
    this._max    = perSec;
    // Refill every second; unref so it doesn't block process exit
    setInterval(() => { this._tokens = this._max; }, 1000).unref();
  }

  acquire() {
    if (this._tokens > 0) {
      this._tokens--;
      return Promise.resolve();
    }
    return new Promise(resolve => {
      const id = setInterval(() => {
        if (this._tokens > 0) {
          this._tokens--;
          clearInterval(id);
          resolve();
        }
      }, 50);
    });
  }
}

const bucket = new TokenBucket(PER_SEC);

const wmataClient = axios.create({
  baseURL: 'https://api.wmata.com',
  headers: { api_key: process.env.WMATA_API_KEY },
  timeout: 10000,
});

wmataClient.interceptors.request.use(async (config) => {
  await bucket.acquire();
  return config;
});

function extractEndpoint(config) {
  try {
    return new URL(config.url, config.baseURL || 'https://api.wmata.com').pathname;
  } catch {
    return config.url ?? 'unknown';
  }
}

wmataClient.interceptors.response.use(
  (response) => {
    wmataUsage.increment(extractEndpoint(response.config));
    return response;
  },
  async (error) => {
    const config = error.config;
    if (!config) throw error;

    const endpoint = extractEndpoint(config);

    if (error.response?.status === 429) {
      wmataUsage.increment429(endpoint);
      config._retryCount = (config._retryCount || 0) + 1;

      if (config._retryCount <= MAX_RETRIES) {
        const retryAfterHeader = error.response.headers['retry-after'];
        const jitter  = Math.random() * 500;
        const waitMs  = retryAfterHeader
          ? parseFloat(retryAfterHeader) * 1000
          : Math.pow(2, config._retryCount) * 1000 + jitter;

        console.log(`[wmata 429] ${endpoint} retry ${config._retryCount} in ${Math.round(waitMs)}ms`);
        await new Promise(r => setTimeout(r, waitMs));
        return wmataClient(config);
      }
    }

    throw error;
  }
);

module.exports = { wmataClient };
