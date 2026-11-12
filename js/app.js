import { evaluate, isAsked } from './engine.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DRUG_IDS = ['REC-301', 'REC-302', 'REC-303', 'REC-304', 'REC-305'];

let SPEC, STR, EVID;
const state = {
  lang: 'en', screen: 'home', stage: 1, answers: {}, showErrors: false,
  result: null, referralStage: null, adviceConfirmed: false, drug: null,
};

// ---------- data ----------
async function loadData() {
  if (window.__RAM_DATA__) return window.__RAM_DATA__;            // single-file build
  const get = p => fetch(p).then(r => { if (!r.ok) throw new Error(p); return r.json(); });
  const [spec, strings, evidence] = await Promise.all([get('data/logic_spec.json'), get('data/ui_strings.json'), get('data/evidence.json')]);
  return { spec, strings, evidence };
}
const t = (k, vars = {}) => (STR[state.lang][k] ?? STR.en[k] ?? k).replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? '');
const L = o => (o && typeof o === 'object') ? (o[state.lang] ?? o.en ?? '') : (o ?? '');
const optLabel = (def, v) => L(def.options?.find(o => o.value === v)?.label) || v;

function prefersLang() {
  try { const s = localStorage.getItem('ram.lang'); if (s === 'en' || s === 'ar') return s; } catch { /* storage unavailable */ }
  return (navigator.language || '').startsWith('ar') ? 'ar' : 'en';
}
function setLang(lang) {
  state.lang = lang;
  try { localStorage.setItem('ram.lang', lang); } catch { /* ignore */ }
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  document.title = t('app_name');
}

// ---------- answers ----------
// Visible inputs for a stage, using only answers to questions that are themselves still asked.
function askedContext() {
  const ctx = {};
  for (const d of SPEC.inputs) if (isAsked(d, ctx) && state.answers[d.id] !== undefined) ctx[d.id] = state.answers[d.id];
  return ctx;
}
function visibleInputs(stage) {
  const ctx = {}, out = [];
  for (const d of SPEC.inputs) {
    if (!isAsked(d, ctx)) continue;
    if (state.answers[d.id] !== undefined) ctx[d.id] = state.answers[d.id];
    if (d.stage === stage) out.push(d);
  }
  return out;
}
function setAnswer(def, value, checked) {
  if (def.type === 'set') {
    let cur = Array.isArray(state.answers[def.id]) ? [...state.answers[def.id]] : [];
    if (checked) {
      if (def.exclusive && value === def.exclusive) cur = [value];
      else cur = cur.filter(v => v !== def.exclusive).concat(value);
    } else cur = cur.filter(v => v !== value);
    state.answers[def.id] = cur.length ? cur : undefined;
  } else if (def.type === 'boolean') state.answers[def.id] = value === 'true';
  else state.answers[def.id] = value;
}

// ---------- shell ----------
let lastView = '';
function shell(inner, { rail = false, actions = '' } = {}) {
  const view = `${state.screen}:${state.stage}:${state.drug}:${state.lang}`;
  const animate = view !== lastView; lastView = view;
  const railHtml = rail ? `<div class="rail" role="list" aria-label="WWHAM">${SPEC.meta.stages.map(s => {
    let st = s.n < state.stage ? 'done' : s.n === state.stage ? 'current' : 'todo';
    if (state.screen === 'referral') st = s.n < state.referralStage ? 'done' : s.n === state.referralStage ? 'referral' : 'todo';
    if (['assessment', 'choose', 'drug', 'summary'].includes(state.screen)) st = 'done';
    return `<div class="rail-step" role="listitem" data-state="${st}" aria-label="${esc(L(s.label))}${st === 'current' ? ' (current)' : ''}"><span class="rail-letter" aria-hidden="true">${s.letter}</span></div>`;
  }).join('')}</div>` : '';
  document.getElementById('app').innerHTML = `
    <header class="topbar">
      <div class="topbar-row">
        <button class="brand" data-act="home" aria-label="${esc(t('home'))}: ${esc(t('app_name'))}"><span class="brand-mark" aria-hidden="true">RAM</span><span class="brand-name">${esc(t('app_name'))}</span></button>
        <button class="chip-btn" data-act="about" aria-label="${esc(t('about'))}">i</button>
        <button class="chip-btn" data-act="lang" lang="${state.lang === 'en' ? 'ar' : 'en'}" aria-label="${esc(t('language_toggle_label'))}">${esc(t('language_toggle'))}</button>
      </div>${railHtml}
    </header>
    <main id="main" class="${animate ? 'enter' : ''}">${inner}<p class="footer-note">${esc(t('footer_version', { v: SPEC.meta.version }))}</p></main>
    ${actions ? `<nav class="actions" aria-label="Actions"><div class="actions-row">${actions}</div></nav>` : ''}
    <dialog class="sheet" id="sheet"></dialog>`;
  const h1 = $('#main h1');
  if (animate) { if (h1) { h1.tabIndex = -1; h1.focus({ preventScroll: true }); } window.scrollTo(0, 0); }
}

