'use strict';

(() => {
  const KEY = 'cutline-state-v2';
  const LEGACY_KEY = 'cutline-state-v1';
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const empty = () => ({ version: 2, profile: null, foods: [], checkins: [], workouts: [] });
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const dateObject = date => new Date(`${date}T12:00:00`);
  const shift = (date, days) => { const d = dateObject(date); d.setDate(d.getDate() + days); return localDate(d); };
  const prettyDate = date => dateObject(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const number = (value, digits = 0) => Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
  const id = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const disclaimer = 'Mifflin–St Jeor estimates for adults who are not pregnant or breastfeeding. Individual needs vary; these are planning estimates, not medical advice.';
  let state = empty();
  let selectedDate = localDate();
  let currentView = 'overview';
  let chartRange = '4W';
  let toastTimer;
  let storageBlocked = false;

  function toast(message) {
    $('#toast').textContent = message;
    $('#toast').classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 5000);
  }
  function assert(condition, message) { if (!condition) throw new Error(message); }
  function numeric(value, min, max, label, optional = false, integer = false) {
    if (optional && (value === '' || value === null || value === undefined)) return null;
    assert(value !== '' && value !== null && value !== undefined && typeof value !== 'boolean', `${label} is required.`);
    const n = Number(value);
    assert(Number.isFinite(n) && n >= min && n <= max && (!integer || Number.isInteger(n)), `${label} must be ${integer ? 'a whole number ' : ''}between ${min} and ${max}.`);
    return n;
  }
  function text(value, label, max = 120, optional = false) {
    assert(typeof value === 'string', `${label} must be text.`);
    const s = value.trim();
    assert((optional || s.length > 0) && s.length <= max, `${label} must contain ${optional ? 'at most' : '1–'}${max} characters.`);
    return s;
  }
  function validDate(value) {
    assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(dateObject(value).getTime()) && localDate(dateObject(value)) === value && value >= '1900-01-01' && value <= localDate(), 'Choose a valid date between 1900 and today.');
    return value;
  }
  function profileValue(p) {
    assert(p && typeof p === 'object', 'Profile is invalid.');
    assert(['female', 'male'].includes(p.sex), 'Select a sex for the calorie equation.');
    const profile = {
      name: text(p.name, 'Name', 60), sex: p.sex,
      age: numeric(p.age, 18, 100, 'Age', false, true),
      height: numeric(p.height, 120, 230, 'Height'),
      weight: numeric(p.weight, 35, 350, 'Reference weight'),
      activity: numeric(p.activity, 1.2, 1.9, 'Activity factor'),
      deficit: numeric(p.deficit, 0, 750, 'Daily deficit'),
      goal: numeric(p.goal, 35, 350, 'Goal weight')
    };
    assert([1.2, 1.375, 1.55, 1.725, 1.9].includes(profile.activity), 'Select a supported activity level.');
    assert(profile.goal <= profile.weight, 'For a cut, goal weight must not exceed reference weight.');
    const t = targets(profile);
    assert(t.calories >= (profile.sex === 'male' ? 1500 : 1200) && t.carbs >= 0, 'This deficit produces a very low calorie target. Reduce the deficit and seek individualized advice.');
    return profile;
  }
  function recordValue(kind, data) {
    assert(data && typeof data === 'object', 'Invalid log record.');
    const base = { id: text(data.id, 'Record ID', 100), date: validDate(data.date) };
    if (kind === 'foods') return { ...base, name: text(data.name, 'Food or meal'), meal: text(data.meal, 'Meal name', 60), calories: numeric(data.calories, 0, 20000, 'Calories'), protein: numeric(data.protein, 0, 2000, 'Protein'), carbs: numeric(data.carbs, 0, 3000, 'Carbs'), fat: numeric(data.fat, 0, 2000, 'Fat') };
    if (kind === 'checkins') {
      const item = { ...base, weight: numeric(data.weight, 25, 350, 'Weight', true), steps: numeric(data.steps, 0, 200000, 'Steps', true, true), sleep: numeric(data.sleep, 0, 24, 'Sleep', true), waist: numeric(data.waist, 30, 250, 'Waist', true), note: text(data.note ?? '', 'Note', 500, true) };
      assert(['weight', 'steps', 'sleep', 'waist'].some(k => item[k] !== null), 'Enter at least one check-in measurement.');
      return item;
    }
    assert(Array.isArray(data.exercises) && data.exercises.length > 0 && data.exercises.length <= 100, 'Add 1–100 exercises.');
    return { ...base, name: text(data.name, 'Session name'), duration: numeric(data.duration, 1, 1440, 'Duration'), exercises: data.exercises.map(e => ({ name: text(e.name, 'Exercise'), sets: numeric(e.sets, 1, 100, 'Sets', false, true), reps: numeric(e.reps, 1, 1000, 'Reps', false, true), kg: numeric(e.kg, 0, 1500, 'Load') })) };
  }
  function validate(data) {
    assert(data && data.version === 2, 'This is not a supported Cutline v2 backup.');
    const result = { version: 2, profile: data.profile === null ? null : profileValue(data.profile) };
    for (const kind of ['foods', 'checkins', 'workouts']) {
      assert(Array.isArray(data[kind]) && data[kind].length <= 50000, `Invalid ${kind} collection.`);
      result[kind] = data[kind].map(item => recordValue(kind, item));
      assert(new Set(result[kind].map(item => item.id)).size === result[kind].length, `Duplicate ${kind} IDs.`);
    }
    assert(new Set(result.checkins.map(item => item.date)).size === result.checkins.length, 'Only one check-in is allowed per date.');
    return result;
  }
  function commit(next) {
    if (storageBlocked) { toast('Stored data could not be loaded. Export the original data or erase it in Settings before saving.'); return false; }
    try {
      const clean = validate(next);
      localStorage.setItem(KEY, JSON.stringify(clean));
      state = clean;
      render();
      return true;
    } catch (error) { toast(`Not saved: ${error.message}`); return false; }
  }
  function targets(p = state.profile) {
    if (!p) return null;
    const bmr = 10 * p.weight + 6.25 * p.height - 5 * p.age + (p.sex === 'male' ? 5 : -161);
    const tdee = Math.round(bmr * p.activity);
    const calories = tdee - p.deficit;
    const protein = Math.round(p.weight * 1.8);
    const fat = Math.round(p.weight * 0.8);
    return { bmr: Math.round(bmr), tdee, calories, protein, fat, carbs: Math.round((calories - protein * 4 - fat * 9) / 4) };
  }
  function totals(date = selectedDate) { return state.foods.filter(f => f.date === date).reduce((a, f) => { for (const k of ['calories', 'protein', 'carbs', 'fat']) a[k] += f[k]; return a; }, { calories: 0, protein: 0, carbs: 0, fat: 0 }); }
  const volume = w => w.exercises.reduce((n, e) => n + e.sets * e.reps * e.kg, 0);
  const weights = () => state.checkins.filter(c => c.weight !== null && c.date <= selectedDate).sort((a, b) => a.date.localeCompare(b.date));
  const percent = (value, target) => target ? Math.min(100, Math.max(0, value / target * 100)) : 0;
  const button = (label, action, extra = '', cls = 'text-btn') => `<button type="button" class="${cls}" data-action="${action}" ${extra}>${label}</button>`;
  const actions = (kind, item) => `${button('Edit', 'edit', `data-kind="${kind}" data-id="${esc(item.id)}"`)} ${button('Delete', 'delete', `data-kind="${kind}" data-id="${esc(item.id)}"`)}`;
  const metric = (title, value, unit, detail, progress) => `<article class="metric-card"><div class="card-head"><span class="eyebrow">${title}</span></div><div class="metric-value">${value} <small>${unit}</small></div>${progress === undefined ? '' : `<div class="progress-bar"><i style="width:${progress}%"></i></div>`}<div class="card-foot"><span>${detail}</span></div></article>`;
  function field(label, name, value = '', type = 'number', attrs = '') { return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${attrs}></label>`; }
  function select(label, name, options, value) { return `<label>${label}<select name="${name}" required>${options.map(([v, labelText]) => `<option value="${v}" ${String(v) === String(value) ? 'selected' : ''}>${labelText}</option>`).join('')}</select></label>`; }
  function openDialog(title, content, onSave, saveLabel = 'Save') {
    const dialog = $('#log-dialog');
    dialog.innerHTML = `<form class="dialog-card"><button type="button" class="dialog-close" aria-label="Close dialog">×</button><span class="eyebrow">CUTLINE</span><h2 id="dialog-title">${title}</h2>${content}<p class="muted" id="form-error" role="alert"></p><button type="submit" class="primary-btn">${saveLabel}</button></form>`;
    dialog.setAttribute('aria-labelledby', 'dialog-title');
    dialog.querySelector('.dialog-close').onclick = () => dialog.close();
    dialog.querySelector('form').onsubmit = event => {
      event.preventDefault();
      try { if (onSave(Object.fromEntries(new FormData(event.target)), event.target) !== false) dialog.close(); }
      catch (error) { $('#form-error').textContent = error.message; }
    };
    if (!dialog.open) dialog.showModal();
  }
  function saveRecord(kind, data, oldId) {
    const item = recordValue(kind, { ...data, id: oldId || id() });
    if (kind === 'checkins' && state.checkins.some(c => c.date === item.date && c.id !== item.id)) throw new Error('A check-in already exists on this date. Edit that check-in instead.');
    const next = { ...state, [kind]: [...state[kind].filter(r => r.id !== item.id), item] };
    if (!commit(next)) return false;
    toast('Saved on this device.');
    return true;
  }
  function foodForm(item = {}) {
    openDialog(item.id ? 'Edit food' : 'Add food', `${field('Date', 'date', item.date || selectedDate, 'date', `required max="${localDate()}"`)}${field('Food or meal description', 'name', item.name, 'text', 'required maxlength="120"')}${field('Meal name', 'meal', item.meal, 'text', 'required placeholder="Breakfast, lunch, snack…" maxlength="60"')}<div class="two-fields">${field('Calories (kcal)', 'calories', item.calories, 'number', 'required min="0" max="20000" step="0.1"')}${field('Protein (g)', 'protein', item.protein, 'number', 'required min="0" max="2000" step="0.1"')}</div><div class="two-fields">${field('Carbs (g)', 'carbs', item.carbs, 'number', 'required min="0" max="3000" step="0.1"')}${field('Fat (g)', 'fat', item.fat, 'number', 'required min="0" max="2000" step="0.1"')}</div><p class="muted">Enter values from a nutrition label, weighed ingredients, or your own estimate.</p>`, data => saveRecord('foods', data, item.id));
  }
  function checkinForm(item) {
    item = item || state.checkins.find(c => c.date === selectedDate) || {};
    openDialog(item.id ? 'Edit check-in' : 'Add check-in', `${field('Date', 'date', item.date || selectedDate, 'date', `required max="${localDate()}"`)}<div class="two-fields">${field('Weight (kg, optional)', 'weight', item.weight, 'number', 'min="25" max="350" step="0.1"')}${field('Waist (cm, optional)', 'waist', item.waist, 'number', 'min="30" max="250" step="0.1"')}</div><div class="two-fields">${field('Steps (optional)', 'steps', item.steps, 'number', 'min="0" max="200000" step="1"')}${field('Sleep (hours, optional)', 'sleep', item.sleep, 'number', 'min="0" max="24" step="0.1"')}</div>${field('Note (optional)', 'note', item.note, 'text', 'maxlength="500"')}<p class="muted">One check-in per date. Enter at least one measurement.</p>`, data => saveRecord('checkins', data, item.id));
  }
  function exerciseRow(e = {}) {
    return `<fieldset class="exercise-row"><legend>Exercise</legend>${field('Exercise name', 'exercise', e.name, 'text', 'required maxlength="120"')}<div class="two-fields">${field('Sets', 'sets', e.sets, 'number', 'required min="1" max="100" step="1"')}${field('Reps per set', 'reps', e.reps, 'number', 'required min="1" max="1000" step="1"')}</div>${field('Load (kg; 0 for bodyweight)', 'kg', e.kg, 'number', 'required min="0" max="1500" step="0.1"')}${button('Remove exercise', 'remove-exercise')}</fieldset>`;
  }
  function workoutForm(item = {}) {
    openDialog(item.id ? 'Edit workout' : 'Log workout', `${field('Date', 'date', item.date || selectedDate, 'date', `required max="${localDate()}"`)}${field('Session name', 'name', item.name, 'text', 'required maxlength="120"')}${field('Total duration (minutes)', 'duration', item.duration, 'number', 'required min="1" max="1440" step="0.1"')}<div id="exercise-fields">${(item.exercises || [{}]).map(exerciseRow).join('')}</div>${button('＋ Add exercise', 'add-exercise', '', 'outline-btn')}<p class="muted">For varying sets, enter the exercise on separate rows. Volume is sets × reps × external load.</p>`, (data, form) => {
      const exercises = [...form.querySelectorAll('.exercise-row')].map(row => Object.fromEntries([...row.querySelectorAll('input')].map(input => [input.name === 'exercise' ? 'name' : input.name, input.value])));
      return saveRecord('workouts', { ...data, exercises }, item.id);
    });
  }
  function quickLog() {
    openDialog('What would you like to log?', `<div class="settings-grid">${button('Food', 'food', '', 'outline-btn')}${button('Check-in', 'checkin', '', 'outline-btn')}${button('Workout', 'workout', '', 'outline-btn')}</div>`, () => true, 'Close');
  }
  function chartMarkup() {
    let points = weights();
    const from = chartRange === 'ALL' ? points[0]?.date : shift(selectedDate, chartRange === '4W' ? -27 : -83);
    points = points.filter(p => p.date >= from);
    const controls = `<div class="segmented">${['4W', '12W', 'ALL'].map(range => button(range, 'range', `data-range="${range}" aria-pressed="${range === chartRange}"`, range === chartRange ? 'active' : '')).join('')}</div>`;
    let content = '<p class="muted">No weight check-ins in this range. Add a check-in to start your trend.</p>';
    if (points.length) {
      const min = Math.min(...points.map(p => p.weight)) - 0.5;
      const max = Math.max(...points.map(p => p.weight)) + 0.5;
      const start = dateObject(from || points[0].date).getTime();
      const end = dateObject(selectedDate).getTime();
      const coords = points.map(p => ({ ...p, x: end === start ? 310 : 12 + (dateObject(p.date).getTime() - start) / (end - start) * 596, y: 190 - (p.weight - min) / (max - min) * 175 }));
      content = `<div class="chart-wrap"><div class="y-labels">${[max, (max + min) / 2, min].map(n => `<span>${number(n, 1)}</span>`).join('')}</div><div class="chart"><svg viewBox="0 0 620 210" role="img" aria-label="${points.length} recorded weights in kilograms"><title>Actual weight check-ins, ${prettyDate(points[0].date)} to ${prettyDate(points[points.length - 1].date)}</title><path class="actual-path" fill="none" stroke="currentColor" d="${coords.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')}"/>${coords.map(p => `<circle cx="${p.x}" cy="${p.y}" r="4" class="last-point"><title>${p.date}: ${p.weight} kg</title></circle>`).join('')}</svg><div class="x-labels"><span>${prettyDate(from || points[0].date)}</span><span>${prettyDate(selectedDate)}</span></div></div></div>`;
    }
    return `<article class="panel chart-panel"><div class="panel-header"><div><span class="eyebrow">WEIGHT TREND · KG</span><h3>How you’re tracking</h3></div>${controls}</div><p class="muted">Actual check-ins through ${prettyDate(selectedDate)}</p>${content}</article>`;
  }
  function overview() {
    const t = targets(), total = totals(), ws = weights(), latest = ws[ws.length - 1];
    const recent = ws.filter(w => w.date >= shift(selectedDate, -6));
    const previous = ws.filter(w => w.date >= shift(selectedDate, -13) && w.date < shift(selectedDate, -6));
    const avg = rows => rows.reduce((s, c) => s + c.weight, 0) / rows.length;
    const delta = recent.length && previous.length ? avg(recent) - avg(previous) : null;
    const checkin = state.checkins.find(c => c.date === selectedDate);
    const sessions = state.workouts.filter(w => w.date === selectedDate);
    const day = dateObject(selectedDate).getDay();
    const weekStart = shift(selectedDate, -(day + 6) % 7);
    const elapsed = (day + 6) % 7 + 1;
    const loggedDays = list => new Set(list.filter(r => r.date >= weekStart && r.date <= selectedDate).map(r => r.date)).size;
    const counts = [loggedDays(state.foods), loggedDays(state.workouts), loggedDays(state.checkins)];
    const score = Math.round(counts.reduce((a, b) => a + b, 0) / (elapsed * 3) * 100);
    $('#overview-view').innerHTML = `<div class="hero-row"><div><h2>Your cut at a glance</h2><p class="muted">${t ? `Your records for ${prettyDate(selectedDate)}.` : 'Start with your profile, then log your first day.'}</p></div>${button(t ? 'Edit plan' : 'Set up profile', 'settings', '', 'outline-btn')}</div><div class="metric-grid">${metric('LAST LOGGED WEIGHT', latest ? number(latest.weight, 1) : '—', 'kg', recent.length ? `7-day average: ${number(avg(recent), 1)} kg (${recent.length} check-ins)` : 'No weight recorded in the past 7 days')}${metric('CALORIES LEFT', t ? number(t.calories - total.calories) : '—', 'kcal', t ? `${number(total.calories)} eaten · ${number(t.calories)} estimated target` : 'Set up a profile for an estimate', t ? percent(total.calories, t.calories) : 0)}${metric('PROTEIN', number(total.protein, 1), t ? `/ ${t.protein} g` : 'g', t ? 'Target: 1.8 g per kg reference weight' : 'No target set', t ? percent(total.protein, t.protein) : 0)}${metric('WEEKLY WEIGHT CHANGE', delta === null ? '—' : `${delta > 0 ? '+' : ''}${number(delta, 1)}`, 'kg', 'Mean of last 7 days vs previous 7; needs both periods')}</div><div class="content-grid">${chartMarkup()}<article class="panel consistency-panel"><div class="panel-header"><div><span class="eyebrow">WEEK TO SELECTED DATE</span><h3>Logging consistency</h3></div></div><div class="score-ring" style="background:conic-gradient(var(--lime) ${score}%,var(--line) 0)"><div><strong>${score}</strong><span>/ 100</span></div></div><p class="score-copy">Share of elapsed days with each type of log.<br>Logging measure, not a health or workout goal.</p><div class="score-breakdown">${['Nutrition', 'Training', 'Check-ins'].map((label, i) => `<div><span>${label}</span><b>${counts[i]} / ${elapsed} days</b><i><em style="width:${counts[i] / elapsed * 100}%"></em></i></div>`).join('')}</div></article></div><div class="bottom-grid"><article class="panel log-panel"><div class="panel-header"><h3>Daily log</h3>${button('Add a log ↗', 'quick')}</div><div class="daily-rows">${[['Calories', `${number(total.calories)} kcal`], ['Protein', `${number(total.protein, 1)} g`], ['Steps', checkin?.steps == null ? 'Not logged' : number(checkin.steps)], ['Sleep', checkin?.sleep == null ? 'Not logged' : `${number(checkin.sleep, 1)} h`], ['Workouts', `${sessions.length} logged`]].map(([label, value]) => `<div class="daily-row"><div><b>${label}</b></div><strong>${value}</strong></div>`).join('')}</div></article><article class="panel next-panel"><div class="panel-header"><h3>Build your next data point</h3></div><p class="muted">A little consistent logging makes your trends more useful.</p>${button('＋ Log a meal', 'food', '', 'outline-btn')}${button('＋ Log a workout', 'workout', '', 'outline-btn')}${button('＋ Daily check-in', 'checkin', '', 'outline-btn')}<p class="muted">${disclaimer}</p></article></div>`;
  }
  function nutrition() {
    const t = targets(), total = totals(), foods = state.foods.filter(f => f.date === selectedDate);
    const used = t ? percent(total.calories, t.calories) : 0;
    $('#nutrition-view').innerHTML = `<div class="hero-row"><div><h2>Nutrition cockpit</h2><p class="muted">${prettyDate(selectedDate)} · Log portions you actually ate.</p></div>${button('＋ Add food', 'food', 'id="add-food"', 'primary-btn')}</div><div class="nutrition-layout"><article class="panel nutrition-main"><div class="calorie-hero"><div><span class="eyebrow">CALORIES REMAINING</span><div class="big-number">${t ? number(t.calories - total.calories) : '—'} <small>kcal</small></div><p>${number(total.calories)} eaten · ${t ? `${number(t.calories)} estimated target` : 'Set a profile for targets'}</p></div><div class="donut" style="background:conic-gradient(var(--lime) ${used}%,var(--line) 0)"><span>${t ? Math.round(total.calories / t.calories * 100) + '%' : '—'}<small>used</small></span></div></div><div class="macro-cards">${['protein', 'carbs', 'fat'].map(k => `<div><span>${k[0].toUpperCase() + k.slice(1)}</span><b>${number(total[k], 1)} <small>${t ? `/ ${t[k]}` : ''} g</small></b><i><em style="width:${t ? percent(total[k], t[k]) : 0}%"></em></i></div>`).join('')}</div><h3 class="section-title">Food log <span>${prettyDate(selectedDate)}</span></h3><div class="food-list">${foods.length ? foods.map(f => `<div><span class="food-type breakfast">${esc(f.meal[0].toUpperCase())}</span><div><b>${esc(f.name)}</b><small>${esc(f.meal)} · P ${number(f.protein, 1)} / C ${number(f.carbs, 1)} / F ${number(f.fat, 1)} g</small>${actions('foods', f)}</div><strong>${number(f.calories)} <small>kcal</small></strong></div>`).join('') : '<p class="muted">No food logged for this date.</p>'}</div></article><article class="panel targets-panel"><span class="eyebrow">YOUR TARGETS</span><h3>Estimated cut settings</h3>${t ? [['Daily calories', `${t.calories} kcal`], ['Protein', `${t.protein} g`], ['Fat', `${t.fat} g`], ['Carbs', `${t.carbs} g`], ['Daily deficit', `${state.profile.deficit} kcal`]].map(([label, value]) => `<div class="target-stat"><span>${label}</span><b>${value}</b></div>`).join('') : '<p class="muted">Complete your profile to calculate targets.</p>'}${button('Edit profile & targets', 'settings', '', 'outline-btn')}<div class="formula-note">${t ? `BMR ${t.bmr} · TDEE ${t.tdee} kcal/day. Protein 1.8 g/kg, fat 0.8 g/kg; remaining calories from carbs. Uses profile reference weight. ` : ''}${disclaimer}</div></article></div>`;
  }
  function training() {
    const day = (dateObject(selectedDate).getDay() + 6) % 7;
    const weekly = state.workouts.filter(w => w.date >= shift(selectedDate, -day) && w.date <= selectedDate);
    const sessions = state.workouts.filter(w => w.date <= selectedDate).sort((a, b) => b.date.localeCompare(a.date));
    $('#training-view').innerHTML = `<div class="hero-row"><div><h2>Training floor</h2><p class="muted">All sessions through ${prettyDate(selectedDate)}.</p></div>${button('＋ Log workout', 'workout', 'id="log-workout"', 'primary-btn')}</div><div class="training-stats">${metric('SESSIONS THIS WEEK', weekly.length, '', 'Monday through selected date')}${metric('WEEKLY VOLUME', number(weekly.reduce((n, w) => n + volume(w), 0)), 'kg', 'Sets × reps × external load')}${metric('WEEKLY DURATION', number(weekly.reduce((n, w) => n + w.duration, 0), 1), 'min', 'Recorded session time')}</div><article class="panel sessions-panel"><div class="panel-header"><h3>Training history</h3></div><div class="session-table"><div class="table-head"><span>SESSION</span><span>DATE</span><span>DURATION</span><span>VOLUME</span><span>ACTIONS</span></div>${sessions.length ? sessions.map(w => `<div class="session-row"><div><b>${esc(w.name)}</b>${w.exercises.map(e => `<div class="muted">${esc(e.name)} · ${e.sets} × ${e.reps} × ${number(e.kg, 1)} kg</div>`).join('')}</div><span>${prettyDate(w.date)}</span><span>${number(w.duration, 1)} min</span><span>${number(volume(w), 1)} kg</span><span>${actions('workouts', w)}</span></div>`).join('') : '<p class="muted">No workouts logged yet. Record your first completed session.</p>'}</div></article>`;
  }
  function progress() {
    const ws = weights(), first = ws[0], last = ws[ws.length - 1];
    const rows = state.checkins.filter(c => c.date <= selectedDate).sort((a, b) => b.date.localeCompare(a.date));
    const waists = rows.filter(c => c.waist !== null);
    const change = waists.length >= 2 ? waists[0].waist - waists[waists.length - 1].waist : null;
    $('#progress-view').innerHTML = `<div class="hero-row"><div><h2>Progress lab</h2><p class="muted">Your measurements through ${prettyDate(selectedDate)}.</p></div>${button('Export data ↗', 'export', 'id="export-data"', 'outline-btn')}</div><div class="progress-cards"><article class="panel progress-highlight"><span class="eyebrow">WEIGHT CHANGE</span><b>${ws.length > 1 ? `${number(last.weight - first.weight, 1)} kg` : '—'}</b><p>${ws.length > 1 ? `From ${prettyDate(first.date)} to ${prettyDate(last.date)}.` : 'Add at least two weight check-ins to see change.'}</p><p class="muted">${state.profile ? `Goal: ${state.profile.goal} kg. ${last ? `${number(last.weight - state.profile.goal, 1)} kg relative to goal.` : ''}` : 'Set your goal in Settings.'}</p></article><article class="panel progress-highlight"><span class="eyebrow">WAIST CHANGE</span><b>${change === null ? '—' : `${number(change, 1)} cm`}</b><p>${change === null ? 'Add at least two waist measurements.' : `Across ${waists.length} recorded measurements.`}</p></article></div>${chartMarkup()}<article class="panel checkin-panel"><div class="panel-header"><h3>Body metrics</h3>${button('Add check-in ↗', 'checkin')}</div><div class="checkin-table"><div class="table-head"><span>DATE</span><span>WEIGHT / WAIST</span><span>STEPS / SLEEP</span><span>NOTE</span><span>ACTIONS</span></div>${rows.length ? rows.map(c => `<div class="session-row"><span>${prettyDate(c.date)}</span><span>${c.weight === null ? '—' : `${number(c.weight, 1)} kg`} / ${c.waist === null ? '—' : `${number(c.waist, 1)} cm`}</span><span>${c.steps === null ? '—' : number(c.steps)} / ${c.sleep === null ? '—' : `${number(c.sleep, 1)} h`}</span><span>${esc(c.note) || '—'}</span><span>${actions('checkins', c)}</span></div>`).join('') : '<p class="muted">No check-ins recorded yet.</p>'}</div></article>`;
  }
  function settings() {
    const p = state.profile || {};
    $('#settings-view').innerHTML = `<div class="hero-row"><div><h2>Settings</h2><p class="muted">Make Cutline fit your routine. Measurements use kg and cm.</p></div></div><div class="settings-grid"><article class="panel settings-card"><span class="eyebrow">PROFILE</span><h3>Your cut plan</h3><form id="profile-form">${field('Name', 'name', p.name, 'text', 'required maxlength="60"')}${field('Age (adults 18–100)', 'age', p.age, 'number', 'required min="18" max="100" step="1"')}${select('Sex used by the metabolic equation', 'sex', [['female', 'Female'], ['male', 'Male']], p.sex)}${field('Height (cm)', 'height', p.height, 'number', 'required min="120" max="230" step="0.1"')}${field('Reference weight (kg)', 'weight', p.weight, 'number', 'required min="35" max="350" step="0.1"')}${select('Activity level', 'activity', [[1.2, 'Sedentary · 1.2'], [1.375, 'Lightly active · 1.375'], [1.55, 'Moderately active · 1.55'], [1.725, 'Very active · 1.725'], [1.9, 'Extremely active · 1.9']], p.activity)}${field('Daily deficit (kcal, 0–750)', 'deficit', p.deficit ?? 300, 'number', 'required min="0" max="750" step="1"')}${field('Goal weight (kg)', 'goal', p.goal, 'number', 'required min="35" max="350" step="0.1"')}<p class="muted">Targets use this reference weight; update it as your needs change. ${disclaimer}</p><p id="profile-error" role="alert"></p><button class="primary-btn" type="submit" id="save-settings">Save profile</button></form></article><article class="panel settings-card"><span class="eyebrow">DATA & PRIVACY</span><h3>Your data stays yours</h3><p class="muted">Records are stored in this browser’s localStorage, without a server account or cloud sync. Browser clearing can remove them. Backups contain your personal data.</p>${storageBlocked ? '<p role="alert">Existing storage could not be loaded and is protected from overwrite. Export the original data before erasing or replacing it.</p>' : ''}${button('Download backup ↗', 'export', 'id="backup-data"', 'outline-btn')}${button('Import backup', 'import', '', 'outline-btn')}<input id="import-file" type="file" accept="application/json,.json" hidden>${button('Erase all data', 'erase', 'id="clear-data"', 'danger-btn')}<p class="muted">Import replaces the current profile and all logs after confirmation.</p></article></div>`;
    $('#profile-form').onsubmit = event => {
      event.preventDefault();
      try { const profile = profileValue(Object.fromEntries(new FormData(event.target))); if (commit({ ...state, profile })) toast('Profile saved. Estimated targets updated.'); }
      catch (error) { $('#profile-error').textContent = error.message; }
    };
    $('#import-file').onchange = async event => {
      const file = event.target.files[0];
      if (!file) return;
      try {
        assert(file.size <= 10 * 1024 * 1024, 'Backup must be smaller than 10 MB.');
        const imported = validate(JSON.parse(await file.text()));
        if (!confirm(`Replace your profile and ALL logs with ${imported.foods.length} food entries, ${imported.workouts.length} workouts and ${imported.checkins.length} check-ins?`)) return;
        const blocked = storageBlocked;
        storageBlocked = false;
        if (commit(imported)) toast('Backup imported and saved.'); else storageBlocked = blocked;
      } catch (error) { toast(`Import rejected: ${error.message}`); }
      finally { const input = $('#import-file'); if (input) input.value = ''; }
    };
  }
  function render() {
    const name = state.profile?.name || 'Your profile';
    $('.profile-mini strong').textContent = name;
    $('.profile-mini div:nth-child(2) span').textContent = state.profile ? `Goal: ${state.profile.goal} kg` : 'Set up your plan';
    $('.avatar').textContent = state.profile ? name.split(/\s+/).slice(0, 2).map(n => n[0]).join('').toUpperCase() : 'CL';
    $('.topbar .eyebrow').textContent = dateObject(selectedDate).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase();
    $('#date-btn').textContent = `${selectedDate === localDate() ? 'Today' : prettyDate(selectedDate)} ▾`;
    const dates = new Set([...state.foods, ...state.checkins, ...state.workouts].map(r => r.date));
    let cursor = dates.has(localDate()) ? localDate() : shift(localDate(), -1), streak = 0;
    while (dates.has(cursor)) { streak++; cursor = shift(cursor, -1); }
    $('.streak-card strong').innerHTML = `${streak} <small>${streak === 1 ? 'day' : 'days'}</small>`;
    $('.streak-card > span:last-child').textContent = 'Consecutive days with any log.';
    $$('.streak-dots i').forEach((dot, i) => { const date = shift(localDate(), i - 6); dot.style.background = dates.has(date) ? 'var(--lime)' : 'var(--line)'; dot.title = `${date}: ${dates.has(date) ? 'logged' : 'no log'}`; });
    overview(); nutrition(); training(); progress(); settings();
    showView(currentView);
  }
  function showView(view) {
    if (!['overview', 'nutrition', 'training', 'progress', 'settings'].includes(view)) return;
    currentView = view;
    $$('.view').forEach(el => el.classList.toggle('active-view', el.id === `${view}-view`));
    $$('[data-view]').forEach(el => { el.classList.toggle('active', el.dataset.view === view); if (el.dataset.view === view) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); });
    $('#page-title').textContent = view === 'overview' ? (state.profile ? `Welcome back, ${state.profile.name.split(/\s+/)[0]}` : 'Welcome to Cutline') : ({ nutrition: 'Fuel with intention', training: 'Make every set count', progress: 'Trust the trend', settings: 'Your workspace' }[view]);
  }
  function download() {
    try {
      const contents = storageBlocked ? localStorage.getItem(KEY) || localStorage.getItem(LEGACY_KEY) || JSON.stringify(state) : JSON.stringify(state, null, 2);
      const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `cutline-${storageBlocked ? 'original-storage' : 'backup'}-${localDate()}.json`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('Backup download requested.');
    } catch (error) { toast(`Export failed: ${error.message}`); }
  }
  document.addEventListener('click', event => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.view) return showView(target.dataset.view);
    const action = target.dataset.action;
    if (action === 'food') return foodForm();
    if (action === 'checkin') return checkinForm();
    if (action === 'workout') return workoutForm();
    if (action === 'quick') return quickLog();
    if (action === 'settings') return showView('settings');
    if (action === 'range') { chartRange = target.dataset.range; overview(); progress(); return; }
    if (action === 'add-exercise') { if ($$('.exercise-row').length < 100) $('#exercise-fields').insertAdjacentHTML('beforeend', exerciseRow()); else toast('Maximum 100 exercises per session.'); return; }
    if (action === 'remove-exercise') { target.closest('.exercise-row').remove(); return; }
    if (action === 'export') return download();
    if (action === 'import') return $('#import-file').click();
    if (action === 'edit' || action === 'delete') {
      const kind = target.dataset.kind, item = state[kind]?.find(r => r.id === target.dataset.id);
      if (!item) return;
      if (action === 'edit') return ({ foods: foodForm, checkins: checkinForm, workouts: workoutForm }[kind])(item);
      if (confirm('Delete this record permanently?') && commit({ ...state, [kind]: state[kind].filter(r => r.id !== item.id) })) toast('Record deleted.');
    }
    if (action === 'erase' && confirm('Permanently erase your profile and ALL Cutline logs from this browser? Export a backup first if you need it.')) {
      try { localStorage.removeItem(LEGACY_KEY); localStorage.removeItem(KEY); state = empty(); storageBlocked = false; selectedDate = localDate(); chartRange = '4W'; render(); toast('Profile and all logs erased.'); }
      catch (error) { toast(`Could not erase data: ${error.message}`); }
    }
  });
  $('#quick-log').onclick = quickLog;
  $('.profile-mini .icon-btn').onclick = () => showView('settings');
  $('#date-btn').onclick = () => openDialog('Choose a log date', `${field('Date', 'date', selectedDate, 'date', `required min="1900-01-01" max="${localDate()}"`)}<p class="muted">Nutrition and daily totals use this date. History and charts include records through this date.</p>`, data => { selectedDate = validDate(data.date); render(); }, 'View date');
  let loadMessage = '';
  try {
    const stored = localStorage.getItem(KEY);
    if (stored !== null) state = validate(JSON.parse(stored));
    else {
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy !== null) {
        const old = JSON.parse(legacy);
        assert(Array.isArray(old.logs), 'Legacy log data is invalid.');
        const map = new Map();
        for (const log of old.logs) {
          const parsedDate = new Date(log.date);
          assert(Number.isFinite(parsedDate.getTime()), 'Legacy log date is invalid.');
          const record = recordValue('checkins', { id: id(), date: localDate(parsedDate), weight: log.weight, note: 'Imported from an earlier Cutline version.' });
          map.set(record.date, record);
        }
        state = validate({ ...empty(), checkins: [...map.values()] });
        localStorage.setItem(KEY, JSON.stringify(state));
        loadMessage = 'Earlier weight logs migrated. Complete your profile to set estimates.';
      }
    }
  } catch (error) { state = empty(); storageBlocked = true; loadMessage = `Saved data could not be loaded: ${error.message} The original is retained. Open Settings to export or recover it.`; }
  window.addEventListener('storage', event => {
    if (event.key !== KEY && event.key !== null) return;
    try { const raw = localStorage.getItem(KEY); state = raw === null ? empty() : validate(JSON.parse(raw)); storageBlocked = false; if ($('#log-dialog').open) $('#log-dialog').close(); render(); toast('Updated from another browser tab.'); }
    catch { storageBlocked = true; toast('Another tab wrote invalid data. Saving is blocked; use Settings to recover.'); }
  });
  render();
  if (loadMessage) toast(loadMessage);
})();
