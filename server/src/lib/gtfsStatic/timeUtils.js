'use strict';

const { DateTime } = require('luxon');

/**
 * Parse a GTFS time string ("HH:MM:SS", possibly >24:00) to integer seconds
 * since service-day midnight.
 *
 * @param {string} str  e.g. "06:30:00" or "25:15:00"
 * @returns {number}
 */
function parseGtfsTime(str) {
  const [h, m, s] = str.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

/**
 * Convert a GTFS service-day date + seconds offset to an absolute UTC Date.
 *
 * Uses the noon-minus-12h anchor: noon ET is always unambiguous (never in a
 * DST gap/overlap), so service-day midnight = noon - 12 hours in the agency
 * timezone.  Handles spring-forward (23-hour day) and fall-back (25-hour day).
 *
 * @param {string} localDateStr  "YYYY-MM-DD" in agency timezone
 * @param {number} departureSec  seconds since service-day midnight (may exceed 86400)
 * @param {string} [agencyTz]    IANA timezone, default "America/New_York"
 * @returns {Date}
 */
function gtfsToUtc(localDateStr, departureSec, agencyTz = 'America/New_York') {
  const [y, mo, d] = localDateStr.split('-').map(Number);
  const noonLocal = DateTime.fromObject(
    { year: y, month: mo, day: d, hour: 12 },
    { zone: agencyTz }
  );
  const midnightMs = noonLocal.minus({ hours: 12 }).toMillis();
  return new Date(midnightMs + departureSec * 1000);
}

/**
 * Format a Date as "HH:MM" in Eastern time, for display purposes.
 *
 * @param {Date} date
 * @param {string} [tz]
 * @returns {string}
 */
function formatTimeEastern(date, tz = 'America/New_York') {
  return DateTime.fromJSDate(date, { zone: tz }).toFormat('HH:mm');
}

module.exports = { parseGtfsTime, gtfsToUtc, formatTimeEastern };
