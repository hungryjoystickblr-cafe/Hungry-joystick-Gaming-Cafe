import assert from 'node:assert/strict';
import {initial} from '../client/model.js';
import {upgradePrices} from '../client/pricing.js';
import {applyOperation} from '../server/operations.js';
import {diff} from '../server/store.js';
const s=upgradePrices(initial());s.active=[];s.invoices=[];s.completed=[];s.stations=Array.from({length:200},(_,i)=>({id:'pc-'+i,name:'PC '+i,type:'PC',rate:100,weekendRate:150}));
const start=Date.parse('2026-10-14T06:00:00Z'),t=performance.now();
for(let i=0;i<200;i++)applyOperation(s,{op:'start',station:'pc-'+i,name:'Load fixture '+i,phone:'',minutes:null},'test',start);
assert.equal(s.active.length,200);assert.throws(()=>applyOperation(s,{op:'start',station:'pc-1',name:'Duplicate',phone:'',minutes:null},'test',start));
const ids=s.active.map(x=>x.id);
for(const id of ids){const before=structuredClone(s);applyOperation(s,{op:'pause',id},'test',start+30*60000);const patch=diff(before,s);assert.deepEqual(Object.keys(patch),['active']);assert.equal(patch.active.upsert.length,1);applyOperation(s,{op:'resume',id},'test',start+40*60000);applyOperation(s,{op:'stop',id},'test',start+70*60000);}
assert.equal(s.active.length,0);assert.equal(s.completed!.length,200);assert(s.completed!.every(x=>x.gaming===100));
for(let i=0;i<200;i++)applyOperation(s,{op:'combine',ids:[ids[i]],name:'Customer '+i,phone:'',payment:'Split',cashAmount:40,upiAmount:60},'test',start+70*60000);
assert.equal(s.completed!.length,0);assert.equal(s.invoices.length,200);assert.equal(s.invoices.reduce((n,x)=>n+x.total!,0),20000);
assert.throws(()=>applyOperation(s,{op:'combine',ids:[ids[0]],name:'Duplicate',phone:'',payment:'Cash'},'test',start));
console.log('PASS: 200 customer lifecycle fixtures, pause-excluded billing, split payments, duplicate billing rejection, and single-record patches.');console.log('Local computation only, not network or database load testing. Elapsed ms:',Math.round(performance.now()-t));

const historical=JSON.stringify(s.invoices);const originalCount=s.stations.length;
applyOperation(s,{op:'deleteStation',id:'pc-0'},'test');assert.equal(s.stations.length,originalCount-1);assert.equal(JSON.stringify(s.invoices),historical);assert.throws(()=>applyOperation(s,{op:'deleteStation',id:'pc-0'},'test'));
applyOperation(s,{op:'start',station:'pc-1',name:'Protected',phone:'',minutes:null},'test',start);
assert.throws(()=>applyOperation(s,{op:'deleteStation',id:'pc-1'},'test'));
applyOperation(s,{op:'pause',id:s.active[0].id},'test',start+1000);
assert.throws(()=>applyOperation(s,{op:'deleteStation',id:'pc-1'},'test'));
console.log('PASS: station deletion preserves invoices and rejects active, paused and missing stations.');
