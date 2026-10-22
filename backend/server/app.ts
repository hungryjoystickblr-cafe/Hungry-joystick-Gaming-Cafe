import express from 'express';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {owner,signIn,signOut,passwordFields} from './auth.js';
import {mutate,snapshot,importBackup,database,initialize} from './store.js';
import {registerSystemHealth} from './system-health.js';
const app=express();
app.disable('x-powered-by');
app.use(express.json({limit:'10mb'}));
app.use((req,res,next)=>{
  res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');res.set('Referrer-Policy','same-origin');
  if(['POST','PATCH','PUT','DELETE'].includes(req.method)){
    // Restricted machine-to-machine route uses a separate Bearer token, not browser cookies.
    if(req.method==='POST'&&req.path==='/api/system-health/report'){
      if(!req.is('application/json')){res.status(415).json({error:'JSON required.'});return;}
      next();return;
    }
    const origin=req.get('origin');
    if(!origin){res.status(403).json({error:'Request origin is required.'});return;}
    try {
      const parsedOrigin = new URL(origin);
      const configuredFrontend = process.env.FRONTEND_ORIGIN?.trim();
      // Exact public production frontend origin; no wildcard or CORS bypass.
      const productionFrontend = 'https://hungry-joystick-frontend.vercel.app';
      // Keep localhost / same-host requests working, including local development.
      const sameHost = parsedOrigin.host === req.get('host');
      // The deployed frontend proxies /api/* to this Vercel backend.
      const trustedFrontend = parsedOrigin.protocol === 'https:' &&
        (parsedOrigin.origin === productionFrontend ||
         (configuredFrontend !== undefined && parsedOrigin.origin === configuredFrontend));
      if (!sameHost && !trustedFrontend) {
        res.status(403).json({error:'Request origin is not allowed.'});
        return;
      }
    } catch {
      res.status(403).json({error:'Invalid request origin.'});
      return;
    }
    if(!req.is('application/json')){res.status(415).json({error:'JSON required.'});return;}
  }
  next();
});
app.get('/api/health',(_req,res)=>res.json({ok:true,stack:'MERN'}));
app.get('/api/auth/me',async(req,res)=>{const user=await owner(req);res.status(user?200:401).json({owner:user});});
app.post('/api/auth/login',(req,res)=>signIn(req,res));
app.post('/api/auth/staff-login',(req,res)=>signIn(req,res));
app.post('/api/auth/setup',(req,res)=>signIn(req,res,true));
app.get('/api/auth/logout',signOut);
registerSystemHealth(app);
app.use('/api/manage',async(req,res,next)=>{const user=await owner(req);if(!user){res.status(401).json({error:'Please sign in.'});return;}res.locals.user=user;next();});
app.get('/api/migration/status',async(req,res)=>{if((await owner(req))?.role!=='owner'){res.status(403).json({error:'Owner access required.'});return;}const {db}=await database();const record=await db.collection('settings').findOne({_id:'cafe' as any});res.json({ready:!!record?.migratedAt,counts:record?.migrationCounts});});
app.post('/api/migration/import',async(req,res)=>{if((await owner(req))?.role!=='owner'){res.status(403).json({error:'Owner access required.'});return;}res.json(await importBackup(req.body));});
app.get('/api/manage',async(req,res)=>{const known=req.query.revision===undefined?undefined:Number(req.query.revision);const data=await snapshot(known);if(!data){res.status(204).end();return;}if(res.locals.user.role==='staff'){const value=data as any;if(value.state)delete value.state.expenses;if(value.patch)delete value.patch.expenses;}res.json(data);});
const staffOperations=new Set(['customer','start','pause','resume','stop','extend','food','foods','end','combine','membership','membershipPaid']);
app.post('/api/manage',async(req,res)=>{const user=res.locals.user;if(user.role==='staff'&&!staffOperations.has(String(req.body?.op))){res.status(403).json({error:'Only the owner can perform this action.'});return;}const {db}=await database();const settings=await db.collection('settings').findOne({_id:'cafe' as any});if(!settings?.migratedAt){res.status(503).json({error:'Import your complete café backup from Owner profile before starting operations.'});return;}const key=z.string().uuid().parse(req.get('Idempotency-Key'));const revision=z.number().int().nonnegative().parse(req.body.revision);res.json(await mutate({...req.body,revision},user.role==='staff'?'staff:'+user.username:user.email,key));});
app.use('/api/staff',async(req,res,next)=>{const user=await owner(req);if(!user){res.status(401).json({error:'Please sign in.'});return;}if(user.role!=='owner'){res.status(403).json({error:'Owner access required.'});return;}next();});
const username=z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_.-]{2,31}$/);
const createStaff=z.object({name:z.string().trim().min(1).max(100),username,password:z.string().min(12).max(200),enabled:z.boolean().optional()}).strict();
const updateStaff=z.object({name:z.string().trim().min(1).max(100).optional(),username:username.optional(),password:z.string().min(12).max(200).optional(),enabled:z.boolean().optional()}).strict().refine(v=>Object.keys(v).length>0);
app.get('/api/staff',async(_req,res)=>{const {db}=await database();await initialize();const staff=await db.collection('staff').find({},{projection:{_id:0,id:1,name:1,username:1,enabled:1,createdAt:1}}).sort({createdAt:-1}).toArray();res.json({staff});});
app.get('/api/staff/activity',async(_req,res)=>{const {db}=await database();const activity=await db.collection('activityLog').find({}).sort({at:-1}).limit(200).project({_id:0}).toArray();res.json({activity});});
app.post('/api/staff',async(req,res)=>{const values=createStaff.parse(req.body);await initialize();const {db}=await database();const fields=await passwordFields(values.password);const row={id:randomUUID(),name:values.name,username:values.username,enabled:values.enabled??true,...fields,createdAt:new Date()};try{await db.collection('staff').insertOne(row);}catch(e:any){if(e?.code===11000){res.status(409).json({error:'Username already exists.'});return;}throw e;}await db.collection('activityLog').insertOne({at:new Date(),actor:'owner',action:'staffCreated',recordId:row.id});res.status(201).json({ok:true});});
app.patch('/api/staff/:id',async(req,res)=>{const values=updateStaff.parse(req.body);const {db}=await database();const changes:any={...values};if(values.password){Object.assign(changes,await passwordFields(values.password));delete changes.password;}const result=await db.collection('staff').updateOne({id:req.params.id},{$set:changes});if(!result.matchedCount){res.status(404).json({error:'Staff account not found.'});return;}if(values.enabled===false||values.password)await db.collection('authSessions').deleteMany({staffId:req.params.id});await db.collection('activityLog').insertOne({at:new Date(),actor:'owner',action:values.password?'staffPasswordReset':'staffUpdated',recordId:req.params.id});res.json({ok:true});});
app.use((error:any,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{const status=error.status??(error instanceof z.ZodError?400:500);res.status(status).json({error:error instanceof z.ZodError?'Check the entered details.':status===500?'Server error. Check backend logs.':error.message??'Request failed.'});});
export default app;
