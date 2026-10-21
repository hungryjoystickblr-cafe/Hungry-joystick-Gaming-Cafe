import type {Station,Food,State} from './model';
export const indiaParts=(now:number)=>{const p=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Kolkata',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);return Object.fromEntries(p.map(x=>[x.type,x.value]));};
export const weekend=(now:number)=>['Fri','Sat','Sun'].includes(indiaParts(now).weekday);
export const rateFor=(s:Station,now:number)=>weekend(now)?s.weekendRate??s.rate:s.rate;
export const controllerRateFor=(s:Station)=>s.controllerRate??(s.type==='PC'?50:s.type==='PS5'?100:undefined);
export const typeRates:Record<string,[number,number]>={PC:[100,150],PS5:[200,250],Pool:[250,300],'Private room':[1000,1200]};
export type Offer={id:string;name:string;price:number;minutes:number;controllers:number;includes:string};
export function offersFor(st:Station,now:number):Offer[]{const w=weekend(now),parts=indiaParts(now),hour=Number(parts.hour);const happy=!w&&hour>=11&&hour<16;const plans:Offer[]=[];
if(st.type==='PC'){plans.push({id:'pc-coke',name:'PC 3 hours + Coke (single)',price:w?369:269,minutes:180,controllers:0,includes:'1 Coke'});if(happy)plans.push({id:'pc-happy',name:'Happy hours · PC + Thums Up (single)',price:169,minutes:120,controllers:0,includes:'Thums Up · 1+1 hour'});}
if(st.type==='PS5')plans.push({id:'ps5-coke',name:'PS5 2 hours + Coke (double)',price:w?699:599,minutes:120,controllers:1,includes:'Coke for double-player combo · 1 extra controller'});
if(happy&&(st.type==='PS5'||st.type==='Xbox'&&controllerRateFor(st)!==undefined))plans.push({id:'console-happy',name:'Happy hours · PS5/Xbox + Coke (double)',price:448,minutes:120,controllers:1,includes:'Coke · 1 extra controller · 1+1 hour'});
return plans;}
const products:[string,number,string][]=[
...['French Fries','Veg Nuggets','Garlic Bread','Mexican Nachos','Veg Maggi','Indian Dhokla'].map(n=>[n,99,'Snacks'] as [string,number,string]),
['Veg Burger',109,'Snacks'],['Veg Grill Sandwich',109,'Snacks'],['Veg Hakka Noodles',129,'Snacks'],['Veg Pizza',199,'Snacks'],['Veg Pasta',199,'Snacks'],['French Toast Icecream',199,'Snacks'],
['Combo 1 · Veg Burger + French Fries + Coke',199,'Food combos'],['Combo 2 · Veg Grill Sandwich + Chips + Cold Coffee',199,'Food combos'],['Combo 3 · White Sauce Pasta + Garlic Bread + Mocktail',249,'Food combos'],['Combo 4 · Veg Farmhouse Pizza + Diet Coke',249,'Food combos'],['Combo 5 · Veg Hakka Noodles + Paneer Chilli + Cooler',249,'Food combos'],
...['Green Apple','Guava Blast','Pineapple Punch','Mango Mania','Litchi Love','Orangina','Kiwi Kick','Blueberry Pop','Blue Lagoon','Black Currant Cooler'].map(n=>[n,99,'Mocktails'] as [string,number,string]),
...['Chocolate Shake','Caramel Shake','Butterscotch Shake','Classic Cold Coffee','Oreo Cold Coffee','Vanilla Icecream Cold Coffee'].map(n=>[n,129,'Shakes & coffee'] as [string,number,string]),
...['Coke','Diet Coke','Sprite','Fanta','Thums Up','Limca'].flatMap(n=>[69,79].map(p=>[n+' · ₹'+p+' can',p,'Soft drinks'] as [string,number,string])),
['Red Bull',129,'Energy & water'],['Monster',129,'Energy & water'],['Mineral Water 500 ml',10,'Energy & water']];
export const suppliedMenu=():Food[]=>products.map(([name,price,category],i)=>({id:'menu-20261012-'+i,name,price,category}));
export const membershipPrices=[['10-hour PC gaming (single)','₹699','10 days · individual'],['30-hour PC gaming (single)','₹1,999','30 days · individual'],['100-hour PC gaming (single)','₹5,999','100 days · individual'],['Wallet credit ₹3,000','₹1,999','30/10 days · single/multi'],['Wallet credit ₹5,000','₹3,499','60/20 days · single/multi'],['Wallet credit ₹10,000','₹5,999','90/30 days · single/multi']];
export function upgradePrices(state:State):State{if(state.priceVersion===1)return state;const stations=state.stations.map(st=>typeRates[st.type]?{...st,rate:typeRates[st.type][0],weekendRate:typeRates[st.type][1],controllerRate:controllerRateFor(st)}:st);
for(const [id,name,type] of [['ps5-1','PS5 01','PS5'],['private-1','PS5 Private Room','Private room'],['pool-1','Pool Table 01','Pool']]){if(!stations.some(s=>s.type===type))stations.push({id,name,type,rate:typeRates[type][0],weekendRate:typeRates[type][1]});}
const menu=[...state.menu];for(const f of suppliedMenu()){const existing=menu.find(x=>x.name.toLowerCase()===f.name.toLowerCase());if(existing){existing.price=f.price;existing.category=f.category;}else menu.push(f);}
return {...state,stations,menu,priceVersion:1};}
