import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import pg from 'pg';
import argon2 from 'argon2';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';
import { getPaymentProvider } from './payment-provider.js';

const { Pool } = pg;
const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const provider = getPaymentProvider();
const secret = new TextEncoder().encode(process.env.SESSION_SECRET || '');
const production = process.env.NODE_ENV === 'production';
if (secret.length < 32) throw new Error('SESSION_SECRET must be at least 32 bytes');
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cookieParser());
app.use('/v1', rateLimit({ windowMs: 60_000, limit: 100, standardHeaders: 'draft-8', legacyHeaders: false }));

app.post('/v1/webhooks/:provider', express.raw({ type: 'application/json', limit: '64kb' }), async (req, res, next) => {
  try {
    if (req.params.provider !== (process.env.PAYMENT_DRIVER || 'selcom')) return res.sendStatus(404);
    if (!provider.verifyWebhook(req.body, req.headers)) return res.sendStatus(401);
    const event = provider.parseWebhook(JSON.parse(req.body.toString('utf8')));
    if (event.status === 'SUCCESS') await fulfillPayment(event.transactionId, event.amount, event.currency || 'TZS', event.payload);
    res.json({ received: true });
  } catch (e) { next(e); }
});
app.use(express.json({ limit: '32kb' }));
const sendFile = name => (_req,res) => res.sendFile(fileURLToPath(new URL(`../${name}`, import.meta.url)));
app.get('/',sendFile('index.html'));
app.get('/index.html',sendFile('index.html'));
app.get('/styles.css',sendFile('styles.css'));
app.get('/app.js',sendFile('app.js'));
app.get('/portal.html',sendFile('portal.html'));
app.get('/portal.css',sendFile('portal.css'));
app.get('/portal.js',sendFile('portal.js'));

