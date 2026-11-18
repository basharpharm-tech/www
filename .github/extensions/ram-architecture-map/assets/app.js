const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const localize = value => typeof value === 'object' ? (value.en || '') : (value || '');

let spec;
let ruleFilter = 'all';

function showDetail(title, body) {
  document.getElementById('detail-title').textContent = title;
  document.getElementById('detail-body').innerHTML = body;
  document.getElementById('detail').hidden = false;
}

function closeDetail() {
  document.getElementById('detail').hidden = true;
}

function ruleDetail(rule) {
  const outputs = (rule.then || []).map(id => spec.outputs.find(output => output.id === id)).filter(Boolean);
  const removals = (rule.remove || []).map(id => spec.outputs.find(output => output.id === id)).filter(Boolean);
  showDetail(`${rule.id} — ${rule.group}`, `
    <p>${esc(rule.statement)}</p>
    <p><strong>Stage:</strong> ${esc(rule.stage)} &nbsp; <strong>Priority:</strong> ${esc(rule.priority)} &nbsp; <strong>Basis:</strong> ${esc(rule.basis)}</p>
    <p><strong>Condition:</strong> <code>${esc(JSON.stringify(rule.when))}</code></p>
    ${outputs.length ? `<p><strong>Adds:</strong></p><ul>${outputs.map(output => `<li>${esc(output.id)} — ${esc(localize(output.title))}</li>`).join('')}</ul>` : ''}
    ${removals.length ? `<p><strong>Removes:</strong></p><ul>${removals.map(output => `<li>${esc(output.id)} — ${esc(localize(output.title))}</li>`).join('')}</ul>` : ''}
  `);
}

function renderArchitecture() {
  const stages = spec.meta.stages || [];
  const referralCount = spec.rules.filter(rule => rule.group === 'referral').length;
  const managementCount = spec.rules.filter(rule => rule.group === 'management').length;
  document.getElementById('architecture').innerHTML = `
    <div class="arch-grid">
      <div class="arch-col">
        <button class="node" data-detail="inputs"><strong>${spec.inputs.length} typed inputs</strong><small>Conditional questions, enum/set/boolean values, and ask-if visibility rules</small></button>
        <button class="node stage" data-detail="engine"><strong>Deterministic engine</strong><small>Validates answers, evaluates conditions, and applies rule priority</small></button>
      </div>
      <div class="arch-col">
        ${stages.map(stage => `<button class="node stage stage-arrow" data-stage="${stage.n}"><strong>${stage.n}. ${esc(localize(stage.label))}</strong><small>${esc(spec.inputs.filter(input => input.stage === stage.n).length)} inputs</small></button>`).join('')}
      </div>
      <div class="arch-col">
        <button class="node referral" data-detail="referral"><strong>Referral rules · ${referralCount}</strong><small>Referral pre-empts incomplete and management outcomes</small></button>
        <button class="node management" data-detail="management"><strong>Management rules · ${managementCount}</strong><small>Add or remove output recommendations at final stage</small></button>
        <button class="node output" data-detail="outputs"><strong>${spec.outputs.length} recommendations</strong><small>Refer, advice, medicine, caution, information, and insufficient-data outcomes</small></button>
      </div>
    </div>`;

  document.querySelectorAll('[data-detail]').forEach(button => button.addEventListener('click', () => {
    const key = button.dataset.detail;
    const details = {
      inputs: ['Inputs', `<p>The specification contains <strong>${spec.inputs.length}</strong> input definitions across stages 1–5.</p><p>Conditional questions use <code>ask_if</code>; set inputs support exclusive values.</p>`],
      engine: ['Rules engine', '<p>The engine evaluates only rules at or before the current stage.</p><p>All referral matches are collected first. If any fire, they pre-empt management and incomplete states.</p>'],
      referral: ['Referral branch', `<p>${referralCount} rules use the referral group.</p><p>Urgent and soon referrals are sorted by urgency before display.</p>`],
      management: ['Management branch', `<p>${managementCount} rules use management or other non-referral groups.</p><p>Later rules can add recommendations and remove earlier recommendations through <code>$outputs</code>.</p>`],
      outputs: ['Output catalog', `<p>${spec.outputs.length} output records are referenced by the rules.</p><p>Use the Rule map to trace each rule to its outputs.</p>`],
    };
    showDetail(details[key][0], details[key][1]);
  }));
  document.querySelectorAll('[data-stage]').forEach(button => button.addEventListener('click', () => {
    const stage = Number(button.dataset.stage);
    const stageDef = stages.find(item => item.n === stage);
    const inputs = spec.inputs.filter(input => input.stage === stage);
    showDetail(`Stage ${stage} — ${localize(stageDef.label)}`, `
      <p><strong>${inputs.length} inputs</strong></p>
      <ul>${inputs.map(input => `<li>${esc(localize(input.label))} <code>${esc(input.id)}</code></li>`).join('')}</ul>
    `);
  }));
}

