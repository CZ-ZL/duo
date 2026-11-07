import test from 'node:test'
import assert from 'node:assert/strict'
import { decisionRequest, decisionAnswers } from '../../native/decision-contract.js'

const questions = {
  route: {
    type: 'choice',
    instructions: 'Which team owns this ticket?',
    criteria: { billing: 'Charges and invoices', access: 'Sign-in and access' },
  },
  urgency: {
    type: 'score',
    instructions: 'How urgent is the ticket?',
    criteria: ['Routine inquiry', 'Service impaired', 'Service unavailable'],
  },
  needs_human: { type: 'boolean', instructions: 'Does the customer explicitly request a human?' },
}
const request = {
  state: { message: 'Duplicate charge, please connect me to a person.' },
  questions,
}

test('one generic state supports configurable choice, ordinal score and boolean with explicit unknown', () => {
  const bound = decisionRequest(request)
  const result = decisionAnswers(
    { route: 'billing', urgency: 1, needs_human: null },
    bound.questions,
  )
  assert.deepEqual(result, {
    route: { type: 'choice', status: 'answered', value: 'billing' },
    urgency: { type: 'score', status: 'answered', value: 1 },
    needs_human: { type: 'boolean', status: 'unknown', value: null },
  })
  assert.ok(Object.isFrozen(bound.questions))
  const other = decisionRequest({
    state: ['a patch', 'changed code'],
    questions: {
      effort: {
        type: 'choice',
        instructions: 'How extensive is the change?',
        criteria: { small: 'A local edit', broad: 'Many modules' },
      },
    },
  })
  assert.equal(decisionAnswers({ effort: 'small' }, other.questions).effort.value, 'small')
})

test('malformed questions are refused instead of dispatched or converted to a default judgment', () => {
  for (const input of [
    { state: request.state, questions: {} },
    {
      state: request.state,
      questions: { x: { type: 'score', instructions: 'Rate it', criteria: ['only one level'] } },
    },
    {
      state: request.state,
      questions: { x: { type: 'confidence', instructions: 'Guess confidence' } },
    },
    { state: request.state, questions: { x: { type: 'boolean', instructions: '' } } },
    { state: 'x'.repeat(65537), questions },
    { state: undefined, questions },
    { ...request, budget: 100 },
  ])
    assert.throws(() => decisionRequest(input), { code: 'DUO_DECISION_INPUT_INVALID' })
})

test('every answer binds to its question and allowed values; no silent coercion or invented confidence', () => {
  for (const output of [
    { route: 'other', urgency: 1, needs_human: true },
    { route: 'billing', urgency: 9, needs_human: true },
    { route: 'billing', urgency: 1.5, needs_human: true },
    { route: 'billing', urgency: 1, needs_human: 'yes' },
    { route: 'billing', urgency: 1 },
    { route: 'billing', urgency: 1, needs_human: true, confidence: 0.9 },
  ])
    assert.throws(() => decisionAnswers(output, questions), { code: 'DUO_DECISION_OUTPUT_INVALID' })
})
