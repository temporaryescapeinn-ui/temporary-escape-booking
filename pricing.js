// Vanilla-JS port of C:\dev\tea\src\pricing\calculatePrice.ts — keep the two
// in sync by hand. Same rules, same numbers; the only behavior difference is
// that this version returns { unavailable: true, reason } instead of
// throwing, since a customer shouldn't ever see a stack trace.

const ROOMS = {
  standard: {
    key: 'standard',
    label: 'Standard',
    subtitle: 'Yellow, Orange and Green',
    shortStay3hrPrice: 80,
    shortStayFlat: false,
    shortStayLastStart: 17 * 60, // 5:00pm
    overnightPrice: 100,
    halfDayPrice: 120,
    fullDayPrice: 140,
  },
  blue: {
    key: 'blue',
    label: 'Blue',
    subtitle: null,
    shortStay3hrPrice: 70,
    shortStayFlat: false,
    shortStayLastStart: 18 * 60, // 6:00pm
    overnightPrice: 100,
    halfDayPrice: 120,
    fullDayPrice: 140,
  },
  white: {
    key: 'white',
    label: 'White',
    subtitle: null,
    shortStay3hrPrice: 120,
    shortStayFlat: true,
    shortStayLastStart: 17 * 60, // 5:00pm
    overnightPrice: 120,
    halfDayPrice: 130,
    fullDayPrice: 150,
  },
};

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

const CROSSES_6PM_PRICE = 120;
const CROSSES_8PM_PRICE = 140;

const MIN_STAY_HOURS = 3;
const MAX_NIGHTS = 3;
const MAX_ADVANCE_DAYS = 21;

const TIME = {
  shortStayWindowStart: 8 * 60 + 30,
  eightThirtyAM: 8 * 60 + 30,
  tenAM: 10 * 60,
  noon: 12 * 60,
  twoPM: 14 * 60,
  fourPM: 16 * 60,
  sixPM: 18 * 60,
  eightPM: 20 * 60,
  overnightStart: 19 * 60 + 30,
  workingHoursStart: 8 * 60 + 30, // 8:30am — nothing can check in before this
  workingHoursEnd: 21 * 60 + 45, // 9:45pm — nothing can check in after this
};

const PACKAGE_LABELS = {
  shortStay: 'Short stay',
  overnight: 'Overnight',
  halfDay: 'Half day',
  fullDay: 'Full day',
  multiDay: 'Multi-day',
};

function minutesOfDay(d) {
  return d.getHours() * 60 + d.getMinutes();
}

function calendarDaysBetween(a, b) {
  const aMid = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const bMid = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((bMid - aMid) / MS_PER_DAY);
}

function shortStayTierPrice(room, hours) {
  if (room.shortStayFlat) return room.shortStay3hrPrice;
  return room.shortStay3hrPrice + 10 * (hours - 3);
}

function crosses6pmPrice(room) {
  return room.key === 'white' ? 130 : CROSSES_6PM_PRICE;
}

// Sat/Sun checkout between 10am-4pm costs $20 more than the same time on a
// weekday — weekend turnover is tighter, so a late checkout in that window
// is more disruptive. Before 10am and from 4pm on, weekday and weekend cost
// the same (either well within grace, or already at the steep end).
const WEEKEND_SURCHARGE = 20;

function isWeekend(d) {
  const day = d.getDay();
  return day === 0 || day === 6;
}

function lateCheckoutFee(checkOutMinutes, checkOutDate) {
  const weekendSurcharge =
    isWeekend(checkOutDate) && checkOutMinutes > TIME.tenAM && checkOutMinutes <= TIME.fourPM
      ? WEEKEND_SURCHARGE
      : 0;

  if (checkOutMinutes <= TIME.eightThirtyAM) return 0;
  if (checkOutMinutes <= TIME.tenAM) return 20;
  if (checkOutMinutes <= TIME.noon) return 40 + weekendSurcharge;
  if (checkOutMinutes <= TIME.twoPM) return 60 + weekendSurcharge;
  if (checkOutMinutes <= TIME.fourPM) return 80 + weekendSurcharge;
  if (checkOutMinutes <= TIME.sixPM) return 100;
  return 120;
}

function firstNightBase(room, checkInMinutes) {
  if (checkInMinutes >= TIME.overnightStart) return room.overnightPrice;
  if (checkInMinutes >= TIME.noon) return room.halfDayPrice;
  return room.fullDayPrice;
}

