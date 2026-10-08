(() => {
  'use strict';

  const STORE_KEY = 'lunchTracker.v1';
  const MEALS = ['breakfast', 'lunch'];
  const MEAL_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch' };
  const COMBOS = window.MEAL_COMBOS || {};
  const ITEMS = (window.MENU_ITEMS || []).map(i => ({
    ...i,
    cents: i.price == null ? null : Math.round(i.price * 100),
  })).sort((a, b) => a.name.localeCompare(b.name) || a.servingLabel.localeCompare(b.servingLabel));
  const BY_ID = new Map(ITEMS.map(i => [i.id, i]));
  const STATIONS = [...new Set(ITEMS.map(i => i.station))].sort();

  const NUTRIENTS = [
    ['fat', 'Total fat', 'g'], ['satFat', 'Saturated fat', 'g'], ['cholesterol', 'Cholesterol', 'mg'],
    ['sodium', 'Sodium', 'mg'], ['carbs', 'Carbs', 'g'], ['fiber', 'Fiber', 'g'],
    ['sugar', 'Sugar', 'g'], ['addedSugar', 'Added sugar', 'g'], ['protein', 'Protein', 'g'],
  ];

  // ---------- helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = c => '$' + (c / 100).toFixed(2);
  const pad = n => String(n).padStart(2, '0');
  const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); };
  const todayKey = () => keyOf(new Date());
  const weekStart = k => { const d = parseKey(k); return addDays(k, -((d.getDay() + 6) % 7)); }; // Monday
  const fmtDate = (k, opts) => parseKey(k).toLocaleDateString('en-US', opts || { weekday: 'short', month: 'short', day: 'numeric' });
  const dayName = k => {
    const t = todayKey();
    if (k === t) return 'Today';
    if (k === addDays(t, -1)) return 'Yesterday';
    if (k === addDays(t, 1)) return 'Tomorrow';
    return fmtDate(k);
  };
  const MAX_QTY = 99;
  const MAX_BUDGET_CENTS = 100000; // $1,000
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const inCents = v => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n * 100), MAX_BUDGET_CENTS) : null;
  };

  // ---------- state ----------
  const blank = () => ({ entries: [], budget: { daily: null, weekly: null } });
  let memoryOnly = null;
  // Saved data is untrusted (it can be edited in dev tools or corrupted), so rebuild every field.
  const text = (v, max) => String(v ?? '').slice(0, max);
  function cleanEntry(e) {
    if (!e || typeof e !== 'object') return null;
    const qty = Math.floor(Number(e.qty));
    const cents = e.cents == null ? null : Number(e.cents);
    const cal = e.cal == null ? null : Number(e.cal);
    if (typeof e.date !== 'string' || !DATE_RE.test(e.date) || Number.isNaN(parseKey(e.date).getTime())) return null;
    if (!MEALS.includes(e.meal) || !(qty >= 1)) return null;
    if (cents !== null && !(Number.isInteger(cents) && cents >= 0 && cents <= 100000)) return null;
    const itemId = text(e.itemId, 120);
    return {
      key: `${e.date}|${e.meal}|${itemId}`, date: e.date, meal: e.meal, itemId,
      name: text(e.name, 120), serving: text(e.serving, 60), cents,
      cal: cal !== null && Number.isFinite(cal) && cal >= 0 && cal <= 100000 ? cal : null,
      qty: Math.min(qty, MAX_QTY),
    };
  }
  function cleanState(s) {
    const merged = new Map();
    for (const raw of Array.isArray(s && s.entries) ? s.entries : []) {
      const e = cleanEntry(raw);
      if (!e) continue;
      const dup = merged.get(e.key);
      if (dup) dup.qty = Math.min(MAX_QTY, dup.qty + e.qty); else merged.set(e.key, e);
    }
    const goal = v => (Number.isInteger(v) && v > 0 && v <= MAX_BUDGET_CENTS ? v : null);
    const b = (s && s.budget) || {};
    return { entries: [...merged.values()], budget: { daily: goal(b.daily), weekly: goal(b.weekly) } };
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return cleanState(JSON.parse(raw));
    } catch (e) { /* storage unavailable or corrupt: start fresh */ }
    return memoryOnly || blank();
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch (e) { memoryOnly = state; toast("Couldn't save to this browser, so changes will be lost when you close the page."); }
  }
  let state = load();
  const ui = {
    tab: 'menu',
    date: todayKey(),
    filters: { meal: 'lunch', station: 'all', price: 'all', q: '' },
  };

  // ---------- calculations ----------
  const entriesOn = date => state.entries.filter(e => e.date === date);
  function totals(entries) {
    let cents = 0, cal = 0, items = 0, na = 0;
    for (const e of entries) {
      items += e.qty;
      if (e.cents == null) na += e.qty; else cents += e.cents * e.qty;
      if (e.cal != null) cal += e.cal * e.qty;
    }
    return { cents, cal, items, na };
  }
  const dayTotals = date => totals(entriesOn(date));
  function rangeTotals(from, to) { // inclusive keys
    return totals(state.entries.filter(e => e.date >= from && e.date <= to));
  }
  const level = (spent, goal) => !goal ? '' : spent > goal ? 'over' : spent >= goal * 0.8 ? 'near' : '';

  // ---------- price / item markup ----------
  function priceHtml(cents, item) {
    if (cents == null) return '<span class="price na" title="No price was listed for this item">N/A</span>';
    const est = item && item.estimated !== false && !item.combo;
    const why = item && (item.priceNote || (item.source ? `Estimated from the district list: ${item.source}` : 'Estimated price'));
    return `<span class="price">${money(cents)}${est ? `<span class="est" title="${esc(why)}">est.</span>` : ''}</span>`;
  }
  function nutritionHtml(n) {
    const rows = NUTRIENTS.filter(([k]) => n[k] != null).map(([k, label, u]) => `<dt>${label}</dt><dd>${n[k]} ${u}</dd>`).join('');
    return rows ? `<details class="nut"><summary>Nutrition</summary><dl>${rows}</dl></details>` : '';
  }
  function itemCard(i) {
    const inDay = entriesOn(ui.date).filter(e => e.itemId === i.id).reduce((s, e) => s + e.qty, 0);
    const cal = i.nutrition.calories;
    return `<article class="item">
      <div class="item-head">
        <div><h3>${esc(i.name)}</h3><p class="meta">${esc(i.servingLabel)} &middot; ${esc(i.station)}</p></div>
        ${priceHtml(i.cents, i)}
      </div>
      <div class="item-foot">
        <span class="cal">${cal != null ? `<strong>${cal}</strong> cal` : 'Calories n/a'}${inDay ? ` &middot; <strong>&times;${inDay}</strong> in your day` : ''}</span>
        <button class="btn primary small" data-action="add" data-id="${esc(i.id)}" aria-label="Add ${esc(i.name)}, ${esc(i.servingLabel)}">Add</button>
      </div>
      ${nutritionHtml(i.nutrition)}
    </article>`;
  }

  // ---------- menu panel ----------
  function buildMenuShell() {
    const chip = (group, value, label) => `<button class="chip" data-action="filter" data-group="${group}" data-value="${esc(value)}" aria-pressed="false">${esc(label)}</button>`;
    $('#panel-menu').innerHTML = `
      <div class="combos">
        ${MEALS.filter(m => COMBOS[m]).map(m => `
          <button class="combo" data-action="combo" data-meal="${m}">
            <div><b>${esc(COMBOS[m].name)}</b><span>Add the full ${m} meal</span></div>
            <div class="amt">${money(COMBOS[m].priceCents)}</div>
          </button>`).join('')}
      </div>
      <div class="filters">
        <input class="search" type="search" id="search" placeholder="Search the menu (try &quot;pizza&quot;)" aria-label="Search the menu" autocomplete="off">
        <div class="filter-row"><span class="lbl">Meal</span><div class="chips">${chip('meal', 'all', 'All')}${MEALS.map(m => chip('meal', m, MEAL_LABEL[m])).join('')}</div></div>
        <div class="filter-row"><span class="lbl">Price</span><div class="chips">${chip('price', 'all', 'All')}${chip('price', 'priced', 'Has a price')}${chip('price', 'na', 'N/A')}</div></div>
        <div class="filter-row"><span class="lbl">Station</span><div class="chips">${chip('station', 'all', 'All')}${STATIONS.map(s => chip('station', s, s)).join('')}</div></div>
      </div>
      <p class="hint" id="resultCount" aria-live="polite"></p>
      <div class="items" id="itemList"></div>`;
  }
  function renderItemList() {
    const f = ui.filters, q = f.q.trim().toLowerCase();
    const list = ITEMS.filter(i =>
      (f.meal === 'all' || i.meals.includes(f.meal)) &&
      (f.station === 'all' || i.station === f.station) &&
      (f.price === 'all' || (f.price === 'priced') === (i.cents != null)) &&
      (!q || i.name.toLowerCase().includes(q)));
    $$('.chip').forEach(c => c.setAttribute('aria-pressed', String(f[c.dataset.group] === c.dataset.value)));
    $('#resultCount').textContent = `${list.length} item${list.length === 1 ? '' : 's'}`;
    $('#itemList').innerHTML = list.length ? list.map(itemCard).join('') : '<p class="empty">Nothing matches. Try clearing a filter.</p>';
  }

  // ---------- tray (my day) ----------
  function renderTray(el, compact) {
    const entries = entriesOn(ui.date);
    const t = totals(entries);
    let body;
    if (!entries.length) {
      body = `<p class="empty">${compact ? 'Add items from the menu.' : 'Nothing logged for this day yet.'}</p>${compact ? '' : '<div class="actions center"><button class="btn primary" data-tab-go="menu">Browse the menu</button></div>'}`;
    } else {
      body = MEALS.map(m => {
        const rows = entries.filter(e => e.meal === m);
        if (!rows.length) return '';
        return `<div class="tray-group"><h3>${MEAL_LABEL[m]}</h3>${rows.map(e => `
          <div class="row">
            <div><div class="row-name">${esc(e.name)}</div><div class="meta">${esc(e.serving)}${e.cal != null ? ` &middot; ${e.cal * e.qty} cal` : ''}</div></div>
            <div class="row-price ${e.cents == null ? 'na' : ''}">${e.cents == null ? 'N/A' : money(e.cents * e.qty)}</div>
            <div class="row-ctrl">
              <button class="step" data-action="qty" data-key="${esc(e.key)}" data-d="-1" aria-label="One less ${esc(e.name)}">&minus;</button>
              <span class="qty">${e.qty}</span>
              <button class="step" data-action="qty" data-key="${esc(e.key)}" data-d="1" aria-label="One more ${esc(e.name)}">+</button>
              <button class="link-btn" data-action="remove" data-key="${esc(e.key)}" aria-label="Remove ${esc(e.name)}">Remove</button>
            </div>
          </div>`).join('')}</div>`;
      }).join('') + `
        <div class="totals">
          <div class="big"><span>Total spent</span><span>${money(t.cents)}</span></div>
          <div class="meta"><span>${t.items} item${t.items === 1 ? '' : 's'}</span><span>${t.cal} cal</span></div>
        </div>
        ${t.na ? `<p class="note"><b>${t.na} item${t.na === 1 ? ' has' : 's have'} no price (N/A)</b> and ${t.na === 1 ? "isn't" : "aren't"} counted in your total.</p>` : ''}
        <div class="actions top-gap"><button class="btn danger small" data-action="clear-day">Clear this day</button></div>`;
    }
    el.innerHTML = `<div class="card-box tray"><h2 class="h2"><span>${esc(dayName(ui.date))}</span><span class="meta">${esc(fmtDate(ui.date, { month: 'short', day: 'numeric', year: 'numeric' }))}</span></h2>${body}</div>`;
  }

  // ---------- summary ----------
  function renderSummary() {
    const t = dayTotals(ui.date);
    const ws = weekStart(ui.date), we = addDays(ws, 6);
    const w = rangeTotals(ws, we);
    const { daily, weekly } = state.budget;

    const meterCard = (label, spent, goal, sub) => {
      const lvl = level(spent, goal);
      const left = goal - spent;
      const pct = Math.min(100, Math.round(spent / goal * 100));
      return `<div class="stat ${lvl}">
        <div class="stat-label">${label}</div>
        <div class="stat-value">${left >= 0 ? money(left) : money(-left)}</div>
        <div class="stat-sub">${left >= 0 ? 'left' : 'over'} of ${money(goal)}${sub ? ' &middot; ' + sub : ''}</div>
        <div class="meter" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span data-pct="${pct}"></span></div>
      </div>`;
    };
    const noGoal = label => `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value">&mdash;</div><div class="stat-sub">No goal yet. <a href="#" data-tab-go="goals">Set a budget</a></div></div>`;

    $('#summary').innerHTML = `
      <div class="stat"><div class="stat-label">Spent ${esc(dayName(ui.date).toLowerCase())}</div>
        <div class="stat-value">${money(t.cents)}</div>
        <div class="stat-sub">${t.items} item${t.items === 1 ? '' : 's'} &middot; ${t.cal} cal${t.na ? ` &middot; ${t.na} N/A` : ''}</div></div>
      ${daily ? meterCard('Daily budget', t.cents, daily) : noGoal('Daily budget')}
      ${weekly ? meterCard('Weekly budget', w.cents, weekly, `${money(w.cents)} spent`)
               : `<div class="stat"><div class="stat-label">This week</div><div class="stat-value">${money(w.cents)}</div><div class="stat-sub">${fmtDate(ws, { month: 'short', day: 'numeric' })} &ndash; ${fmtDate(we, { month: 'short', day: 'numeric' })}</div></div>`}`;
  }

  // ---------- history ----------
  function renderHistory() {
    const end = ui.date;
    const days = Array.from({ length: 14 }, (_, i) => addDays(end, i - 13));
    const spend = days.map(d => dayTotals(d).cents);
    const daily = state.budget.daily;
    const max = Math.max(...spend, daily || 0, 500);
    const top = Math.ceil(max / 500) * 500;

    const W = 640, H = 230, L = 44, R = 8, T = 18, B = 40;
    const iw = W - L - R, ih = H - T - B, slot = iw / days.length, bw = slot * 0.62;
    const y = c => T + ih - (c / top) * ih;
    let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Spending for the 14 days ending ${esc(fmtDate(end))}">`;
    for (const frac of [0, 0.5, 1]) {
      const c = top * frac;
      svg += `<line class="axis" x1="${L}" x2="${W - R}" y1="${y(c)}" y2="${y(c)}"/><text x="${L - 6}" y="${y(c) + 4}" text-anchor="end">${money(c).replace('.00', '')}</text>`;
    }
    days.forEach((d, i) => {
      const x = L + i * slot + (slot - bw) / 2, h = (spend[i] / top) * ih;
      const cls = ['bar-rect', d === todayKey() ? 'today' : '', daily && spend[i] > daily ? 'over' : ''].join(' ');
      svg += `<g><title>${esc(fmtDate(d))}: ${money(spend[i])}</title>`;
      if (spend[i] > 0) svg += `<rect class="${cls}" x="${x}" y="${y(spend[i])}" width="${bw}" height="${h}" rx="3"/><text class="val" x="${x + bw / 2}" y="${y(spend[i]) - 4}" text-anchor="middle">${money(spend[i]).replace('.00', '')}</text>`;
      svg += `<text x="${x + bw / 2}" y="${H - 22}" text-anchor="middle">${fmtDate(d, { weekday: 'narrow' })}</text><text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${parseKey(d).getDate()}</text></g>`;
    });
    if (daily) svg += `<line class="goal" x1="${L}" x2="${W - R}" y1="${y(daily)}" y2="${y(daily)}"/><text class="goal-label" x="${L + 4}" y="${y(daily) - 5}">Goal ${money(daily)}</text>`;
    svg += '</svg>';

    const ws = weekStart(end), we = addDays(ws, 6);
    const week = rangeTotals(ws, we);
    const monthStart = end.slice(0, 8) + '01', month = rangeTotals(monthStart, end.slice(0, 8) + '31');
    const logged = [...new Set(state.entries.map(e => e.date))].sort().reverse();
    const spentDays = logged.filter(d => dayTotals(d).cents > 0);
    const avg = spentDays.length ? Math.round(spentDays.reduce((s, d) => s + dayTotals(d).cents, 0) / spentDays.length) : 0;
    const allNa = totals(state.entries).na;

    $('#panel-history').innerHTML = `
      <div class="stats">
        <div class="mini"><b>${money(week.cents)}</b><span>This week</span></div>
        <div class="mini"><b>${money(month.cents)}</b><span>${esc(fmtDate(end, { month: 'long' }))}</span></div>
        <div class="mini"><b>${money(avg)}</b><span>Average per day with spending</span></div>
        <div class="mini"><b>${allNa}</b><span>Logged items with no price (N/A)</span></div>
      </div>
      <div class="card-box"><h2 class="h2 mb">Last 14 days</h2>${svg}</div>
      <h2 class="h2">Daily log</h2>
      ${logged.length ? logged.map(d => {
        const t = dayTotals(d), es = entriesOn(d);
        return `<details class="day"><summary><span>${esc(fmtDate(d, { weekday: 'long', month: 'short', day: 'numeric' }))}${t.na ? ` <span class="meta">&middot; ${t.na} N/A</span>` : ''}</span><span>${money(t.cents)}</span></summary>
          <ul>${es.map(e => `<li><span>${e.qty > 1 ? e.qty + '&times; ' : ''}${esc(e.name)} <span class="meta">(${esc(MEAL_LABEL[e.meal])})</span></span>${e.cents == null ? '<span class="na">N/A</span>' : `<span>${money(e.cents * e.qty)}</span>`}</li>`).join('')}</ul>
          <div class="actions day-actions"><button class="btn small" data-action="goto-date" data-date="${esc(d)}">Open this day</button></div></details>`;
      }).join('') : '<p class="empty card-box">Nothing logged yet. Add something from the menu and it will show up here.</p>'}`;
  }

  // ---------- budget panel ----------
  function renderGoals() {
    const { daily, weekly } = state.budget;
    $('#panel-goals').innerHTML = `
      <div class="card-box">
        <h2 class="h2">Budget goals</h2>
        <p class="hint gap-b">Set how much you want to spend. The summary at the top turns yellow when you reach 80% and red when you go over. Leave a box empty for no limit.</p>
        <form class="form" id="goalForm">
          <div class="field"><label for="dailyGoal">Daily limit</label>
            <div class="money"><span aria-hidden="true">$</span><input id="dailyGoal" name="daily" type="number" inputmode="decimal" min="0" step="0.25" placeholder="e.g. 5.00" value="${daily ? (daily / 100).toFixed(2) : ''}"></div></div>
          <div class="field"><label for="weeklyGoal">Weekly limit (Mon&ndash;Sun)</label>
            <div class="money"><span aria-hidden="true">$</span><input id="weeklyGoal" name="weekly" type="number" inputmode="decimal" min="0" step="0.25" placeholder="e.g. 20.00" value="${weekly ? (weekly / 100).toFixed(2) : ''}"></div></div>
          <div class="actions"><button class="btn primary" type="submit">Save goals</button></div>
        </form>
      </div>
      <div class="card-box">
        <h2 class="h2">Your data</h2>
        <p class="hint gap-b">Everything is stored in this browser only. Clearing it can't be undone.</p>
        <button class="btn danger" data-action="clear-all">Delete all logged days</button>
      </div>`;
  }

  // Re-rendering replaces the buttons, so put keyboard focus back on the equivalent one.
  function keepFocus(fn) {
    const el = document.activeElement;
    const sel = el && el.dataset && el.dataset.action
      ? ['action', 'id', 'key', 'd', 'meal', 'group', 'value', 'date'].filter(k => el.dataset[k] != null).map(k => `[data-${k}="${CSS.escape(el.dataset[k])}"]`).join('')
      : null;
    fn();
    if (sel) { const next = $(sel); if (next) next.focus({ preventScroll: true }); }
  }

  // ---------- main render ----------
  function renderNow() {
    $('#dateInput').value = ui.date;
    $('#todayBtn').hidden = ui.date === todayKey();
    renderSummary();
    $$('.tab').forEach(t => { const on = t.dataset.tab === ui.tab; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; });
    $$('.panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + ui.tab));
    $('.layout').classList.toggle('menu-view', ui.tab === 'menu');

    const t = dayTotals(ui.date);
    const badge = $('#trayCount');
    badge.hidden = !t.items; badge.textContent = t.items;
    $('#barTotal').textContent = money(t.cents);
    $('#mobileBar').hidden = ui.tab !== 'menu';

    if (ui.tab === 'menu') { renderItemList(); renderTray($('#side'), true); }
    if (ui.tab === 'today') renderTray($('#panel-today'), false);
    if (ui.tab === 'history') renderHistory();
    if (ui.tab === 'goals') renderGoals();
    $$('[data-pct]').forEach(el => { el.style.width = el.dataset.pct + '%'; });
  }

  const render = () => keepFocus(renderNow);

  // ---------- actions ----------
  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 1900);
  }
  function addEntry(entry) {
    const key = `${ui.date}|${entry.meal}|${entry.itemId}`;
    const existing = state.entries.find(e => e.key === key);
    if (existing && existing.qty >= MAX_QTY) return toast(`You can log up to ${MAX_QTY} of the same item`);
    if (existing) existing.qty += 1;
    else state.entries.push({ key, date: ui.date, qty: 1, ...entry });
    save(); render();
    toast(`Added ${entry.name}${entry.cents == null ? ' (no price, N/A)' : ' · ' + money(entry.cents)}`);
  }
  function addItem(id) {
    const i = BY_ID.get(id); if (!i) return;
    const f = ui.filters.meal;
    const meal = f !== 'all' && i.meals.includes(f) ? f : (i.meals.includes('lunch') ? 'lunch' : (i.meals[0] || 'lunch'));
    addEntry({ meal, itemId: i.id, name: i.name, serving: i.servingLabel, cents: i.cents, cal: i.nutrition.calories ?? null });
  }
  function addCombo(meal) {
    const c = COMBOS[meal]; if (!c) return;
    addEntry({ meal, itemId: 'combo-' + meal, name: c.name, serving: 'Full meal', cents: c.priceCents, cal: null });
  }
  function setTab(tab) { ui.tab = tab; render(); window.scrollTo({ top: 0 }); }
  function setDate(k) { if (DATE_RE.test(k) && !Number.isNaN(parseKey(k).getTime())) ui.date = k; render(); }

  document.addEventListener('click', ev => {
    const tabBtn = ev.target.closest('[data-tab]');
    if (tabBtn) return setTab(tabBtn.dataset.tab);
    const go = ev.target.closest('[data-tab-go]');
    if (go) { ev.preventDefault(); return setTab(go.dataset.tabGo); }
    const b = ev.target.closest('[data-action]');
    if (!b) return;
    const d = b.dataset;
    switch (d.action) {
      case 'prev-day': return setDate(addDays(ui.date, -1));
      case 'next-day': return setDate(addDays(ui.date, 1));
      case 'today': return setDate(todayKey());
      case 'goto-date': ui.tab = 'today'; return setDate(d.date);
      case 'add': return addItem(d.id);
      case 'combo': return addCombo(d.meal);
      case 'filter': ui.filters[d.group] = d.value; return keepFocus(renderItemList);
      case 'qty': {
        const e = state.entries.find(x => x.key === d.key); if (!e) return;
        e.qty = Math.min(MAX_QTY, e.qty + Number(d.d));
        if (e.qty < 1) state.entries = state.entries.filter(x => x !== e);
        save(); return render();
      }
      case 'remove': state.entries = state.entries.filter(x => x.key !== d.key); save(); return render();
      case 'clear-day':
        if (confirm(`Remove everything logged for ${fmtDate(ui.date)}?`)) { state.entries = state.entries.filter(e => e.date !== ui.date); save(); render(); }
        return;
      case 'clear-all':
        if (confirm('Delete every logged day? This cannot be undone.')) { state.entries = []; save(); render(); toast('All days deleted'); }
        return;
    }
  });
  document.addEventListener('input', ev => {
    if (ev.target.id === 'search') { ui.filters.q = ev.target.value; renderItemList(); }
  });
  document.addEventListener('change', ev => {
    if (ev.target.id === 'dateInput') setDate(ev.target.value);
  });
  document.addEventListener('submit', ev => {
    if (ev.target.id !== 'goalForm') return;
    ev.preventDefault();
    const f = new FormData(ev.target);
    state.budget = { daily: inCents(f.get('daily')), weekly: inCents(f.get('weekly')) };
    save(); render(); toast('Budget saved');
  });

  // Another tab changed the saved log: pick it up instead of overwriting it on the next save.
  window.addEventListener('storage', ev => {
    if (ev.key === STORE_KEY || ev.key === null) { state = load(); render(); }
  });
  // If the page stays open past midnight, "today" should move on.
  let lastToday = todayKey();
  function rollDay() {
    const t = todayKey();
    if (t === lastToday) return;
    if (ui.date === lastToday) ui.date = t;
    lastToday = t; render();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) rollDay(); });
  window.addEventListener('focus', rollDay);

  $('.tabs').addEventListener('keydown', ev => {
    const keys = { ArrowRight: 1, ArrowLeft: -1, Home: 'first', End: 'last' };
    if (!(ev.key in keys)) return;
    const tabs = $$('.tab'), cur = tabs.findIndex(t => t.dataset.tab === ui.tab);
    const i = keys[ev.key] === 'first' ? 0 : keys[ev.key] === 'last' ? tabs.length - 1 : (cur + keys[ev.key] + tabs.length) % tabs.length;
    ev.preventDefault(); setTab(tabs[i].dataset.tab); tabs[i].focus();
  });

  buildMenuShell();
  render();
})();
