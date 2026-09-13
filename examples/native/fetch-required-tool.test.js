import test from 'node:test'
import assert from 'node:assert/strict'
import {requiredFetchField} from './fetch-required-tool.js'
const request={sessionId:'duo-owned',body:{tools:[{type:'function',function:{name:'web_fetch'}}],thinking:{type:'disabled'}}}
test('first fetch request requires the named tool; answer and generator requests stay tool-free',()=>{
 assert.deepEqual(requiredFetchField(request),{value:{type:'function',function:{name:'web_fetch'}}})
 assert.equal(requiredFetchField({...request,body:{thinking:{type:'disabled'}}}),undefined)
 assert.equal(requiredFetchField({...request,sessionId:'unrelated-caller'}),undefined)
 assert.throws(()=>requiredFetchField({...request,body:{...request.body,thinking:{type:'enabled'}}}))
})