function renderFlow() {
  const stages = spec.meta.stages || [];
  document.getElementById('flow').innerHTML = `<div class="flow">${stages.map(stage => {
    const rules = spec.rules.filter(rule => rule.stage === stage.n);
    return `<article class="flow-stage">
      <h3>${stage.n}. ${esc(localize(stage.label))}</h3>
      ${rules.map(rule => `<button class="flow-rule ${rule.group}" data-rule="${rule.id}" aria-label="Open ${rule.id}">
        ${esc(rule.id)} — ${esc(rule.group)}<span>Priority ${esc(rule.priority)}</span>
      </button>`).join('') || '<small>No stage-specific rules</small>'}
    </article>`;
  }).join('')}</div>`;
  document.querySelectorAll('[data-rule]').forEach(button => button.addEventListener('click', () => {
    const rule = spec.rules.find(item => item.id === button.dataset.rule);
    ruleDetail(rule);
  }));
}

function renderRules() {
  const filtered = ruleFilter === 'all' ? spec.rules : spec.rules.filter(rule => rule.group === ruleFilter);
  document.getElementById('rules').innerHTML = `
    <div class="rules-toolbar" aria-label="Filter rules">
      ${['all', 'referral', 'management'].map(group => `<button class="${ruleFilter === group ? 'active' : ''}" data-filter="${group}">${group === 'all' ? 'All' : group[0].toUpperCase() + group.slice(1)} (${group === 'all' ? spec.rules.length : spec.rules.filter(rule => rule.group === group).length})</button>`).join('')}
    </div>
    <div class="rules-grid">${filtered.map(rule => `
      <button class="rule-card ${rule.group}" data-rule="${rule.id}">
        <strong>${esc(rule.id)} · Stage ${esc(rule.stage)}</strong>
        <p>${esc(rule.statement)}</p>
        <small>${esc(rule.group)} · priority ${esc(rule.priority)}</small>
      </button>`).join('')}</div>`;
  document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
    ruleFilter = button.dataset.filter;
    renderRules();
  }));
  document.querySelectorAll('[data-rule]').forEach(button => button.addEventListener('click', () => {
    ruleDetail(spec.rules.find(rule => rule.id === button.dataset.rule));
  }));
}

async function initialize() {
  const response = await fetch('/api/spec');
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  spec = await response.json();
  document.getElementById('title').textContent = localize(spec.meta.title);
  document.getElementById('status').textContent = `DRAFT · ${spec.meta.status} · v${spec.meta.version}`;
  renderArchitecture();
  renderFlow();
  renderRules();

  document.querySelectorAll('.tabs button').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach(item => {
      item.classList.remove('active');
      item.setAttribute('aria-selected', 'false');
    });
    document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
    button.classList.add('active');
    button.setAttribute('aria-selected', 'true');
    document.getElementById(button.dataset.view).classList.add('active');
  }));
  document.getElementById('detail-close').addEventListener('click', closeDetail);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeDetail();
  });
}

initialize().catch(error => {
  document.getElementById('status').textContent = `Unable to load: ${error.message}`;
});
