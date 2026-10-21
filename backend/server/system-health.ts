import {createHash,timingSafeEqual} from 'node:crypto';
import type {Express,Request,Response,NextFunction} from 'express';
import {z} from 'zod';
import {database} from './store.js';
import {owner} from './auth.js';

const schema=z.object({
  date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  backupTaskOk:z.boolean(),
  backupRanAt:z.string().datetime({offset:true}).nullable(),
  backupFile:z.string().regex(/^HungryJoystick-\d{8}-\d{6}\.archive\.gz\.age$/).nullable(),
  backupSizeBytes:z.number().int().nonnegative().nullable(),
  alertTaskOk:z.boolean(),
  alertRanAt:z.string().datetime({offset:true}).nullable(),
  issues:z.array(z.string().max(200)).max(12)
}).strict();
function equalSecret(provided:string,expected:string){
  if(!expected||!provided)return false;
  const a=createHash('sha256').update(provided).digest();
  const b=createHash('sha256').update(expected).digest();
  return timingSafeEqual(a,b);
}
function indiaDate(date:Date){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
export function registerSystemHealth(app:Express){
  // This endpoint deliberately uses a separate bearer token (not the owner cookie).
  // It is exempted from browser Origin requirements in app.ts by its exact path.
  app.post('/api/system-health/report',async(req:Request,res:Response)=>{
    const expected=process.env.HJ_BACKUP_STATUS_TOKEN||'';
    const provided=(req.get('authorization')||'').match(/^Bearer ([^\s]+)$/)?.[1]||'';
    if(!expected)return res.status(503).json({error:'Backup reporting not configured.'});
    if(!equalSecret(provided,expected))return res.status(401).json({error:'Unauthorized.'});
    const parsed=schema.safeParse(req.body);
    if(!parsed.success)return res.status(400).json({error:'Invalid status report.'});
    const row=parsed.data;
    // Prevent incorrect/future dates and old history being rewritten unexpectedly.
    const today=indiaDate(new Date());
    if(row.date!==today)return res.status(400).json({error:'Report date must be today (India time).'});
    const {db}=await database();
    await db.collection('backupHealthReports').updateOne({_id:row.date as any},{$set:{...row,receivedAt:new Date()}},{upsert:true});
    res.json({ok:true});
  });
  app.get('/api/system-health',async(req:Request,res:Response)=>{
    const user=await owner(req);
    if(!user)return res.status(401).json({error:'Please sign in.'});
    if(user.role!=='owner')return res.status(403).json({error:'Owner access required.'});
    const {db}=await database();
    await db.command({ping:1});
    const rows=await db.collection('backupHealthReports').find({}).sort({receivedAt:-1}).limit(14).toArray();
    const reports=rows.map(r=>({date:r.date,backupTaskOk:r.backupTaskOk,backupRanAt:r.backupRanAt,backupFile:r.backupFile,backupSizeBytes:r.backupSizeBytes,alertTaskOk:r.alertTaskOk,alertRanAt:r.alertRanAt,issues:r.issues,receivedAt:r.receivedAt}));
    const latest=reports[0]??null;
    const ageMs=latest?Date.now()-new Date(latest.receivedAt).getTime():null;
    res.json({database:{connected:true,checkedAt:new Date().toISOString()},reportingConfigured:!!process.env.HJ_BACKUP_STATUS_TOKEN,latest,history:reports,stale:!latest||ageMs===null||ageMs>26*3600000,schedule:{backup:'23:30 IST',alert:'23:45 IST',report:'23:50 IST'},cloudSyncVerified:false});
  });
}
