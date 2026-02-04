/**
 * Timezone helpers for company-local date boundaries and formatting.
 * Uses Intl (IANA timezones). All punch times are stored in UTC in the DB.
 */

const CompanySettings = require('../models/CompanySettings');

/** Default timezone when none is set */
const DEFAULT_TZ = 'UTC';

/**
 * Get company timezone from settings (e.g. 'America/New_York').
 * @param {string} companyId
 * @returns {Promise<string>}
 */
async function getCompanyTimezone(companyId) {
  if (!companyId) return DEFAULT_TZ;
  try {
    const settings = await CompanySettings.findOne({ companyId }).select('timezone').lean();
    const tz = settings?.timezone && String(settings.timezone).trim();
    return tz || DEFAULT_TZ;
  } catch (_) {
    return DEFAULT_TZ;
  }
}

/**
 * Get local date string (YYYY-MM-DD) for a given UTC date in a timezone.
 * @param {Date|number} utcDate
 * @param {string} timezone IANA timezone
 * @returns {string} YYYY-MM-DD
 */
function getLocalDateStringInTz(utcDate, timezone) {
  const d = new Date(utcDate);
  const tz = timezone || DEFAULT_TZ;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(d);
  const year = parts.find((p) => p.type === 'year')?.value || '';
  const month = parts.find((p) => p.type === 'month')?.value || '';
  const day = parts.find((p) => p.type === 'day')?.value || '';
  return `${year}-${month}-${day}`;
}

/**
 * Get UTC range (start and end) for a calendar day in a timezone.
 * Used so "today" and date filters use company timezone, not server.
 * @param {string} localDateStr YYYY-MM-DD (the calendar day in the timezone)
 * @param {string} timezone IANA timezone (e.g. America/New_York)
 * @returns {{ startUtc: Date, endUtc: Date }}
 */
function getUtcRangeForLocalDate(localDateStr, timezone) {
  const tz = timezone && String(timezone).trim() ? timezone : DEFAULT_TZ;
  if (!localDateStr || localDateStr.length < 10) {
    const d = new Date();
    const start = new Date(d);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
    return { startUtc: start, endUtc: end };
  }
  const dateStr = String(localDateStr).trim().slice(0, 10);

  // Search for the UTC range that maps to this local date in the TZ.
  // Try from 24h before to 24h after midnight UTC on that date.
  const base = new Date(dateStr + 'T12:00:00.000Z').getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  let startUtc = null;
  let endUtc = null;
  for (let offset = -dayMs; offset <= dayMs; offset += 15 * 60 * 1000) {
    const T = new Date(base + offset);
    const local = getLocalDateStringInTz(T, tz);
    if (local === dateStr) {
      if (startUtc == null || T.getTime() < startUtc.getTime()) startUtc = new Date(T.getTime());
      if (endUtc == null || T.getTime() > endUtc.getTime()) endUtc = new Date(T.getTime());
    }
  }
  if (startUtc == null || endUtc == null) {
    const fallbackStart = new Date(dateStr + 'T00:00:00.000Z');
    const fallbackEnd = new Date(fallbackStart.getTime() + dayMs - 1);
    return { startUtc: fallbackStart, endUtc: fallbackEnd };
  }
  endUtc = new Date(endUtc.getTime() + 15 * 60 * 1000 - 1);
  return { startUtc, endUtc };
}

/**
 * Get "today" in company timezone as YYYY-MM-DD.
 * @param {string} timezone IANA timezone
 * @returns {string}
 */
function getTodayInTz(timezone) {
  return getLocalDateStringInTz(new Date(), timezone || DEFAULT_TZ);
}

/**
 * Format a UTC date for display in a timezone (date + time).
 * @param {Date|number} utcDate
 * @param {string} timezone IANA timezone
 * @returns {string}
 */
function formatDateTimeInTz(utcDate, timezone) {
  const d = new Date(utcDate);
  const tz = timezone && String(timezone).trim() ? timezone : DEFAULT_TZ;
  return d.toLocaleString('en-US', {
    timeZone: tz,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

module.exports = {
  getCompanyTimezone,
  getLocalDateStringInTz,
  getUtcRangeForLocalDate,
  getTodayInTz,
  formatDateTimeInTz,
  DEFAULT_TZ,
};
