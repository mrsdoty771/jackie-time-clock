/**
 * Calculate worked hours for one day from punch timestamps.
 * lunchOut = left for lunch; lunchIn = returned from lunch.
 *
 * @param {object} params
 * @param {Date|null} params.clockIn
 * @param {Date|null} params.clockOut
 * @param {Date|null} params.lunchIn
 * @param {Date|null} params.lunchOut
 * @param {Date} [params.asOf] - Current time cap for in-progress days (default: now)
 * @returns {number} Hours worked (not rounded)
 */
function calculateDayWorkHours({ clockIn, clockOut, lunchIn, lunchOut, asOf = new Date() }) {
  if (!clockIn) return 0;

  let effectiveEnd = clockOut;
  if (!effectiveEnd) {
    if (lunchOut && !lunchIn) {
      effectiveEnd = lunchOut;
    } else {
      effectiveEnd = asOf;
    }
  }

  if (effectiveEnd <= clockIn) return 0;

  let hours = (effectiveEnd - clockIn) / (1000 * 60 * 60);
  if (lunchOut && lunchIn && lunchOut < lunchIn) {
    hours -= (lunchIn - lunchOut) / (1000 * 60 * 60);
  }
  return Math.max(0, hours);
}

module.exports = { calculateDayWorkHours };
