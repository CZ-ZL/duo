// General decisions have no Target, persona, dataset or optimization dependency.
import { fail } from './definitions.js'
import { freeze } from './contract.js'

const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const text = (v) => typeof v === 'string' && Boolean(v.trim())
export const decisionId = (v) =>
  typeof v === 'string' &&
  /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(v) &&
  !['constructor', 'prototype', '__proto__'].includes(v)
const keys = (v, allowed) =>
  object(v) && Object.keys(v).sort().join(',') === [...allowed].sort().join(',')

export function decisionRequest(value) {
  const invalid = () =>
    fail(
      'DUO_DECISION_INPUT_INVALID',
      'Supply one JSON state and 1–16 named questions: choice with 2–32 described options, score with 2–10 ordered levels, or boolean. No budget or action authority in the request.',
    )
  let cloned
  try {
    const encoded = JSON.stringify(value)
    if (Buffer.byteLength(encoded) > 65536) invalid()
    cloned = JSON.parse(encoded)
  } catch {
    invalid()
  }
  if (
    !keys(cloned, ['state', 'questions']) ||
    !(text(cloned.state) || object(cloned.state) || Array.isArray(cloned.state)) ||
    !object(cloned.questions)
  )
    invalid()
  const rows = Object.entries(cloned.questions)
  if (!rows.length || rows.length > 16) invalid()
  for (const [id, q] of rows) {
    if (
      !decisionId(id) ||
      !text(q?.instructions) ||
      q.instructions.length > 2048 ||
      !keys(
        q,
        q.type === 'boolean' ? ['type', 'instructions'] : ['type', 'instructions', 'criteria'],
      )
    )
      invalid()
    if (q.type === 'choice') {
      if (
        !object(q.criteria) ||
        Object.keys(q.criteria).length < 2 ||
        Object.keys(q.criteria).length > 32 ||
        !Object.entries(q.criteria).every(([k, v]) => text(k) && k.length <= 128 && text(v))
      )
        invalid()
    } else if (q.type === 'score') {
      if (
        !Array.isArray(q.criteria) ||
        q.criteria.length < 2 ||
        q.criteria.length > 10 ||
        !q.criteria.every(text) ||
        new Set(q.criteria).size !== q.criteria.length
      )
        invalid()
    } else if (q.type !== 'boolean') invalid()
  }
  return freeze(cloned)
}

export function decisionAnswers(value, questions) {
  const invalid = () =>
    fail(
      'DUO_DECISION_OUTPUT_INVALID',
      'Expected every question ID exactly once with an allowed option, level index, boolean, or null for unknown; no prose or confidence.',
    )
  if (!keys(value, Object.keys(questions))) invalid()
  return Object.fromEntries(
    Object.entries(questions).map(([id, q]) => {
      const v = value[id]
      if (
        v !== null &&
        !(q.type === 'boolean'
          ? typeof v === 'boolean'
          : q.type === 'choice'
            ? typeof v === 'string' && Object.hasOwn(q.criteria, v)
            : Number.isInteger(v) && v >= 0 && v < q.criteria.length)
      )
        invalid()
      return [id, { type: q.type, status: v === null ? 'unknown' : 'answered', value: v }]
    }),
  )
}