// ---------- screens ----------
function renderHome() {
  shell(`
    <span class="badge-research">${esc(t('research_badge'))}</span>
    <h1>${esc(t('home_title'))}</h1>
    <p class="lead">${esc(t('home_intro'))}</p>
    <div class="ailments">
      <button class="ailment" aria-pressed="true" data-act="noop"><span class="ailment-name">${esc(t('ailment_cough'))}</span><span class="ailment-desc">${esc(t('ailment_cough_desc'))}</span></button>
      <button class="ailment" disabled><span class="ailment-name">${esc(t('ailment_cold'))}</span><span class="ailment-desc">${esc(t('coming_later'))}</span></button>
      <button class="ailment" disabled><span class="ailment-name">${esc(t('ailment_throat'))}</span><span class="ailment-desc">${esc(t('coming_later'))}</span></button>
    </div>`, { actions: `<button class="btn primary" data-act="start">${esc(t('start'))}</button>` });
}

function renderQuestion(def, missing, errs) {
  const val = state.answers[def.id];
  const isSet = def.type === 'set';
  const options = def.type === 'boolean' ? [{ value: 'true', label: { en: t('yes'), ar: t('yes') } }, { value: 'false', label: { en: t('no'), ar: t('no') } }] : def.options;
  const checked = o => isSet ? (Array.isArray(val) && val.includes(o.value)) : def.type === 'boolean' ? (val !== undefined && String(val) === o.value) : val === o.value;
  const err = state.showErrors && (missing.includes(def.id) || errs.some(e => e.input === def.id));
  const errText = errs.some(e => e.input === def.id && e.code === 'exclusive') ? t('exclusive_error') : t('answer_this');
  const hint = def.red_flag ? t('red_flag_note') : '';
  return `<fieldset class="q${def.red_flag ? ' redflags' : ''}${err ? ' has-error' : ''}" id="q-${def.id}" ${err ? `aria-describedby="e-${def.id}"` : ''}>
    <legend class="q-label">${esc(L(def.label))}</legend>
    ${hint ? `<p class="q-hint">${esc(hint)}</p>` : ''}${def.help ? `<p class="q-hint">${esc(L(def.help))}</p>` : ''}
    <div class="opts${def.type === 'boolean' || (options.length === 2 && !isSet) ? ' two' : ''}">
      ${options.map(o => `<label class="opt"><input type="${isSet ? 'checkbox' : 'radio'}" name="${def.id}" value="${esc(o.value)}" ${checked(o) ? 'checked' : ''} data-input="${def.id}"><span class="opt-box" aria-hidden="true"></span><span class="opt-text">${esc(L(o.label))}</span></label>`).join('')}
    </div>
    ${err ? `<p class="q-error" id="e-${def.id}" role="alert">${esc(errText)}</p>` : ''}
  </fieldset>`;
}

