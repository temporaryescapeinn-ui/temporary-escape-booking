// ---- Config — fill these in before deploying ----
const BUSINESS_WHATSAPP_NUMBER = '12462550573';
const BACKEND_URL = 'https://script.google.com/macros/s/AKfycbw813LQUW1FEROgdQ7sv1UEU41_IT2JCek73E2w9_5tXOAo-FrIlJa-7cAmcZ0YY-u4/exec';
const BACKEND_TOKEN = '38HIJH087TG0H';
// ---------------------------------------------------

const el = (id) => document.getElementById(id);

const state = {
  roomKey: null,
  disabledRooms: {}, // { roomKey: reason }
  availability: null, // { version, days: { 'YYYY-MM-DD': [standard, white, blue] } } — levels 0-3
};

function pad(n) { return String(n).padStart(2, '0'); }
function toDateInputValue(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function toTimeInputValue(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }

function today() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }

function initDateBounds() {
  const min = toDateInputValue(today());
  const max = toDateInputValue(addDays(today(), MAX_ADVANCE_DAYS));
  el('checkinDate').min = min;
  el('checkinDate').max = max;
  el('checkoutDate').min = min;
}

function updateCheckoutBounds() {
  const checkin = readDate('checkinDate');
  if (!checkin) return;
  el('checkoutDate').min = toDateInputValue(checkin);
  el('checkoutDate').max = toDateInputValue(addDays(checkin, 3));
}

function readDate(dateId) {
  const v = el(dateId).value;
  if (!v) return null;
  const [y, m, d] = v.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function readDateTime(dateId, timeId) {
  const date = readDate(dateId);
  const timeVal = el(timeId).value;
  if (!date || !timeVal) return null;
  const [hh, mm] = timeVal.split(':').map(Number);
  const result = new Date(date);
  result.setHours(hh, mm, 0, 0);
  return result;
}

function setDateTime(dateId, timeId, d) {
  el(dateId).value = toDateInputValue(d);
  el(timeId).value = toTimeInputValue(d);
}

function ensureCheckin() {
  let checkin = readDateTime('checkinDate', 'checkinTime');
  if (!checkin) {
    checkin = new Date();
    checkin.setMinutes(Math.ceil(checkin.getMinutes() / 5) * 5, 0, 0);
    setDateTime('checkinDate', 'checkinTime', checkin);
  }
  return checkin;
}

// ---- Room picker ----

function selectRoom(key) {
  if (state.disabledRooms[key]) return;
  state.roomKey = key;
  document.querySelectorAll('.room-card').forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.room === key);
  });
  recompute();
}

document.querySelectorAll('.room-card').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    if (e.target.closest('[data-room-info]')) return;
    selectRoom(btn.dataset.room);
  });
  btn.addEventListener('keydown', (e) => {
    if (e.target.closest('[data-room-info]')) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectRoom(btn.dataset.room);
    }
  });
});

el('roomGrid').querySelectorAll('[data-room-info]').forEach((infoBtn) => {
  infoBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const panel = el('roomInfoPanel');
    panel.hidden = !panel.hidden;
  });
});

// ---- Check-in Today/Tomorrow chips ----

document.querySelectorAll('.chip[data-day-target="checkin"]').forEach((chip) => {
  chip.addEventListener('click', () => {
    const offset = Number(chip.dataset.offset);
    const d = addDays(today(), offset);
    el('checkinDate').value = toDateInputValue(d);
    document.querySelectorAll('.chip[data-day-target="checkin"]').forEach((c) => c.classList.toggle('selected', c === chip));
    updateCheckoutBounds();
    recompute();
  });
});

// ---- Shortcuts (set checkout from whatever check-in already is) ----

const SHORTCUTS = {
  shortStay: (checkin) => { const d = new Date(checkin); d.setHours(d.getHours() + 3); return d; },
  overnight: (checkin) => { const d = addDays(checkin, 1); d.setHours(8, 0, 0, 0); return d; },
  halfDay: (checkin) => { const d = addDays(checkin, 1); d.setHours(8, 0, 0, 0); return d; },
  fullDay: (checkin) => { const d = addDays(checkin, 1); d.setHours(8, 0, 0, 0); return d; },
};

