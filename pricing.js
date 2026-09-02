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
    shortStayStartRestricted: true,
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
    shortStayStartRestricted: false,
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
    shortStayStartRestricted: true,
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
  shortStayWindowEnd: 17 * 60 + 30,
  eightThirtyAM: 8 * 60 + 30,
  tenAM: 10 * 60,
  noon: 12 * 60,
  twoPM: 14 * 60,
  fourPM: 16 * 60,
  sixPM: 18 * 60,
  eightPM: 20 * 60,
  overnightStart: 19 * 60 + 30,
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

function lateCheckoutFee(checkOutMinutes) {
  if (checkOutMinutes <= TIME.eightThirtyAM) return 0;
  if (checkOutMinutes <= TIME.tenAM) return 20;
  if (checkOutMinutes <= TIME.noon) return 40;
  if (checkOutMinutes <= TIME.twoPM) return 60;
  if (checkOutMinutes <= TIME.fourPM) return 80;
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
    room.shortStayStartRestricted === false ||
    (checkInMinutes >= TIME.shortStayWindowStart && checkInMinutes <= TIME.shortStayWindowEnd);

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

  if (checkInMinutes > TIME.shortStayWindowEnd) {
    if (durationHours < MIN_STAY_HOURS) {
      throw new Error(`Minimum stay is ${MIN_STAY_HOURS} hours.`);
    }
    return { packageType: 'overnight', price: room.overnightPrice, isFallbackEstimate: false };
  }

  return { packageType: 'fullDay', price: room.fullDayPrice, isFallbackEstimate: true };
}

function calculateMultiNightPrice(room, checkInMinutes, checkOutMinutes, nights) {
  const base = firstNightBase(room, checkInMinutes) + room.fullDayPrice * (nights - 1);
  const fee = lateCheckoutFee(checkOutMinutes);
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

  if (dayDiff === 0) {
    return calculateSameDayPrice(room, checkInMinutes, checkOutMinutes, durationHours);
  }
  if (dayDiff > MAX_NIGHTS) {
    throw new Error(`Stays longer than ${MAX_NIGHTS} nights aren't quoted here — message us directly.`);
  }
  return calculateMultiNightPrice(room, checkInMinutes, checkOutMinutes, dayDiff);
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
