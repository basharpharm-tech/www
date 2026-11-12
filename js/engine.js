// Respiratory-Ailment-Manager rules engine — pure, deterministic, no DOM, no network.
// evaluate(spec, answers, {stage}) -> { status, referrals, outputs, excluded, firedRules, trace, errors, missing, specVersion }
//   status: 'incomplete' | 'referral' | 'management'
// Rules in group "referral" pre-empt every "management" rule. Rules run only if rule.stage <= stage.

export function isAsked(def, ctx) {
  return !def.ask_if || test(def.ask_if, ctx);
}

// Returns {values, errors, missing}. Inputs are processed in spec order so ask_if can depend on earlier answers.
export function validateInputs(spec, raw, stage = Infinity) {
  const values = {}, errors = [], missing = [];
  for (const def of spec.inputs) {
    if ((def.stage ?? 1) > stage) continue;
    if (!isAsked(def, values)) continue;              // not applicable: ignore any stale answer
    const v = raw[def.id];
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    if (empty) { if (def.required) missing.push(def.id); continue; }
    const optionValues = (def.options || []).map(o => o.value);
    if (def.type === 'boolean') {
      if (typeof v !== 'boolean') { errors.push({ input: def.id, code: 'type' }); continue; }
    } else if (def.type === 'enum') {
      if (!optionValues.includes(v)) { errors.push({ input: def.id, code: 'option' }); continue; }
    } else if (def.type === 'set') {
      if (!Array.isArray(v) || v.some(x => !optionValues.includes(x))) { errors.push({ input: def.id, code: 'option' }); continue; }
      if (def.exclusive && v.includes(def.exclusive) && v.length > 1) { errors.push({ input: def.id, code: 'exclusive' }); continue; }
    } else {
      errors.push({ input: def.id, code: 'unknown_type' }); continue;
    }
    values[def.id] = Array.isArray(v) ? [...v] : v;
  }
  return { values, errors, missing };
}

export function test(cond, ctx) {
  if (cond.all) return cond.all.every(c => test(c, ctx));
  if (cond.any) return cond.any.some(c => test(c, ctx));
  if (cond.not) return !test(cond.not, ctx);
  if (cond.count) {
    const n = cond.count.filter(c => test(c, ctx)).length;
    return compare(n, cond.op, cond.value);
  }
  const v = ctx[cond.var];
  if (cond.op === 'exists') return v !== undefined;
  if (cond.op === 'missing') return v === undefined;
  if (v === undefined) return false;                  // unknown never satisfies a comparison (fail-safe)
  switch (cond.op) {
    case 'has': return Array.isArray(v) && v.includes(cond.value);
    case 'has_any': return Array.isArray(v) && cond.value.some(x => v.includes(x));
    case 'has_none': return Array.isArray(v) && !cond.value.some(x => v.includes(x));
    case 'in': return cond.value.includes(v);
    case 'not_in': return !cond.value.includes(v);
    default: return compare(v, cond.op, cond.value);
  }
}

function compare(a, op, b) {
  switch (op) {
    case '==': return a === b;
    case '!=': return a !== b;
    case '<': return a < b;
    case '<=': return a <= b;
    case '>': return a > b;
    case '>=': return a >= b;
    default: throw new Error(`Unknown operator: ${op}`);
  }
}

const URGENCY_ORDER = { urgent: 0, soon: 1, review: 2 };

export function evaluate(spec, raw, opts = {}) {
  const stage = opts.stage ?? Infinity;
  const { values, errors, missing } = validateInputs(spec, raw, stage);
  const byId = Object.fromEntries(spec.outputs.map(o => [o.id, o]));
  const res = { specVersion: spec.meta.version, errors, missing, firedRules: [], trace: [], referrals: [], outputs: [], excluded: [], values };
  const sortRules = upTo => spec.rules.filter(r => (r.stage ?? 1) <= upTo)
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

  if (errors.length || missing.length) {
    // DEF-001: a referral already established by fully answered earlier stages still wins over "incomplete".
    const stageOf = id => spec.inputs.find(d => d.id === id)?.stage ?? 1;
    const firstBad = Math.min(...missing.map(stageOf), ...errors.map(e => stageOf(e.input)));
    for (const r of sortRules(firstBad - 1).filter(r => r.group === 'referral')) {
      if (test(r.when, values)) { res.firedRules.push(r.id); for (const o of r.then) if (!res.referrals.some(x => x.id === o)) res.referrals.push({ ...byId[o], rule: r.id }); }
    }
    if (res.referrals.length) {
      res.referrals.sort((a, b) => (URGENCY_ORDER[a.urgency] ?? 9) - (URGENCY_ORDER[b.urgency] ?? 9));
      return { ...res, status: 'referral', incomplete: true };
    }
    return { ...res, status: 'incomplete' };
  }

  const rules = sortRules(stage);

  // 1) Referral group: all matching referral rules are collected (no ordering shortcut).
  for (const r of rules.filter(r => r.group === 'referral')) {
    const fired = test(r.when, values);
    res.trace.push({ rule: r.id, fired });
    if (fired) { res.firedRules.push(r.id); for (const o of r.then) if (!res.referrals.some(x => x.id === o)) res.referrals.push({ ...byId[o], rule: r.id }); }
  }
  if (res.referrals.length) {
    res.referrals.sort((a, b) => (URGENCY_ORDER[a.urgency] ?? 9) - (URGENCY_ORDER[b.urgency] ?? 9));
    return { ...res, status: 'referral' };
  }
  if (stage < (spec.meta.final_stage ?? Infinity)) return { ...res, status: 'continue' };

  // 2) Management group, in priority order. "$outputs" lets later rules see what is currently recommended.
  const ctx = { ...values, $outputs: [] };
  for (const r of rules.filter(r => r.group !== 'referral')) {
    const fired = test(r.when, ctx);
    res.trace.push({ rule: r.id, fired });
    if (!fired) continue;
    res.firedRules.push(r.id);
    for (const o of r.then || []) if (!ctx.$outputs.includes(o)) ctx.$outputs.push(o);
    for (const o of r.remove || []) {
      if (ctx.$outputs.includes(o)) {
        ctx.$outputs = ctx.$outputs.filter(x => x !== o);
        res.excluded.push({ id: o, rule: r.id, reason: r.reason, evidence_ids: r.evidence_ids || [] });
      }
    }
  }
  res.outputs = ctx.$outputs.map(id => ({ ...byId[id] }));
  return { ...res, status: 'management' };
}
