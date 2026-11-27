import assert from 'node:assert/strict';
import {initial,cost} from '../client/model.js';
import {upgradePrices} from '../client/pricing.js';
import {applyOperation} from '../server/operations.js';
import {diff} from '../server/store.js';

const billingFixture=(minutes:number,extra:Record<string,unknown>={})=>({id:'billing-test',station:'test',stationName:'Test station',name:'Test',phone:'',start:0,planned:null,rate:100,items:[],...extra});
const nonPoolExpected=new Map([[1,1.67],[15,25],[16,50],[30,50],[31,100],[60,100],[61,150],[90,150],[91,200]]);
for(const [minutes,expected] of nonPoolExpected){assert.equal(cost(billingFixture(minutes,{stationType:'PC'}),minutes*60000),expected,`Non-pool billing at ${minutes} minutes`);}
const weekdayPoolExpected=new Map([[1,150],[30,150],[31,250],[60,250],[61,400],[90,400],[91,550],[120,550]]);
for(const [minutes,expected] of weekdayPoolExpected){assert.equal(cost(billingFixture(minutes,{stationType:'Pool',poolHalfHourRate:150,rate:250}),minutes*60000),expected,`Weekday pool billing at ${minutes} minutes`);}
const weekendPoolExpected=new Map([[1,200],[30,200],[31,300],[60,300],[61,500],[90,500],[91,700],[120,700]]);
for(const [minutes,expected] of weekendPoolExpected){assert.equal(cost(billingFixture(minutes,{stationType:'Pool',poolHalfHourRate:200,rate:300}),minutes*60000),expected,`Weekend pool billing at ${minutes} minutes`);}
assert.equal(cost(billingFixture(196,{stationType:'PC',offer:{name:'3-hour offer',price:269,minutes:180,includes:'Coke'}}),196*60000),319,'Offer overtime rounds independently after included time');
console.log('PASS: non-pool 15/30-minute billing boundaries, weekday/weekend pool blocks through 2 hours, and offer overtime rounding.');
const legacyState=upgradePrices(initial());legacyState.completed=[];legacyState.active=[];
const legacyPc=legacyState.stations.find(x=>x.type==='PC')!;
applyOperation(legacyState,{op:'start',station:legacyPc.id,name:'Legacy PC',phone:'',minutes:null},'test',start);
delete legacyState.active[0].stationType;delete legacyState.active[0].poolHalfHourRate;
applyOperation(legacyState,{op:'stop',id:legacyState.active[0].id},'test',start+16*60000);
assert.equal(legacyState.completed[0].gaming,50,'Existing PC session uses new 30-minute rounding at checkout');
const legacyPool=upgradePrices(initial());legacyPool.completed=[];legacyPool.active=[];
const poolStation=legacyPool.stations.find(x=>x.type==='Pool')!;
applyOperation(legacyPool,{op:'start',station:poolStation.id,name:'Legacy Pool',phone:'',minutes:null},'test',start);
delete legacyPool.active[0].stationType;delete legacyPool.active[0].poolHalfHourRate;
applyOperation(legacyPool,{op:'stop',id:legacyPool.active[0].id},'test',start+31*60000);
assert.equal(legacyPool.completed[0].gaming,250,'Existing weekday pool session uses fixed one-hour price');
console.log('PASS: existing in-progress sessions receive the new pricing at checkout.');


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
const cancelState=upgradePrices(initial());cancelState.completed=[];cancelState.cancelled=[];cancelState.memberships=[{id:'member-1',name:'Member Test',phone:'9876543210',planHours:10,purchasedDate:'2026-10-14',expiryDate:'2026-10-24',expiresAt:start+10*86400000,totalMinutes:600,remainingMinutes:540,importedUsedMinutes:0,price:699,payment:'UPI',recordSale:true,createdAt:start}];
applyOperation(cancelState,{op:'start',station:cancelState.stations[0].id,name:'Walk-in test',phone:'',minutes:null},'test',start);
const activeCancel=cancelState.active[0];applyOperation(cancelState,{op:'cancel',id:activeCancel.id,reason:'Customer had to leave'},'test',start+4*60000);
assert.equal(cancelState.active.length,0);assert.equal(cancelState.cancelled.length,1);assert.equal(cancelState.cancelled[0].total,0);assert.equal(cancelState.cancelled[0].payment,'Cancelled');assert.equal(cancelState.invoices.length,0);assert.throws(()=>applyOperation(cancelState,{op:'cancel',id:activeCancel.id,reason:'Duplicate cancel'},'test',start+5*60000));
applyOperation(cancelState,{op:'start',station:cancelState.stations[0].id,name:'Member Test',phone:'9876543210',minutes:null,membershipId:'member-1'},'test',start);
const memberSession=cancelState.active[0];applyOperation(cancelState,{op:'stop',id:memberSession.id},'test',start+30*60000);
assert.equal(cancelState.memberships[0].remainingMinutes,510);
applyOperation(cancelState,{op:'cancel',id:memberSession.id,reason:'PC issue'},'test',start+31*60000);
assert.equal(cancelState.memberships[0].remainingMinutes,540);assert.equal(cancelState.completed.length,0);assert.equal(cancelState.cancelled.length,2);assert.equal(cancelState.cancelled[1].total,0);assert.equal(cancelState.invoices.length,0);
assert.throws(()=>applyOperation(cancelState,{op:'cancel',id:activeCancel.id,reason:'x'},'test',start+32*60000));
console.log('PASS: active and Billing Desk cancellation, ₹0 records, duplicate protection, station release, and membership-minute restoration.');

