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
  link: null, // { kind: 'shortStay' | 'overnight', extraDays } — the shortcut checkout follows check-in
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

// ---- Defaults, 5-minute steps and limits ----

const TIME_STEP_MINUTES = 5;
const FALLBACK_CHECKIN_HOUR = 9; // check-in when a date is picked with no time, or today has none left
const DEFAULT_CHECKOUT_HOUR = 8; // "Add a day" with no checkout yet: 8:00am, still inside the free grace

function dayStart(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function sameDay(a, b) { return dayStart(a).getTime() === dayStart(b).getTime(); }
function formatMinutes(total) { return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`; }

/** The soonest check-in that is valid right now: the next 5-minute mark inside
 * 8:30am-9:45pm, or 9:00am tomorrow once today has no valid time left. */
function nextValidCheckin() {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes() + 1; // +1: never land on a minute that has already begun
  const rounded = Math.ceil(minutes / TIME_STEP_MINUTES) * TIME_STEP_MINUTES;
  if (rounded <= TIME.workingHoursEnd) {
    const m = Math.max(rounded, TIME.workingHoursStart);
    const d = today();
    d.setHours(Math.floor(m / 60), m % 60, 0, 0);
    return d;
  }
  const tomorrow = addDays(today(), 1);
  tomorrow.setHours(FALLBACK_CHECKIN_HOUR, 0, 0, 0);
  return tomorrow;
}

/** Times snap to the nearest 5 minutes, since phone pickers don't always honour the step. */
function snapTimeField(id) {
  const value = el(id).value;
  if (!value) return;
  const [h, m] = value.split(':').map(Number);
  const total = Math.min(Math.round((h * 60 + m) / TIME_STEP_MINUTES) * TIME_STEP_MINUTES, 24 * 60 - TIME_STEP_MINUTES);
  el(id).value = formatMinutes(total);
}

/** Returns the check-in, filling in whatever is missing with something valid. */
function ensureCheckin() {
  let checkin = readDateTime('checkinDate', 'checkinTime');
  if (checkin) return checkin;

  const date = readDate('checkinDate');
  if (date && date.getTime() > today().getTime()) {
    checkin = new Date(date); // a future date with no time yet
    checkin.setHours(FALLBACK_CHECKIN_HOUR, 0, 0, 0);
  } else {
    checkin = nextValidCheckin();
  }
  setDateTime('checkinDate', 'checkinTime', checkin);
  syncCheckinChips();
  updateCheckoutBounds();
  return checkin;
}

/** Nights between two moments' calendar dates; the page quotes at most MAX_NIGHTS. */
function withinNightLimit(checkin, checkout) {
  return Math.round((dayStart(checkout) - dayStart(checkin)) / 86400000) <= MAX_NIGHTS;
}

function updateTimeBounds() {
  const checkinDay = readDate('checkinDate');
  let first = TIME.workingHoursStart;
  if (checkinDay && sameDay(checkinDay, new Date())) {
    const soonest = nextValidCheckin();
    if (sameDay(soonest, new Date())) first = Math.max(first, soonest.getHours() * 60 + soonest.getMinutes());
  }
  el('checkinTime').min = formatMinutes(first);
  el('checkinTime').max = formatMinutes(TIME.workingHoursEnd);

  // A same-day checkout can't be earlier than the minimum stay after check-in.
  const checkin = readDateTime('checkinDate', 'checkinTime');
  const checkoutDay = readDate('checkoutDate');
  let checkoutMin = '';
  if (checkin && checkoutDay && sameDay(checkin, checkoutDay)) {
    const earliest = new Date(checkin.getTime() + MIN_STAY_HOURS * 3600000);
    if (sameDay(earliest, checkin)) checkoutMin = toTimeInputValue(earliest);
  }
  el('checkoutTime').min = checkoutMin;
}

/** "Today" is pointless once today has no valid check-in time left. */
function updateTodayChip() {
  const chip = document.querySelector('.chip[data-day-target="checkin"][data-offset="0"]');
  chip.disabled = !sameDay(nextValidCheckin(), new Date());
}

// ---- Room picker ----

const ROOM_DESCRIPTIONS = {
  standard: 'Standard covers our Yellow, Orange and Green rooms.',
  white: 'White is our premium room, with more amenities.',
  blue: 'Blue is smaller than our other rooms.',
};

// `isDefault` marks the page's own preselection, so it can be undone if the room
// turns out to be switched off; a room the customer tapped is never undone.
function selectRoom(key, isDefault) {
  if (state.disabledRooms[key]) return;
  state.roomKey = key;
  state.roomIsDefault = !!isDefault;
  document.querySelectorAll('.room-card').forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.room === key);
  });
  el('roomInfoPanel').textContent = ROOM_DESCRIPTIONS[key] || '';
  recompute();
}

function clearRoom() {
  state.roomKey = null;
  state.roomIsDefault = false;
  document.querySelectorAll('.room-card').forEach((btn) => btn.classList.remove('selected'));
  el('roomInfoPanel').textContent = '';
}

document.querySelectorAll('.room-card').forEach((btn) => {
  btn.addEventListener('click', () => selectRoom(btn.dataset.room));
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectRoom(btn.dataset.room);
    }
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
    applyLink();
    recompute();
  });
});

// ---- Shortcuts (set checkout from whatever check-in already is) ----

const SHORTCUTS = {
  shortStay: (checkin) => { const d = new Date(checkin); d.setHours(d.getHours() + 3); return d; },
  overnight: (checkin) => { const d = addDays(checkin, 1); d.setHours(DEFAULT_CHECKOUT_HOUR, 0, 0, 0); return d; },
};

// A shortcut stays "linked" to the check-in: change the check-in afterwards and the
// checkout follows (a linked shortcut plus any days added with "Add a day").
function linkedCheckout(checkin, link) {
  const checkout = SHORTCUTS[link.kind](checkin);
  return link.extraDays ? addDays(checkout, link.extraDays) : checkout;
}

function setLink(link) {
  state.link = link;
  document.querySelectorAll('.shortcut[data-shortcut]').forEach((b) => {
    b.classList.toggle('selected', !!link && b.dataset.shortcut === link.kind);
  });
}

/** Re-applies the linked shortcut to the current check-in, never past the night limit. */
function applyLink() {
  const checkin = readDateTime('checkinDate', 'checkinTime');
  if (!checkin || !state.link) return;
  while (state.link.extraDays > 0 && !withinNightLimit(checkin, linkedCheckout(checkin, state.link))) {
    state.link.extraDays -= 1;
  }
  setDateTime('checkoutDate', 'checkoutTime', linkedCheckout(checkin, state.link));
  updateCheckoutBounds();
}

document.querySelectorAll('.shortcut[data-shortcut]').forEach((btn) => {
  btn.addEventListener('click', () => {
    ensureCheckin();
    setLink({ kind: btn.dataset.shortcut, extraDays: 0 });
    applyLink();
    recompute();
  });
});

// "Add a day" moves the checkout a day later, whatever produced the current one.
el('addDayBtn').addEventListener('click', () => {
  const checkin = ensureCheckin();
  const checkout = readDateTime('checkoutDate', 'checkoutTime');
  if (!checkout) {
    // Nothing yet: one night, out at 8:00am the next morning.
    setLink({ kind: 'overnight', extraDays: 0 });
    applyLink();
  } else if (!withinNightLimit(checkin, addDays(checkout, 1))) {
    return;
  } else if (state.link) {
    state.link.extraDays += 1;
    applyLink();
  } else {
    setDateTime('checkoutDate', 'checkoutTime', addDays(checkout, 1));
    updateCheckoutBounds();
  }
  recompute();
});

function updateAddDayState() {
  const checkin = readDateTime('checkinDate', 'checkinTime');
  const checkout = readDateTime('checkoutDate', 'checkoutTime');
  el('addDayBtn').disabled = !!(checkin && checkout) && !withinNightLimit(checkin, addDays(checkout, 1));
}

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
    if (id === 'checkinTime') snapTimeField(id);
    syncCheckinChips();
    updateCheckoutBounds();
    applyLink(); // a linked shortcut's checkout follows the new check-in
    recompute();
  });
});
['checkoutDate', 'checkoutTime'].forEach((id) => {
  el(id).addEventListener('change', () => {
    if (id === 'checkoutTime') snapTimeField(id);
    setLink(null); // an edited checkout is the customer's own, so stop following check-in
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
  updateTimeBounds();
  updateAddDayState();
  updateTodayChip();
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
// One word per level is picked at random when the page loads and then kept for the
// whole visit, so the note doesn't change wording while someone adjusts their dates.
const HINT_WORDS = {
  1: ['narrowing', 'shrinking', 'thinning'],
  2: ['limited', 'low', 'scarce'],
  3: ['very limited', 'very tight', 'very low', 'slim'],
};
const HINT_CTA = { 1: 'Continue below.', 2: 'Continue below.', 3: "Continue below and we'll confirm." };

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

const hintWords = {
  1: pickRandom(HINT_WORDS[1]),
  2: pickRandom(HINT_WORDS[2]),
  3: pickRandom(HINT_WORDS[3]),
};

/** Writes the bold line, keeping it to one line: if the chosen word wraps (the
 * longest weekday on a narrow phone), tries the level's other words, shortest
 * first, and keeps the first that fits. The box must be visible to measure. */
function fitHintLine(hint) {
  const lineEl = el('tempHintLine');
  const lineHeight = parseFloat(getComputedStyle(lineEl).lineHeight) || 18;
  const wraps = () => lineEl.offsetHeight > lineHeight * 1.5;
  lineEl.textContent = hint.lineFor(hintWords[hint.level]);
  if (!wraps()) return;
  const shortestFirst = HINT_WORDS[hint.level].slice().sort((a, b) => a.length - b.length);
  for (let i = 0; i < shortestFirst.length; i++) {
    lineEl.textContent = hint.lineFor(shortestFirst[i]);
    if (!wraps()) return;
  }
  // Nothing fits (a very narrow phone): settle on the shortest, so it wraps as little as possible.
  lineEl.textContent = hint.lineFor(shortestFirst[0]);
}

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

/** { level, lineFor(word), cta } for the chosen room and dates, or null for no note. */
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
    return { level, lineFor: (word) => `Availability today is ${word}.`, cta: "Continue below and we'll check." };
  }
  if (pressured.length === 1) {
    const dayName = FULL_WEEKDAY[pressured[0].date.getDay()];
    return { level, lineFor: (word) => `${dayName} availability is ${word}.`, cta: HINT_CTA[level] };
  }
  return { level, lineFor: (word) => `Chosen nights are ${word}.`, cta: HINT_CTA[level] };
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
  el('tempHintCta').textContent = hint.cta;
  box.hidden = false;
  fitHintLine(hint);
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
    // The page preselects Standard before it knows what's switched off; undo that
    // if Standard turns out to be disabled, so a closed room isn't left selected.
    if (state.roomIsDefault && state.roomKey && state.disabledRooms[state.roomKey]) clearRoom();
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
selectRoom('standard', true); // Standard is the default; Blue and White are a deliberate change
loadStatus();
recompute();
