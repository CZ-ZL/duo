import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

// The package ships the calling-agent guides; the repository root keeps the
// canonical copies. Drift between them would silently strand package-only
// readers on stale instructions.
const pair=names=>{
 const root=new URL('../../'+names[0],import.meta.url)
 const packed=new URL('../'+names[1],import.meta.url)
 return {root,packed}
}
test('shipped agent guides stay byte-identical to the canonical repository copies',()=>{
 for(const names of [['AGENT_GUIDE.md','AGENT_GUIDE.md'],['AGENT_REFERENCE.md','AGENT_REFERENCE.md']]){
  const {root,packed}=pair(names)
  assert.equal(readFileSync(packed,'utf8'),readFileSync(root,'utf8'),names[0]+' drifted between repository root and dsh-plugin/')
 }
 const manifest=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'))
 for(const f of ['AGENT_GUIDE.md','AGENT_REFERENCE.md'])assert.ok(manifest.files.includes(f),f+' missing from package files')
})