const phoneSchema = z.string().regex(/^\+255[0-9]{9}$/);
const normalizePhone = v => { const s=String(v||'').replace(/[\s()-]/g,''); if(/^0\d{9}$/.test(s))return '+255'+s.slice(1);if(/^255\d{9}$/.test(s))return '+'+s;return s; };
async function setSession(userId,res){const token=await new SignJWT({sub:userId}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('7d').sign(secret);res.cookie('pp_session',token,{httpOnly:true,secure:production,sameSite:'lax',maxAge:7*86400_000,path:'/'});}
async function auth(req,res,next){try{if(!req.cookies.pp_session)return res.sendStatus(401);req.userId=(await jwtVerify(req.cookies.pp_session,secret)).payload.sub;next();}catch{res.sendStatus(401);}}

app.get('/v1/plans',async(_req,res,next)=>{try{const{rows}=await pool.query('SELECT id,name,price_tzs,duration_seconds,quota_bytes FROM plans WHERE active ORDER BY duration_seconds');res.json(rows);}catch(e){next(e);}});
app.post('/v1/auth/signup',rateLimit({windowMs:900000,limit:8}),async(req,res,next)=>{try{const phone=normalizePhone(req.body.phone),password=z.string().min(10).max(128).parse(req.body.password);phoneSchema.parse(phone);const hash=await argon2.hash(password,{type:argon2.argon2id});const{rows}=await pool.query('INSERT INTO users(phone_e164,password_hash) VALUES($1,$2) ON CONFLICT(phone_e164) DO NOTHING RETURNING id',[phone,hash]);if(!rows[0])return res.status(409).json({error:'An account already exists for this number.'});await setSession(rows[0].id,res);res.status(201).json({user:{id:rows[0].id,phone}});}catch(e){if(e instanceof z.ZodError)return res.status(400).json({error:'Enter a valid Tanzanian number and password of at least 10 characters.'});next(e);}});
app.post('/v1/auth/login',rateLimit({windowMs:900000,limit:12}),async(req,res,next)=>{try{const phone=normalizePhone(req.body.phone),password=z.string().min(1).max(128).parse(req.body.password);phoneSchema.parse(phone);const{rows}=await pool.query('SELECT id,password_hash FROM users WHERE phone_e164=$1',[phone]);if(!rows[0]||!(await argon2.verify(rows[0].password_hash,password)))return res.status(401).json({error:'Phone number or password is incorrect.'});await setSession(rows[0].id,res);res.json({user:{id:rows[0].id,phone}});}catch(e){if(e instanceof z.ZodError)return res.status(400).json({error:'Enter a valid Tanzanian number and password.'});next(e);}});
app.post('/v1/auth/logout',(_req,res)=>res.clearCookie('pp_session',{httpOnly:true,secure:production,sameSite:'lax',path:'/'}).sendStatus(204));
app.get('/v1/me',auth,async(req,res,next)=>{try{const{rows}=await pool.query(`SELECT u.phone_e164,s.expires_at,p.name AS plan_name FROM users u LEFT JOIN LATERAL (SELECT * FROM subscriptions WHERE user_id=u.id AND status='active' AND expires_at>now() ORDER BY expires_at DESC LIMIT 1)s ON true LEFT JOIN plans p ON p.id=s.plan_id WHERE u.id=$1`,[req.userId]);if(!rows[0])return res.sendStatus(404);res.json({phone:rows[0].phone_e164,subscription:rows[0].expires_at?{plan:rows[0].plan_name,expiresAt:rows[0].expires_at}:null});}catch(e){next(e);}});

app.post('/v1/payments',auth,async(req,res,next)=>{try{const planId=z.string().min(1).max(32).parse(req.body.planId),phone=normalizePhone(req.body.phone),wallet=z.enum(['mpesa','airtel','halopesa','yas']).parse(req.body.provider);phoneSchema.parse(phone);const{rows:p}=await pool.query('SELECT id,price_tzs FROM plans WHERE id=$1 AND active=true',[planId]);if(!p[0])return res.status(404).json({error:'Plan not found.'});const tx=crypto.randomUUID();const{rows}=await pool.query(`INSERT INTO payments(user_id,plan_id,provider,provider_tx_id,phone_e164,amount_tzs) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,provider_tx_id,status`,[req.userId,planId,wallet,tx,phone,p[0].price_tzs]);const payment={...rows[0],amount_tzs:p[0].price_tzs,phone_e164:phone,provider:wallet};const push=await provider.startPush(payment);await pool.query('UPDATE payments SET provider_reference=$2,provider_payload=$3 WHERE id=$1',[payment.id,push.reference||null,push]);res.status(202).json({paymentId:payment.id,status:'pending',message:push.message||'Approve the payment prompt on your phone.'});}catch(e){if(e instanceof z.ZodError)return res.status(400).json({error:'Check the selected wallet, plan, and phone number.'});next(e);}});
app.get('/v1/payments/:id',auth,async(req,res,next)=>{try{const{rows}=await pool.query('SELECT id,status,paid_at FROM payments WHERE id=$1 AND user_id=$2',[req.params.id,req.userId]);if(!rows[0])return res.sendStatus(404);res.json({paymentId:rows[0].id,status:rows[0].status,paidAt:rows[0].paid_at});}catch(e){next(e);}});

app.get('/captive-portal/api/:token',(_req,res)=>res.set('Cache-Control','no-store').type('application/captive+json').json({captive:true,'user-portal-url':`${process.env.APP_ORIGIN}/portal.html`}));

async function fulfillPayment(txId,amount,currency,payload){const c=await pool.connect();try{await c.query('BEGIN');const{rows}=await c.query(`SELECT p.*,pl.duration_seconds FROM payments p JOIN plans pl ON pl.id=p.plan_id WHERE p.provider_tx_id=$1 FOR UPDATE`,[txId]);const p=rows[0];if(!p||p.status==='paid'){await c.query('COMMIT');return;}if(Number(p.amount_tzs)!==Number(amount)||currency!=='TZS')throw Error('Payment amount/currency mismatch');const active=await c.query("SELECT expires_at FROM subscriptions WHERE user_id=$1 AND status='active' AND expires_at>now() ORDER BY expires_at DESC LIMIT 1 FOR UPDATE",[p.user_id]);const start=active.rows[0]?new Date(active.rows[0].expires_at):new Date(),end=new Date(start.getTime()+Number(p.duration_seconds)*1000);await c.query("UPDATE payments SET status='paid',paid_at=now(),provider_payload=$2,updated_at=now() WHERE id=$1",[p.id,payload]);await c.query("UPDATE subscriptions SET status='expired' WHERE user_id=$1 AND status='active' AND expires_at<=now()",[p.user_id]);await c.query("INSERT INTO subscriptions(user_id,plan_id,starts_at,expires_at,status,source_payment_id) VALUES($1,$2,$3,$4,'active',$5) ON CONFLICT(source_payment_id) DO NOTHING",[p.user_id,p.plan_id,start,end,p.id]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}

// Explicitly local-only payment simulation. It is never mounted in production.
if(!production&&process.env.PAYMENT_DRIVER==='mock')app.post('/dev/confirm-payment/:id',async(req,res,next)=>{try{const{rows}=await pool.query('SELECT provider_tx_id,amount_tzs,currency FROM payments WHERE id=$1',[req.params.id]);if(!rows[0])return res.sendStatus(404);await fulfillPayment(rows[0].provider_tx_id,rows[0].amount_tzs,rows[0].currency,{demo:true});res.json({status:'paid'});}catch(e){next(e);}});

app.use((err,_req,res,_next)=>{console.error(err);res.status(500).json({error:production?'Request could not be completed.':err.message});});
app.listen(Number(process.env.PORT||3000),()=>console.log(`PocketPass listening on ${process.env.PORT||3000}`));