function renderStage() {
  const st = SPEC.meta.stages[state.stage - 1];
  const defs = visibleInputs(state.stage);
  const check = evaluate(SPEC, state.answers, { stage: state.stage });
  const missing = check.missing || [], errs = check.errors || [];
  const stageHasErr = state.showErrors && defs.some(d => missing.includes(d.id) || errs.some(e => e.input === d.id));
  shell(`
    <p class="step-count">${esc(t('step_of', { n: state.stage }))}</p>
    <h1><span aria-hidden="true">${st.letter} — </span>${esc(L(st.label))}</h1>
    ${stageHasErr ? `<div class="error-banner" role="alert">${esc(t('errors_summary'))}</div>` : ''}
    ${defs.map(d => renderQuestion(d, missing, errs)).join('')}`,
    { rail: true, actions: `<button class="btn" data-act="back">${esc(t('back'))}</button><button class="btn primary" data-act="next">${esc(state.stage === 5 ? t('see_assessment') : t('continue'))}</button>` });
}

function onNext() {
  const r = evaluate(SPEC, state.answers, { stage: state.stage });
  if (r.status === 'incomplete') {
    state.showErrors = true; renderStage();
    const first = SPEC.inputs.find(d => r.missing.includes(d.id) || r.errors.some(e => e.input === d.id));
    const el = first && document.getElementById('q-' + first.id);
    if (el) { el.scrollIntoView({ block: 'start' }); el.querySelector('input')?.focus({ preventScroll: true }); }
    return;
  }
  state.showErrors = false;
  if (r.status === 'referral') { state.result = r; state.referralStage = state.stage; state.screen = 'referral'; return render(); }
  if (r.status === 'management') { state.result = r; state.screen = 'assessment'; return render(); }
  state.stage += 1; render();
}

function evidenceTags(ids, rule) {
  const r = rule && SPEC.rules.find(x => x.id === rule);
  const basis = r && r.basis !== 'EVIDENCE' ? `<span class="tag basis-local">${esc(r.basis)}</span>` : '';
  return `<div class="meta">${rule ? `<span class="tag">${esc(t('rule'))} ${esc(rule)}</span>` : ''}${basis}${(ids || []).map(id => `<button class="tag" data-ev="${id}">${id}</button>`).join('')}</div>`;
}

function renderReferral() {
  const refs = state.result.referrals;
  const urgent = refs.some(r => r.urgency === 'urgent');
  shell(`
    <div class="band ${urgent ? 'urgent' : 'soon'}"><h1>${esc(urgent ? t('refer_urgent') : t('refer_soon'))}</h1><p>${esc(t('refer_lead'))}</p></div>
    <h2>${esc(t('reasons'))}</h2>
    ${refs.map(o => `<div class="reason ${o.urgency}">
      <h3>${esc(L(o.title))}</h3>
      <p class="where">${esc(t('where'))}: ${esc(o.urgency === 'urgent' ? L({ en: 'Same day — emergency department or GP, depending on severity', ar: 'في اليوم نفسه — الطوارئ أو الطبيب العام حسب الشدة' }) : L({ en: 'As soon as practicable — GP appointment', ar: 'في أقرب وقت ممكن — موعد مع الطبيب العام' }))}</p>
      <p>${esc(L(o.text))}</p>${evidenceTags(o.evidence_ids, o.rule)}</div>`).join('')}
    <button class="btn block" data-act="copy-referral">${esc(t('copy_note'))}</button>`,
    { rail: true, actions: `<button class="btn" data-act="edit">${esc(t('edit_answers'))}</button><button class="btn primary" data-act="restart">${esc(t('new_consultation'))}</button>` });
}

const outputsOf = kinds => state.result.outputs.filter(o => kinds.includes(o.kind));

