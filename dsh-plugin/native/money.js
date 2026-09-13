import {fail} from './definitions.js'

// Existing v1 contracts without currency retain USD semantics. Never convert or
// relabel retained ledgers. New CNY contracts carry explicit yuan field names.
export function moneyFields(value) {
 const currency=value?.currency??'USD'
 if(!['USD','CNY'].includes(currency))fail('DUO_CURRENCY_MISMATCH','Only explicit CNY or legacy USD accounting is supported')
 const suffix=currency==='CNY'?'Cny':'Usd',other=currency==='CNY'?'Usd':'Cny'
 const stems=['maxCost','reservation','cost','knownCost','reservedCost','input','cacheRead','output']
 if(stems.some(k=>value?.[k+other+( ['input','cacheRead','output'].includes(k)?'PerMillion':'')]!==undefined))
  fail('DUO_CURRENCY_MISMATCH','Amounts from different currencies cannot share an accounting record')
 return {currency,cap:'maxCost'+suffix,reservation:'reservation'+suffix,cost:'cost'+suffix,
  known:'knownCost'+suffix,reserved:'reservedCost'+suffix,
  input:'input'+suffix+'PerMillion',cache:'cacheRead'+suffix+'PerMillion',output:'output'+suffix+'PerMillion'}
}

// Check accounting objects only. Arbitrary output text/artifacts may legitimately
// discuss other currencies and are not a source of settled monetary amounts.
export function assertMoneyEvidence(value,currency) {
 if(value==null)return
 if(typeof value!=='object'||Array.isArray(value)||moneyFields({currency,...value}).currency!==currency)
  fail('DUO_CURRENCY_MISMATCH','Accounting evidence currency differs from its ledger')
 for(const key of ['costEvidence','pricing','frozenPricing'])if(value[key]!=null)assertMoneyEvidence(value[key],currency)
}
