import test from 'node:test'
import assert from 'node:assert/strict'
import { priceUsage } from '../../native/model-call.js'

const cny = {
  id: 'exact-decimal-control',
  currency: 'CNY',
  inputCnyPerMillion: 1,
  cacheReadCnyPerMillion: 0.02,
  outputCnyPerMillion: 4,
}
const usage = (input, cache, output) => ({
  inputTokens: input,
  cacheReadTokens: cache,
  outputTokens: output,
  totalTokens: input + cache + output,
})

test('retained request2 does not acquire an extra nanoyuan from binary floating point', () => {
  assert.equal(priceUsage(usage(682, 1792, 130), cny), 0.00123784)
})

test('recorded four-request usage agrees with exact decimal tariffs', () => {
  for (const [input, cache, output, expected] of [
    [249, 1664, 167, 0.00095028],
    [682, 1792, 130, 0.00123784],
    [3206, 2560, 214, 0.0041132],
    [1341, 5888, 216, 0.00232276],
  ])
    assert.equal(priceUsage(usage(input, cache, output), cny), expected)
})

test('nanoyuan ceiling is applied once after summing all token classes', () => {
  const pricing = {
    ...cny,
    inputCnyPerMillion: 0.0004,
    cacheReadCnyPerMillion: 0.0004,
    outputCnyPerMillion: 0.0004,
  }
  assert.equal(priceUsage(usage(1, 1, 1), pricing), 2e-9)
  assert.equal(priceUsage(usage(1, 0, 0), pricing), 1e-9)
  assert.equal(priceUsage(usage(0, 0, 0), pricing), 0)
})

test('scientific decimal tariffs retain the conservative ceiling', () => {
  assert.equal(priceUsage(usage(1, 0, 0), { ...cny, inputCnyPerMillion: 1e-7 }), 1e-9)
  assert.equal(priceUsage(usage(10_000_000, 0, 0), { ...cny, inputCnyPerMillion: 1e-7 }), 0.000001)
})

test('decimal CNY tariff grid equals an independent integer-token calculation', () => {
  for (let i = 0; i < 512; i++) {
    const input = i * 17,
      cache = i * 31,
      output = i % 101
    const nano = BigInt(input) * 1000n + BigInt(cache) * 20n + BigInt(output) * 4000n
    assert.equal(priceUsage(usage(input, cache, output), cny), Number(nano) / 1e9)
  }
})

test('legacy USD retains its currency and exact tariff semantics', () => {
  const pricing = {
    id: 'legacy-test',
    inputUsdPerMillion: 1,
    cacheReadUsdPerMillion: 0.1,
    outputUsdPerMillion: 2,
  }
  assert.equal(priceUsage(usage(80, 20, 10), pricing), 0.000102)
})

test('unknown usage and invalid rates are never converted to a known fee', () => {
  assert.equal(priceUsage(null, cny), null)
  assert.equal(priceUsage({ ...usage(1, 2, 3), totalTokens: 999 }, cny), null)
  assert.equal(priceUsage(usage(1, 2, 3), { ...cny, inputCnyPerMillion: NaN }), null)
  assert.equal(priceUsage(usage(1, 2, 3), { ...cny, inputCnyPerMillion: -1 }), null)
})

test('amounts outside exact ledger range remain unaccountable', () => {
  assert.equal(priceUsage(usage(1, 0, 0), { ...cny, inputCnyPerMillion: 1e300 }), null)
})