function renderAssessment() {
  const notes = outputsOf(['info', 'caution']).filter(o => !o.applies_to);
  const advice = outputsOf(['advice']);
  shell(`
    <div class="band clear"><h1>${esc(t('assessment_title'))}</h1><p>${esc(t('assessment_lead'))}</p></div>
    ${notes.length ? `<h2>${esc(t('notes_title'))}</h2>${notes.map(o => `<div class="note${o.kind === 'caution' ? ' caution' : ''}"><h3>${esc(L(o.title))}</h3><p>${esc(L(o.text))}</p>${evidenceTags(o.evidence_ids)}</div>`).join('')}` : ''}
    <h2>${esc(t('advice_title'))}</h2>
    <ul class="advice-list">${advice.map(o => `<li><h3>${esc(L(o.title))}</h3><p>${esc(L(o.text))}</p>${evidenceTags(o.evidence_ids)}</li>`).join('')}</ul>
    <fieldset class="q confirm${state.showErrors && !state.adviceConfirmed ? ' has-error' : ''}">
      <legend class="visually-hidden">${esc(t('advice_confirm'))}</legend>
      <label class="opt"><input type="checkbox" data-act="confirm-advice" ${state.adviceConfirmed ? 'checked' : ''}><span class="opt-box" aria-hidden="true"></span><span class="opt-text">${esc(t('advice_confirm'))}</span></label>
      ${state.showErrors && !state.adviceConfirmed ? `<p class="q-error" role="alert">${esc(t('advice_required'))}</p>` : ''}
    </fieldset>`,
    { rail: true, actions: `<button class="btn" data-act="edit">${esc(t('edit_answers'))}</button><button class="btn primary" data-act="to-choose">${esc(t('choose_medicine'))}</button>` });
}

const cautionsFor = id => state.result.outputs.filter(o => o.applies_to === id);

function renderChoose() {
  const meds = state.result.outputs.filter(o => DRUG_IDS.includes(o.id));
  const fallback = state.result.outputs.find(o => o.id === 'REC-499');
  const byId = Object.fromEntries(SPEC.outputs.map(o => [o.id, o]));
  const excluded = state.result.excluded;
  shell(`
    <h1>${esc(t('choose_title'))}</h1>
    <p class="lead">${esc(t('choose_lead'))}</p>
    ${fallback ? `<div class="note caution"><h3>${esc(L(fallback.title))}</h3><p>${esc(L(fallback.text))}</p></div>` : ''}
    ${meds.map(m => { const n = cautionsFor(m.id).length; return `<button class="med" data-drug="${m.id}">
      <span class="med-name">${esc(L(m.title))}</span><span class="med-class">${esc(L(m.class))}</span>
      <span class="med-dose">${esc(L(m.monograph.dose))}${/GAP-/.test(L(m.monograph.regimen)) ? '' : ` — ${esc(L(m.monograph.regimen))}`}</span>
      <span class="med-meta"><span class="pill">${esc(t('evidence_level'))}: ${esc(m.evidence_level)}</span>${n ? `<span class="pill warn">${esc(t('n_cautions', { n }))}</span>` : ''}</span></button>`; }).join('')}
    ${excluded.length ? `<h2>${esc(t('not_suitable'))}</h2><ul class="excluded">${excluded.map(x => `<li><strong>${esc(L(byId[x.id].title))}</strong> — ${esc(L(x.reason))}${evidenceTags(x.evidence_ids, x.rule)}</li>`).join('')}</ul>` : ''}`,
    { rail: true, actions: `<button class="btn" data-act="to-assessment">${esc(t('back'))}</button>${fallback && !meds.length ? `<button class="btn primary" data-act="finish">${esc(t('finish'))}</button>` : ''}` });
}

function monoRow(label, obj) {
  const text = L(obj);
  const gap = /GAP-\d+/.test(text);
  return `<div><dt>${esc(label)}</dt><dd class="${gap ? 'gap-text' : ''}">${esc(text)}</dd></div>`;
}
function renderDrug() {
  const m = state.result.outputs.find(o => o.id === state.drug);
  const mo = m.monograph; const cs = cautionsFor(m.id);
  shell(`
    <p class="step-count">${esc(t('counsel_title'))}</p>
    <h1>${esc(L(m.title))}</h1>
    <p class="lead">${esc(L(m.class))}</p>
    ${cs.length ? `<h2>${esc(t('for_this_patient'))}</h2>${cs.map(c => `<div class="note caution"><h3>${esc(L(c.title))}</h3><p>${esc(L(c.text))}</p>${evidenceTags(c.evidence_ids)}</div>`).join('')}` : ''}
    <h2>${esc(t('counsel_title'))}</h2>
    <dl class="mono">
      ${monoRow(t('dose'), mo.dose)}${monoRow(t('form'), mo.form)}${monoRow(t('regimen'), mo.regimen)}${monoRow(t('side_effects'), mo.side_effects)}
      ${monoRow(t('drug_interactions'), mo.drug_interactions)}${monoRow(t('food_interactions'), mo.food_interactions)}${monoRow(t('duration'), mo.duration)}${monoRow(t('onset'), mo.onset)}
      ${monoRow(t('pregnancy'), mo.pregnancy)}${monoRow(t('breastfeeding'), mo.breastfeeding)}${monoRow(t('take_care'), mo.cautions)}
    </dl>
    ${evidenceTags(m.evidence_ids)}`,
    { rail: true, actions: `<button class="btn" data-act="to-choose">${esc(t('back'))}</button><button class="btn primary" data-act="finish">${esc(t('finish'))}</button>` });
}