function packageTypeForCheckIn(checkInMinutes) {
  if (checkInMinutes >= TIME.overnightStart) return 'overnight';
  if (checkInMinutes >= TIME.noon) return 'halfDay';
  return 'fullDay';
}

function calculateSameDayPrice(room, checkInMinutes, checkOutMinutes, durationHours) {
  const withinWindow =
    checkInMinutes >= TIME.shortStayWindowStart && checkInMinutes <= room.shortStayLastStart;

  if (withinWindow) {
    if (durationHours < MIN_STAY_HOURS) {
      throw new Error(`Minimum stay is ${MIN_STAY_HOURS} hours.`);
    }
    if (durationHours <= 3.5) {
      return { packageType: 'shortStay', price: shortStayTierPrice(room, 3), isFallbackEstimate: durationHours !== 3 };
    }
    if (durationHours <= 4.5) {
      return { packageType: 'shortStay', price: shortStayTierPrice(room, 4), isFallbackEstimate: durationHours !== 4 };
    }
    if (durationHours <= 5.5) {
      return { packageType: 'shortStay', price: shortStayTierPrice(room, 5), isFallbackEstimate: durationHours !== 5 };
    }
    if (checkInMinutes < TIME.eightPM && checkOutMinutes > TIME.eightPM) {
      return { packageType: 'shortStay', price: CROSSES_8PM_PRICE, isFallbackEstimate: false };
    }
    if (checkInMinutes < TIME.sixPM && checkOutMinutes > TIME.sixPM) {
      return { packageType: 'shortStay', price: crosses6pmPrice(room), isFallbackEstimate: false };
    }
    return { packageType: 'shortStay', price: shortStayTierPrice(room, 5), isFallbackEstimate: true };
  }

  if (checkInMinutes > room.shortStayLastStart) {
    if (durationHours < MIN_STAY_HOURS) {
      throw new Error(`Minimum stay is ${MIN_STAY_HOURS} hours.`);
    }
    return { packageType: 'overnight', price: room.overnightPrice, isFallbackEstimate: false };
  }

  return { packageType: 'fullDay', price: room.fullDayPrice, isFallbackEstimate: true };
}

function calculateMultiNightPrice(room, checkInMinutes, checkOutMinutes, checkOutDate, nights) {
  const base = firstNightBase(room, checkInMinutes) + room.fullDayPrice * (nights - 1);
  const fee = lateCheckoutFee(checkOutMinutes, checkOutDate);
  const packageType = nights >= 2 ? 'multiDay' : packageTypeForCheckIn(checkInMinutes);
  return { packageType, price: base + fee, isFallbackEstimate: false };
}

/** Throws — same shape as calculatePrice.ts. Use quote() below for the
 * customer-facing, non-throwing version. */
function calculatePrice(room, checkIn, checkOut) {
  if (checkOut.getTime() <= checkIn.getTime()) {
    throw new Error('Checkout must be after check-in.');
  }

  const durationHours = (checkOut.getTime() - checkIn.getTime()) / MS_PER_HOUR;
  const dayDiff = calendarDaysBetween(checkIn, checkOut);
  const checkInMinutes = minutesOfDay(checkIn);
  const checkOutMinutes = minutesOfDay(checkOut);

  if (checkInMinutes < TIME.workingHoursStart || checkInMinutes > TIME.workingHoursEnd) {
    throw new Error('Check-in must be between 8:30am and 9:45pm — message us directly for anything outside that.');
  }

  if (dayDiff === 0) {
    return calculateSameDayPrice(room, checkInMinutes, checkOutMinutes, durationHours);
  }
  if (dayDiff > MAX_NIGHTS) {
    throw new Error(`Stays longer than ${MAX_NIGHTS} nights aren't quoted here — message us directly.`);
  }
  return calculateMultiNightPrice(room, checkInMinutes, checkOutMinutes, checkOut, dayDiff);
}

/** Customer-facing wrapper: never throws. Returns
 * { available: true, packageType, packageLabel, price, isFallbackEstimate }
 * or { available: false, reason }. */
function quote(room, checkIn, checkOut) {
  try {
    const result = calculatePrice(room, checkIn, checkOut);
    return {
      available: true,
      packageType: result.packageType,
      packageLabel: PACKAGE_LABELS[result.packageType] || result.packageType,
      price: result.price,
      isFallbackEstimate: result.isFallbackEstimate,
    };
  } catch (err) {
    return { available: false, reason: err.message };
  }
}