document.querySelectorAll('.shortcut').forEach((btn) => {
  btn.addEventListener('click', () => {
    const checkin = ensureCheckin();
    const checkout = SHORTCUTS[btn.dataset.shortcut](checkin);
    setDateTime('checkoutDate', 'checkoutTime', checkout);
    document.querySelectorAll('.shortcut').forEach((b) => b.classList.toggle('selected', b === btn));
    updateCheckoutBounds();
    recompute();
  });
});

// ---- Manual field edits also recompute, and clear the "selected" shortcut state ----

function syncCheckinChips() {
  const checkin = readDate('checkinDate');
  const checkinValue = checkin ? toDateInputValue(checkin) : null;
  document.querySelectorAll('.chip[data-day-target="checkin"]').forEach((chip) => {
    const chipDate = toDateInputValue(addDays(today(), Number(chip.dataset.offset)));
    chip.classList.toggle('selected', checkinValue === chipDate);
  });
}

['checkinDate', 'checkinTime'].forEach((id) => {
  el(id).addEventListener('change', () => {
    syncCheckinChips();
    updateCheckoutBounds();
    recompute();
  });
});
['checkoutDate', 'checkoutTime'].forEach((id) => {
  el(id).addEventListener('change', () => {
    document.querySelectorAll('.shortcut').forEach((b) => b.classList.remove('selected'));
    recompute();
  });
});