function recordText() {
  const lines = [`${t('app_name')} — ${t('summary_title')}`, `${t('logic_version')}: ${SPEC.meta.version} (${t('status_draft')})`, ''];
  lines.push(`${t('answers')}:`);
  const ctx = askedContext();
  for (const d of SPEC.inputs) {
    if (!(d.id in ctx)) continue;
    const v = ctx[d.id];
    const shown = d.type === 'boolean' ? (v ? t('yes') : t('no')) : Array.isArray(v) ? v.map(x => optLabel(d, x)).join('; ') : optLabel(d, v);
    lines.push(`- ${L(d.label)}: ${shown}`);
  }
  lines.push('', `${t('outcome')}:`);
  if (state.result.status === 'referral') {
    const urgent = state.result.referrals.some(r => r.urgency === 'urgent');
    lines.push(urgent ? t('refer_urgent') : t('refer_soon'));
    state.result.referrals.forEach(r => lines.push(`- ${L(r.title)} (${r.rule})`));
  } else {
    lines.push(t('assessment_title'));
    if (state.drug) { const m = state.result.outputs.find(o => o.id === state.drug); lines.push(`${t('selected_medicine')}: ${L(m.title)} — ${L(m.monograph.dose)}, ${L(m.monograph.regimen)}`); }
  }
  return lines.join('\n');
}
function renderSummary() {
  shell(`
    <h1>${esc(t('summary_title'))}</h1><p class="lead">${esc(t('summary_lead'))}</p>
    <pre class="record">${esc(recordText())}</pre>
    <button class="btn block" data-act="copy-summary">${esc(t('copy_summary'))}</button>`,
    { rail: true, actions: `<button class="btn primary" data-act="restart">${esc(t('new_consultation'))}</button>` });
}
function renderAbout() {
  shell(`
    <h1>${esc(t('about_title'))}</h1>
    <span class="badge-research">${esc(t('research_badge'))}</span>
    <p>${esc(t('about_body'))}</p><p>${esc(t('about_privacy'))}</p><p>${esc(t('about_arabic'))}</p>
    <dl class="mono">
      <div><dt>${esc(t('logic_version'))}</dt><dd>${esc(SPEC.meta.version)}</dd></div>
      <div><dt>${esc(t('logic_status'))}</dt><dd>${esc(t('status_draft'))}</dd></div>
      <div><dt>${esc(t('sources'))}</dt><dd>${esc(SPEC.meta.source)}</dd></div>
    </dl>`, { actions: `<button class="btn primary" data-act="close-about">${esc(t('back'))}</button>` });
}

function openEvidence(id) {
  const e = EVID[id]; const d = $('#sheet'); if (!e || !d) return;
  d.innerHTML = `<div class="sheet-body" role="document">
    <h2 style="margin-top:0">${esc(t('evidence_sheet_title'))} ${esc(id)}</h2>
    <p><strong>${esc(t('section'))}:</strong> <span dir="ltr">${esc(e.section)}</span></p>
    <p dir="ltr" lang="en">${esc(e.paraphrase)}</p>
    <p><strong>${esc(t('quote'))}:</strong></p><blockquote lang="en">“${esc(e.quote)}”</blockquote>
    <p><strong>${esc(t('certainty'))}:</strong> <span dir="ltr">${esc(e.certainty)}</span></p>
    ${state.lang === 'ar' ? `<p class="q-hint">${esc(t('source_english'))}</p>` : ''}
    <button class="btn block" data-act="close-sheet">${esc(t('close'))}</button></div>`;
  d.setAttribute('aria-label', `${t('evidence_sheet_title')} ${id}`);
  d.showModal();
}

