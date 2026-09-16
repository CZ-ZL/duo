import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const cli = resolve('dsh-plugin/bin/duo.mjs')
const dsh = process.env.DUO_DSH_PACKAGE
function prepare(extra = []) {
  const dir = mkdtempSync(join(tmpdir(), 'duo-starter-test-'))
  const root = join(dir, 'work')
  const model = join(dir, 'model.json')
  writeFileSync(
    model,
    JSON.stringify({
      provider: 'deepseek-official',
      model: 'deepseek-flash',
      pricing: {
        id: 'test-tariff',
        currency: 'CNY',
        inputCnyPerMillion: 2,
        cacheReadCnyPerMillion: 0.04,
        outputCnyPerMillion: 8,
        verifiedDate: new Date().toISOString().slice(0, 10),
        schedule: 'deepseek-weekday-utc-v1',
      },
    }),
  )
  const result = spawnSync(
    process.execPath,
    [
      cli,
      'init',
      '--root',
      root,
      '--dsh-package',
      dsh,
      '--example',
      'grounded-qa',
      '--model-config',
      model,
      ...extra,
    ],
    { encoding: 'utf8', env: { PATH: process.env.PATH } },
  )
  return { root, result }
}

test(
  'real starter prepares matching public providers without granting paid authority',
  { skip: !dsh },
  () => {
    const { root, result } = prepare()
    assert.equal(result.status, 0, result.stderr)
    const spec = JSON.parse(readFileSync(join(root, 'experiment.json')))
    assert.equal(spec.preset, 'optimize-basic')
    assert.equal(spec.generations, 1)
    assert.equal(spec.permissions.paid, false)
    assert.equal(spec.budget.maxCostCny, 0)
    assert.equal(spec.slow, undefined)
    assert.equal(spec.final, undefined)
    const rows = JSON.parse(
      readFileSync(join(root, 'dsh-home/profiles/duo-product/cordis.patch.yml')),
    )
    const names = rows.flatMap((r) => r.insert ?? []).map((r) => r.name)
    for (const path of ['model-generator', 'model-executor'])
      assert.ok(names.includes('@dual-loop/dsh-plugin/' + path))
    assert.ok(!names.includes('@dual-loop/dsh-plugin/examples/local-providers'))
    assert.ok(existsSync(join(root, 'dataset.json')))
  },
)

test('starter requires explicit per-call paid consent before launching DSH', { skip: !dsh }, () => {
  const { root, result } = prepare(['--allow-paid', '--max-cost-cny', '0.5'])
  assert.equal(result.status, 0, result.stderr)
  const before = readFileSync(join(root, 'target.txt'))
  const call = spawnSync(
    process.execPath,
    [
      cli,
      'call',
      '--root',
      root,
      '--tool',
      'dualloop_run',
      '--args',
      '{"planDigest":"not-a-grant"}',
    ],
    { encoding: 'utf8', env: { PATH: process.env.PATH } },
  )
  assert.equal(call.status, 1)
  const error = JSON.parse(call.stderr)
  assert.equal(error.code, 'DUO_STARTER_AUTHORIZATION_REQUIRED')
  assert.equal(error.costState, 'NO_WORK_DISPATCHED_BY_THIS_CALL')
  assert.equal(existsSync(join(root, 'calls')), false)
  assert.deepEqual(readFileSync(join(root, 'target.txt')), before)
})

test(
  'an absent credential stops an authorized starter before work and names the action',
  { skip: !dsh },
  () => {
    const { root, result } = prepare(['--allow-paid', '--max-cost-cny', '0.5'])
    assert.equal(result.status, 0, result.stderr)
    const call = spawnSync(
      process.execPath,
      [
        cli,
        'call',
        '--root',
        root,
        '--tool',
        'dualloop_run',
        '--allow-paid',
        '--args',
        '{"planDigest":"not-a-grant"}',
      ],
      { encoding: 'utf8', env: { PATH: process.env.PATH } },
    )
    const error = JSON.parse(call.stderr)
    assert.equal(error.code, 'DUO_STARTER_CREDENTIAL_REQUIRED')
    assert.match(error.nextAction, /DEEPSEEK_API_KEY/)
    assert.equal(existsSync(join(root, 'calls')), false)
  },
)

test(
  'unfunded starter planning identifies missing authority without dispatch or unknown cost',
  { skip: !dsh },
  () => {
    const { root, result } = prepare()
    assert.equal(result.status, 0, result.stderr)
    const call = spawnSync(
      process.execPath,
      [cli, 'call', '--root', root, '--tool', 'dualloop_plan'],
      { encoding: 'utf8', env: { PATH: process.env.PATH } },
    )
    assert.equal(call.status, 1)
    const error = JSON.parse(call.stderr)
    assert.equal(error.code, 'DUO_STARTER_AUTHORIZATION_REQUIRED')
    assert.equal(error.costState, 'NO_WORK_DISPATCHED_BY_THIS_CALL')
    assert.match(error.nextAction, /experiment.json/)
    assert.equal(existsSync(join(root, 'calls')), false)
  },
)
