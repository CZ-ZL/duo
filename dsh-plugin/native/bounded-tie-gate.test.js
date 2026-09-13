import test from 'node:test'
import assert from 'node:assert/strict'
import {Context} from '@deepseek-ai/cordis'
import BoundedTieGate from './bounded-tie-gate.js'

test('optional gate admits bounded genuine ties, after improvements, with no invalid or worse evidence',async t=>{
 const ctx=new Context(),fiber=await ctx.plugin(BoundedTieGate,{maxTies:1});t.after(()=>fiber.dispose())
 const comparison={ranking:['better','baseline','tie1','tie2','worse','bad'],scores:{better:2,baseline:1,tie1:1,tie2:.995,worse:.5,bad:1},verdicts:{better:'better',baseline:'not_better',tie1:'not_better',tie2:'not_better',worse:'not_better',bad:'constraint_violation'}}
 const ids=['better','tie1','tie2','worse','bad'],limits={topK:4,remaining:4,incumbentId:'baseline',epsilon:.01}
 assert.deepEqual(ctx.duoGate.select(comparison,ids,limits),['better','tie1'])
 assert.deepEqual(ctx.duoGate.select(comparison,ids,{...limits,remaining:1}),['better'])
 assert.deepEqual(ctx.duoGate.select(comparison,ids,{...limits,remaining:0}),[])
 assert.throws(()=>ctx.duoGate.select(comparison,ids,{...limits,incumbentId:'absent'}),{code:'DUO_COMPARISON_INVALID'})
 assert.equal(ctx.duoGate.describe().maxTies,1)
})
