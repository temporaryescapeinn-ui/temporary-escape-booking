// ---- Config — fill these in before deploying ----
const BUSINESS_WHATSAPP_NUMBER = '12462550573';
const BACKEND_URL = 'https://script.google.com/macros/s/AKfycbw813LQUW1FEROgdQ7sv1UEU41_IT2JCek73E2w9_5tXOAo-FrIlJa-7cAmcZ0YY-u4/exec';
const BACKEND_TOKEN = '38HIJH087TG0H';
// ---------------------------------------------------

const el = (id) => document.getElementById(id);

const state = {
  roomKey: null,
  disabledRooms: {}, // { roomKey: reason }
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

// ---- Room status / site notice backend (optional — no-op if BACKEND_URL unset) ----

async function loadStatus() {
  if (!BACKEND_URL) return;
  try {
    const res = await fetch(`${BACKEND_URL}?type=status&token=${encodeURIComponent(BACKEND_TOKEN)}`);
    const data = await res.json();
    if (!data.ok) return;

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
loadStatus();
recompute();
