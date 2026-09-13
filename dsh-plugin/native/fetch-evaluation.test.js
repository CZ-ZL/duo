import test from 'node:test'
import assert from 'node:assert/strict'
import {scoreAnswer} from '../../examples/native/fetch-config-evaluation.js'
const body='export interface Config {\n  limit?: number\n}\n',tasks=[{id:'q',expected:{type:'number',quote:'limit?: number',endChar:40}}]
const good=JSON.stringify({q:{type:'number',quote:'limit?: number'}})
test('exact evaluator distinguishes correct, wrong and unsupported answers',()=>{
 assert.equal(scoreAnswer(good,tasks,body).passed,1)
 assert.equal(scoreAnswer(JSON.stringify({q:{type:'string',quote:'limit?: number'}}),tasks,body).passed,0)
 assert.equal(scoreAnswer(good,tasks,body.slice(0,20)).passed,0)
 assert.equal(scoreAnswer(JSON.stringify({q:{type:'UNKNOWN',quote:''}}),tasks,body).status,'VALID')
})
test('exact evaluator rejects duplicate keys and extra narrative without partial credit',()=>{
 assert.equal(scoreAnswer('{"q":{"type":"number","type":"number","quote":"limit?: number"}}',tasks,body).status,'INVALID_OUTPUT')
 assert.equal(scoreAnswer(good+' This is correct.',tasks,body).status,'INVALID_OUTPUT')
 assert.equal(scoreAnswer('{"q":{"type":"number","quote":"limit?: number","extra":1}}',tasks,body).status,'INVALID_OUTPUT')
})
