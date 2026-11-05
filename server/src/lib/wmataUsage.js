'use strict';

const cron = require('node-cron');

const DAILY_LIMIT = parseInt(process.env.WMATA_DAILY_LIMIT ?? '50000', 10);

let date       = new Date().toISOString().slice(0, 10);
let totalCalls = 0;
const calls      = {};
const errors429  = {};

function increment(endpoint) {
  totalCalls++;
  calls[endpoint] = (calls[endpoint] || 0) + 1;
}

function increment429(endpoint) {
  errors429[endpoint] = (errors429[endpoint] || 0) + 1;
}

function getUsage() {
  return {
    date,
    totalCalls,
    dailyLimit: DAILY_LIMIT,
    pct: Math.round((totalCalls / DAILY_LIMIT) * 1000) / 10,
    calls:     { ...calls },
    errors429: { ...errors429 },
  };
}

function resetDay() {
  date       = new Date().toISOString().slice(0, 10);
  totalCalls = 0;
  for (const k of Object.keys(calls))     delete calls[k];
  for (const k of Object.keys(errors429)) delete errors429[k];
  console.log('[wmataUsage] Daily counter reset');
}

function scheduleDailyReset() {
  cron.schedule('0 0 * * *', resetDay, { timezone: 'America/New_York' });
}

function scheduleHourlyLog() {
  cron.schedule('0 * * * *', () => {
    const u = getUsage();
    const msg = `[wmataUsage] Hourly: ${u.totalCalls}/${u.dailyLimit} calls (${u.pct}%) on ${u.date}`;
    if (u.pct >= 80) {
      console.warn(msg + ' — WARNING: approaching daily limit');
    } else {
      console.log(msg);
    }
  });
}

module.exports = { increment, increment429, getUsage, resetDay, scheduleDailyReset, scheduleHourlyLog };
