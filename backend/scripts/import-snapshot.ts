// Run only with a verified, complete owner export and the old application paused for cutover.
import {readFile} from 'node:fs/promises';
import {database,arrays,initialize} from '../server/store.js';
if(!process.argv[2])throw Error('Pass the path to a complete JSON export {state, revision}.');
const source=JSON.parse(await readFile(process.argv[2],'utf8'));
if(!source.state||!Number.isInteger(source.revision))throw Error('Invalid export');
for(const key of arrays){if(!Array.isArray(source.state[key]??[]))throw Error('Invalid collection: '+key);const rows=source.state[key]??[];if(rows.some((r:any)=>typeof r.id!=='string')||new Set(rows.map((r:any)=>r.id)).size!==rows.length)throw Error('Invalid or duplicate IDs: '+key);}
await initialize();const {db,client}=await database();const session=client.startSession();try{await session.withTransaction(async()=>{const old=await db.collection('settings').findOne({_id:'cafe' as any},{session});if(old?.revision!==0)throw Error('Target has business activity; refusing overwrite.');for(const key of arrays){await db.collection(key).deleteMany({},{session});if(source.state[key]?.length)await db.collection(key).insertMany(source.state[key],{session});}const data={...source.state};for(const key of arrays)delete data[key];await db.collection('settings').updateOne({_id:'cafe' as any},{$set:{data,revision:source.revision,migratedAt:new Date()}},{session});});console.log('Import committed. Verify counts, totals, membership balances and active session times before opening the new app.');}finally{await session.endSession();await client.close();}
