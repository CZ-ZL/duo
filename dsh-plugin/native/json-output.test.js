import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Extensions from '@deepseek-ai/dsh-deepseek-llm-api-extensions'
import { DeepSeekAdapter } from '@deepseek-ai/dsh-llm-deepseek'
import * as JsonOutput from './json-output.js'

test('DSH preserves tool-shaped SSE content as text even when JSON mode was accepted', async (t) => {
  // Synthetic wire input matching the observed Caller blocks, not a claim that
  // raw provider SSE was captured or that JSON mode caused the real failure.
  const ctx = new Context(),
    root = mkdtempSync(join(tmpdir(), 'duo-tool-text-'))
  const registry = await ctx.plugin(Extensions),
    plugin = await ctx.plugin(JsonOutput, { artifactRoot: root, includeCallerSessions: true })
  const oldFetch = globalThis.fetch,
    toolText =
      '<｜｜DSML｜｜tool_calls><｜｜DSML｜｜invoke name="cordis_run">text only</｜｜DSML｜｜invoke></｜｜DSML｜｜tool_calls>'
  let requests = 0
  t.after(async () => {
    globalThis.fetch = oldFetch
    await plugin.dispose()
    await registry.dispose()
  })
  globalThis.fetch = async (url, options) => {
    requests++
    assert.equal(url, 'https://offline.invalid/chat/completions')
    const body = JSON.parse(options.body)
    assert.deepEqual(body.response_format, { type: 'json_object' })
    assert.equal(body.tools[0].function.name, 'cordis_run')
    const events = [
      { choices: [{ delta: { content: toolText }, finish_reason: 'stop' }] },
      {
        choices: [],
        usage: {
          prompt_tokens: 14433,
          prompt_cache_hit_tokens: 12544,
          completion_tokens: 227,
          total_tokens: 14660,
        },
      },
    ]
    return new Response(
      events.map((e) => 'data: ' + JSON.stringify(e) + '\n\n').join('') + 'data: [DONE]\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    )
  }
  const adapter = new DeepSeekAdapter({
    options: () => ({
      baseURL: 'https://offline.invalid',
      defaults: { thinking: 'disabled' },
      models: [],
      maxTokens: 2048,
      streamIdleTimeoutMs: 5000,
    }),
    resolveApiKey: async () => 'fake-test-only',
    resolveUserId: () => 'offline-test',
    prepareExtensions: (r) => ctx.deepseekLlmApiExtensions.prepare(r),
  })
  const chunks = []
  for await (const c of adapter.stream({
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    sessionId: 'duo-caller-11111111-1111-4111-8111-111111111111',
    maxTokens: 2048,
    system: 'Use native tools; return the final report as JSON.',
    messages: [],
    tools: [
      {
        name: 'cordis_run',
        description: 'Run an authorized plugin',
        parameters: { type: 'object', properties: {} },
      },
    ],
    signal: new AbortController().signal,
  }))
    chunks.push(c)
  assert.equal(requests, 1)
  assert.equal(
    chunks
      .filter((c) => c.type === 'text-delta')
      .map((c) => c.text)
      .join(''),
    toolText,
  )
  assert.equal(chunks.filter((c) => c.type === 'tool-call-delta').length, 0)
  assert.equal(chunks.find((c) => c.type === 'finish').reason.kind, 'stop')
  assert.deepEqual(chunks.find((c) => c.type === 'usage').usage, {
    inputTokens: 1889,
    cacheReadTokens: 12544,
    outputTokens: 227,
    totalTokens: 14660,
  })
  const receipt = JSON.parse(readFileSync(join(root, readdirSync(root)[0]), 'utf8'))
  assert.equal(receipt.accepted, true)
  assert.match(receipt.meaning, /not proof of valid JSON/)
})

test('DSH official adapter sends JSON mode through its native extension seam, with HTTP acceptance evidence', async (t) => {
  const ctx = new Context(),
    root = mkdtempSync(join(tmpdir(), 'duo-json-mode-')),
    registry = await ctx.plugin(Extensions),
    plugin = await ctx.plugin(JsonOutput, { artifactRoot: root })
  t.after(async () => {
    await plugin.dispose()
    await registry.dispose()
  })
  const outside = await ctx.deepseekLlmApiExtensions.prepare({
    sessionId: 'outside-duo',
    body: {},
    signal: new AbortController().signal,
  })
  assert.deepEqual({ ...outside.fields }, {})
  let wire = null,
    requests = 0
  const oldFetch = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    requests++
    assert.equal(url, 'https://offline.invalid/chat/completions')
    wire = JSON.parse(options.body)
    const events = [
      { choices: [{ delta: { content: '{"ok":true}' }, finish_reason: 'stop' }] },
      {
        choices: [],
        usage: {
          prompt_tokens: 100,
          prompt_cache_hit_tokens: 20,
          completion_tokens: 10,
          total_tokens: 110,
        },
      },
    ]
    return new Response(
      events.map((e) => 'data: ' + JSON.stringify(e) + '\n\n').join('') + 'data: [DONE]\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    )
  }
  t.after(() => {
    globalThis.fetch = oldFetch
  })
  const adapter = new DeepSeekAdapter({
    options: () => ({
      baseURL: 'https://offline.invalid',
      defaults: { thinking: 'disabled' },
      models: [],
      maxTokens: 64,
      streamIdleTimeoutMs: 5000,
    }),
    resolveApiKey: async () => 'fake-test-only',
    resolveUserId: () => 'offline-test',
    prepareExtensions: (r) => ctx.deepseekLlmApiExtensions.prepare(r),
  })
  const chunks = []
  for await (const c of adapter.stream({
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    sessionId: 'duo-11111111-1111-4111-8111-111111111111',
    maxTokens: 64,
    system: 'Return JSON.',
    messages: [],
    signal: new AbortController().signal,
  }))
    chunks.push(c)
  assert.equal(requests, 1)
  assert.deepEqual(wire.response_format, { type: 'json_object' })
  assert.equal(wire.max_tokens, 64)
  assert.equal(chunks.find((c) => c.type === 'finish').reason.kind, 'stop')
  assert.deepEqual(chunks.find((c) => c.type === 'usage').usage, {
    inputTokens: 80,
    cacheReadTokens: 20,
    outputTokens: 10,
    totalTokens: 110,
  })
  const files = readdirSync(root)
  assert.equal(files.length, 1)
  const receipt = JSON.parse(readFileSync(join(root, files[0]), 'utf8'))
  assert.equal(receipt.accepted, true)
  assert.equal(receipt.sessionId, 'duo-11111111-1111-4111-8111-111111111111')
  await plugin.dispose()
  const cleaned = await ctx.deepseekLlmApiExtensions.prepare({
    sessionId: receipt.sessionId,
    body: {},
    signal: new AbortController().signal,
  })
  assert.deepEqual({ ...cleaned.fields }, {})
})

test('opted-in caller JSON mode survives multiple tool/answer requests and stays scoped', async (t) => {
  const ctx = new Context(),
    root = mkdtempSync(join(tmpdir(), 'duo-caller-json-')),
    registry = await ctx.plugin(Extensions)
  const sessionId = 'duo-caller-11111111-1111-4111-8111-111111111111',
    signal = new AbortController().signal
  const legacy = await ctx.plugin(JsonOutput, { artifactRoot: root })
  assert.deepEqual(
    { ...(await ctx.deepseekLlmApiExtensions.prepare({ sessionId, body: {}, signal })).fields },
    {},
  )
  await legacy.dispose()
  const plugin = await ctx.plugin(JsonOutput, { artifactRoot: root, includeCallerSessions: true })
  t.after(async () => {
    await plugin.dispose()
    await registry.dispose()
  })
  for (const request of [
    { sessionId: 'unrelated' },
    { sessionId, purpose: 'session-title' },
    { sessionId, purpose: 'compaction' },
  ]) {
    assert.deepEqual(
      { ...(await ctx.deepseekLlmApiExtensions.prepare({ ...request, body: {}, signal })).fields },
      {},
    )
  }
  const wires = [],
    oldFetch = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://offline.invalid/chat/completions')
    wires.push(JSON.parse(options.body))
    const first = wires.length === 1
    const delta = first
      ? {
          tool_calls: [
            {
              index: 0,
              id: 'discover-1',
              type: 'function',
              function: { name: 'dualloop_discover', arguments: '{}' },
            },
          ],
        }
      : { content: '{"ok":true}' }
    const events = [
      { choices: [{ delta, finish_reason: first ? 'tool_calls' : 'stop' }] },
      {
        choices: [],
        usage: {
          prompt_tokens: 100,
          prompt_cache_hit_tokens: 20,
          completion_tokens: 10,
          total_tokens: 110,
        },
      },
    ]
    return new Response(
      events.map((e) => 'data: ' + JSON.stringify(e) + '\n\n').join('') + 'data: [DONE]\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    )
  }
  t.after(() => {
    globalThis.fetch = oldFetch
  })
  const adapter = new DeepSeekAdapter({
    options: () => ({
      baseURL: 'https://offline.invalid',
      defaults: { thinking: 'disabled' },
      models: [],
      maxTokens: 64,
      streamIdleTimeoutMs: 5000,
    }),
    resolveApiKey: async () => 'fake-test-only',
    resolveUserId: () => 'offline-test',
    prepareExtensions: (r) => ctx.deepseekLlmApiExtensions.prepare(r),
  })
  const finishes = []
  for (let i = 0; i < 2; i++) {
    const chunks = []
    for await (const c of adapter.stream({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      sessionId,
      maxTokens: 64,
      system: 'Return JSON; use the inspection tool.',
      messages: [],
      tools: [
        {
          name: 'dualloop_discover',
          description: 'Inspect capabilities',
          parameters: { type: 'object', properties: {} },
        },
      ],
      signal,
    }))
      chunks.push(c)
    finishes.push(chunks.find((c) => c.type === 'finish').reason.kind)
  }
  assert.deepEqual(finishes, ['tool-calls', 'stop'])
  assert.equal(wires.length, 2)
  assert.ok(wires.every((w) => w.response_format?.type === 'json_object'))
  assert.ok(
    wires.every((w) => w.tools[0].function.name === 'dualloop_discover' && w.max_tokens === 64),
  )
  const files = readdirSync(root).sort(),
    receipts = files.map((f) => JSON.parse(readFileSync(join(root, f), 'utf8')))
  assert.equal(files.length, 2)
  assert.deepEqual(
    receipts.map((r) => r.requestIndex),
    [1, 2],
  )
  assert.ok(
    receipts.every(
      (r) => r.accepted && r.sessionId === sessionId && r.meaning.includes('not proof'),
    ),
  )
  await plugin.dispose()
  assert.deepEqual(
    { ...(await ctx.deepseekLlmApiExtensions.prepare({ sessionId, body: {}, signal })).fields },
    {},
  )
})