// ---- Recap + price ----

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatRecapTime(d) {
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${WEEKDAY[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]}, ${h}:${pad(m)}${ampm}`;
}

let lastQuote = null;

function recompute() {
  recomputeQuote();
  updateHint();
}

function recomputeQuote() {
  const room = state.roomKey ? ROOMS[state.roomKey] : null;
  const checkin = readDateTime('checkinDate', 'checkinTime');
  const checkout = readDateTime('checkoutDate', 'checkoutTime');

  const priceValueEl = el('priceValue');
  const packageLabelEl = el('packageLabel');
  const unavailableEl = el('unavailableReason');
  const whatsappBtn = el('whatsappBtn');
  const btnLabel = el('whatsappBtnLabel');

  if (!room) {
    el('recapRoom').textContent = 'Pick a room and time';
    el('recapTimes').textContent = '';
    priceValueEl.hidden = true;
    packageLabelEl.hidden = true;
    unavailableEl.hidden = true;
    whatsappBtn.disabled = true;
    btnLabel.textContent = 'Continue on WhatsApp';
    lastQuote = null;
    return;
  }

  el('recapRoom').textContent = `${room.label} room`;

  const disabledReason = state.disabledRooms[room.key];
  if (disabledReason) {
    el('recapTimes').textContent = '';
    priceValueEl.hidden = true;
    packageLabelEl.hidden = true;
    unavailableEl.hidden = false;
    unavailableEl.textContent = disabledReason;
    whatsappBtn.disabled = true;
    lastQuote = null;
    return;
  }

  if (!checkin || !checkout) {
    el('recapTimes').textContent = 'Pick check-in and checkout times';
    priceValueEl.hidden = true;
    packageLabelEl.hidden = true;
    unavailableEl.hidden = true;
    whatsappBtn.disabled = true;
    lastQuote = null;
    return;
  }

  el('recapTimes').textContent = `${formatRecapTime(checkin)} → ${formatRecapTime(checkout)}`;

  if (checkin.getTime() < Date.now()) {
    priceValueEl.hidden = true;
    packageLabelEl.hidden = true;
    unavailableEl.hidden = false;
    unavailableEl.textContent = "Check-in can't be in the past — pick a later time.";
    whatsappBtn.disabled = true;
    lastQuote = null;
    return;
  }

  // The date input's max attribute is only a hint (a typed-in date stays in
  // the field), so the 3-week booking window has to be enforced here too.
  const checkinDay = new Date(checkin.getFullYear(), checkin.getMonth(), checkin.getDate());
  if (checkinDay.getTime() > addDays(today(), MAX_ADVANCE_DAYS).getTime()) {
    priceValueEl.hidden = true;
    packageLabelEl.hidden = true;
    unavailableEl.hidden = false;
    unavailableEl.textContent = 'Bookings open up to 3 weeks ahead — pick an earlier date.';
    whatsappBtn.disabled = true;
    lastQuote = null;
    return;
  }

  const result = quote(room, checkin, checkout);
  lastQuote = { room, checkin, checkout, result };

  if (!result.available) {
    priceValueEl.hidden = true;
    packageLabelEl.hidden = true;
    unavailableEl.hidden = false;
    unavailableEl.textContent = result.reason;
    whatsappBtn.disabled = true;
    btnLabel.textContent = 'Continue on WhatsApp';
    return;
  }

  packageLabelEl.hidden = false;
  packageLabelEl.textContent = result.packageLabel + (result.isFallbackEstimate ? ' (estimate)' : '');
  priceValueEl.hidden = false;
  priceValueEl.textContent = `$${result.price}`;
  unavailableEl.hidden = true;
  whatsappBtn.disabled = false;
  btnLabel.textContent = 'Continue on WhatsApp';
}

// ---- Availability hint ("temperature") ----
// The backend sends a level 0-3 per day and room group. The page turns that into
// a soft note under the form. It never blocks anything: the WhatsApp button
// works exactly the same with or without a note.

const AVAIL_CACHE_KEY = 'te-availability-v1';
const AVAIL_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000; // before the server answers, trust a cached copy this long
const AVAIL_ROOM_INDEX = { standard: 0, white: 1, blue: 2 };
const FULL_WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HINT_WORD = { 1: 'tightening', 2: 'limited', 3: 'very limited' };
const HINT_CTA = { 1: 'Continue below.', 2: 'Continue below.', 3: "Continue below and we'll confirm." };

function loadAvailabilityCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(AVAIL_CACHE_KEY));
    if (cached && cached.days && Date.now() - cached.savedAt < AVAIL_CACHE_MAX_AGE_MS) {
      state.availability = { version: cached.version, days: cached.days };
    }
  } catch (err) {
    // no storage, or a bad entry — hints just start empty
  }
}

function saveAvailabilityCache() {
  try {
    if (state.availability) {
      localStorage.setItem(AVAIL_CACHE_KEY, JSON.stringify({ ...state.availability, savedAt: Date.now() }));
    } else {
      localStorage.removeItem(AVAIL_CACHE_KEY);
    }
  } catch (err) {
    // private mode etc. — the cache is only a speed-up
  }
}

/** The server's answer to our cached version: null means "no trustworthy data",
 * { unchanged } means keep what we have, otherwise a new set of days. */
function applyAvailability(incoming) {
  if (!incoming) {
    state.availability = null;
  } else if (incoming.unchanged) {
    if (state.availability) state.availability.version = incoming.version;
  } else if (incoming.days && typeof incoming.days === 'object') {
    state.availability = { version: incoming.version, days: incoming.days };
  }
  saveAvailabilityCache();
}

/** The days a stay occupies, in the same terms the backend uses: from the
 * check-in date up to the day before checkout, plus the checkout date only if
 * checkout is after noon. A same-day stay is that one day. */
function stayDays(checkin, checkout) {
  const first = new Date(checkin.getFullYear(), checkin.getMonth(), checkin.getDate());
  const outDay = new Date(checkout.getFullYear(), checkout.getMonth(), checkout.getDate());
  let last = addDays(outDay, -1);
  if (outDay.getTime() === first.getTime()) last = first;
  else if (checkout.getHours() * 60 + checkout.getMinutes() > 12 * 60) last = outDay;
  const days = [];
  for (let d = first; d.getTime() <= last.getTime() && days.length < 5; d = addDays(d, 1)) {
    days.push({ key: toDateInputValue(d), date: d });
  }
  return days;
}

/** { level, line, cta } for the chosen room and dates, or null for no note. */
function hintFor(room, checkin, checkout) {
  const idx = AVAIL_ROOM_INDEX[room.key];
  if (idx === undefined || !state.availability) return null;

  const days = stayDays(checkin, checkout);
  const pressured = [];
  let level = 0;
  days.forEach((day) => {
    const row = state.availability.days[day.key];
    const l = row ? Number(row[idx]) || 0 : 0;
    if (l > 0) {
      pressured.push(day);
      level = Math.max(level, l);
    }
  });
  if (!level) return null;

  if (days[0].key === toDateInputValue(today())) {
    return { level, line: 'Availability for today depends on current bookings.', cta: "Continue below and we'll check." };
  }
  const line = pressured.length === 1
    ? `${FULL_WEEKDAY[pressured[0].date.getDay()]} availability is ${HINT_WORD[level]}.`
    : `Chosen nights are ${HINT_WORD[level]}.`;
  return { level, line, cta: HINT_CTA[level] };
}

function closeHintNote() {
  el('tempHintNote').hidden = true;
  el('tempHintInfo').setAttribute('aria-expanded', 'false');
}

function updateHint() {
  const box = el('tempHint');
  const hint = lastQuote && lastQuote.result.available ? hintFor(lastQuote.room, lastQuote.checkin, lastQuote.checkout) : null;
  if (!hint) {
    box.hidden = true;
    closeHintNote();
    return;
  }
  box.className = `temp-hint temp-hint--${hint.level}`;
  el('tempHintLine').textContent = hint.line;
  el('tempHintCta').textContent = hint.cta;
  box.hidden = false;
}

el('tempHintInfo').addEventListener('click', (e) => {
  e.stopPropagation();
  const note = el('tempHintNote');
  note.hidden = !note.hidden;
  el('tempHintInfo').setAttribute('aria-expanded', String(!note.hidden));
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#tempHintNote')) closeHintNote();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeHintNote();
});

// ---- Room status / site notice backend (optional — no-op if BACKEND_URL unset) ----

async function loadStatus() {
  if (!BACKEND_URL) return;
  try {
    const known = state.availability && state.availability.version ? `&av=${encodeURIComponent(state.availability.version)}` : '';
    const res = await fetch(`${BACKEND_URL}?type=status&token=${encodeURIComponent(BACKEND_TOKEN)}${known}`);
    const data = await res.json();
    if (!data.ok) return;

    // An older backend has no `availability` field; leave any hints alone then.
    if ('availability' in data) applyAvailability(data.availability);

    if (data.banner) {
      el('siteBanner').textContent = data.banner;
      el('siteBanner').hidden = false;
    }

    state.disabledRooms = data.disabledRooms || {};
    document.querySelectorAll('.room-card').forEach((btn) => {
      const key = btn.dataset.room;
      const disabled = !!state.disabledRooms[key];
      btn.classList.toggle('disabled', disabled);
      btn.setAttribute('aria-disabled', String(disabled));
      btn.tabIndex = disabled ? -1 : 0;
    });
    const notice = el('roomNotice');
    const activeDisabledReason = state.roomKey ? state.disabledRooms[state.roomKey] : null;
    if (activeDisabledReason) {
      notice.textContent = activeDisabledReason;
      notice.hidden = false;
    } else {
      notice.hidden = true;
    }
    recompute();
  } catch (err) {
    // best-effort — a status fetch failure should never block the page
  }
}

// ---- WhatsApp hand-off ----

function buildWaMeUrl(phone, message) {
  const digits = phone.replace(/\D/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

function buildMessage(room, checkin, checkout, result) {
  const roomLine = room.subtitle ? `${room.label} (${room.subtitle})` : room.label;
  return `Hi, I'd like to request a booking:\n\nRoom: ${roomLine}\nCheck-in: ${formatRecapTime(checkin)}\nCheck-out: ${formatRecapTime(checkout)}\nPrice: $${result.price}\n\nPlease let me know if this is available.`;
}

function logRequest(room, checkin, checkout, result) {
  if (!BACKEND_URL) return;
  const payload = {
    type: 'logRequest',
    token: BACKEND_TOKEN,
    room: room.label,
    checkIn: checkin.toISOString(),
    checkOut: checkout.toISOString(),
    packageType: result.packageType,
    price: result.price,
  };
  fetch(BACKEND_URL, {
    method: 'POST',
    body: JSON.stringify(payload),
  }).catch(() => {
    // best-effort — never block the WhatsApp hand-off on this
  });
}

el('whatsappBtn').addEventListener('click', () => {
  if (!lastQuote || !lastQuote.result.available) return;
  const { room, checkin, checkout, result } = lastQuote;
  logRequest(room, checkin, checkout, result);
  const message = buildMessage(room, checkin, checkout, result);
  window.location.href = buildWaMeUrl(BUSINESS_WHATSAPP_NUMBER, message);
});

// ---- Init ----

initDateBounds();
loadAvailabilityCache();
loadStatus();
recompute();