function toast(msg) {
  const el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); el.textContent = msg;
  document.body.appendChild(el); setTimeout(() => el.remove(), 2500);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast(t('copied')); } catch { toast(t('copy_failed')); }
}

function render() {
  ({ home: renderHome, stage: renderStage, referral: renderReferral, assessment: renderAssessment, choose: renderChoose,
     drug: renderDrug, summary: renderSummary, about: renderAbout })[state.screen]();
}
function restart() {
  Object.assign(state, { screen: 'home', stage: 1, answers: {}, showErrors: false, result: null, referralStage: null, adviceConfirmed: false, drug: null });
  render();
}

// ---------- events ----------
document.addEventListener('change', e => {
  const inp = e.target.closest('input[data-input]');
  if (inp) {
    const def = SPEC.inputs.find(d => d.id === inp.dataset.input);
    setAnswer(def, inp.value, inp.checked);
    const y = window.scrollY; const focusId = `${inp.name}::${inp.value}`;
    renderStage(); window.scrollTo(0, y);
    const again = [...document.querySelectorAll('input[data-input]')].find(i => `${i.name}::${i.value}` === focusId);
    again?.focus({ preventScroll: true });
    return;
  }
  if (e.target.matches('[data-act="confirm-advice"]')) { state.adviceConfirmed = e.target.checked; }
});
document.addEventListener('click', e => {
  const ev = e.target.closest('[data-ev]'); if (ev) return openEvidence(ev.dataset.ev);
  const dr = e.target.closest('[data-drug]'); if (dr) { state.drug = dr.dataset.drug; state.screen = 'drug'; return render(); }
  const a = e.target.closest('[data-act]'); if (!a) return;
  const act = a.dataset.act;
  if (act === 'home') return restart();
  if (act === 'lang') { setLang(state.lang === 'en' ? 'ar' : 'en'); return render(); }
  if (act === 'about') { if (state.screen !== 'about') state.prev = state.screen; state.screen = 'about'; return render(); }
  if (act === 'close-about') { state.screen = state.prev || 'home'; return render(); }
  if (act === 'start') { state.screen = 'stage'; state.stage = 1; return render(); }
  if (act === 'next') return onNext();
  if (act === 'back') { state.showErrors = false; if (state.stage > 1) { state.stage -= 1; state.screen = 'stage'; } else state.screen = 'home'; return render(); }
  if (act === 'edit') { state.screen = 'stage'; state.stage = state.referralStage || 5; state.result = null; state.adviceConfirmed = false; return render(); }
  if (act === 'restart') return restart();
  if (act === 'to-choose') { if (!state.adviceConfirmed) { state.showErrors = true; renderAssessment(); $('.confirm input')?.focus(); return; } state.showErrors = false; state.screen = 'choose'; return render(); }
  if (act === 'to-assessment') { state.screen = 'assessment'; return render(); }
  if (act === 'finish') { state.screen = 'summary'; return render(); }
  if (act === 'copy-referral' || act === 'copy-summary') return copy(recordText());
  if (act === 'close-sheet') return $('#sheet')?.close();
});

// ---------- boot ----------
(async function boot() {
  try {
    const d = await loadData(); SPEC = d.spec; STR = d.strings; EVID = d.evidence;
    setLang(prefersLang()); render();
  } catch (err) {
    document.getElementById('app').innerHTML = `<main><h1>Unable to load the app data</h1><p>${esc(err.message)}. Open the app through a web server (see README), not directly from the file system.</p></main>`;
  }
  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !window.__RAM_DATA__) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline cache unavailable */ });
  }
})();
