import { Router } from 'express';
import express from 'express';
import session from 'express-session';
import { OAuth2Client } from 'google-auth-library';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const GOOGLE_SCOPES = ['openid','email','profile','https://www.googleapis.com/auth/drive.file'];
export function safeDriveName(value) { return String(value || 'character').replace(/[\u0000-\u001f/\\]/g,'_').slice(0,100).trim() || 'character'; }
export function validChunkRange(value,total,offset,length) {
  const match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(value||'');
  return !!match && Number(match[1])===offset && Number(match[2])===offset+length-1 && Number(match[3])===total && offset+length<=total && length>0;
}
const random = () => randomBytes(32).toString('base64url');
const same = (a,b) => typeof a==='string' && typeof b==='string' && Buffer.byteLength(a)===Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));

export function googleRouter({ origins, clientId, clientSecret, sessionSecret = random(), fetcher = fetch, clientFactory }) {
  const router=Router();const packages=new Map(), uploads=new Map();
  const configured=!!clientId && !!clientSecret;
  const sessionStore=new session.MemoryStore();
  const cleanup=setInterval(()=>{const now=Date.now();for(const [id,p]of packages)if(now-p.createdAt>24*3600_000)packages.delete(id);for(const[id,u]of uploads)if(now-u.createdAt>3600_000)uploads.delete(id);},300_000);cleanup.unref();
  router.use(session({ name:'persona.google', secret:sessionSecret, store:sessionStore, resave:false, saveUninitialized:false, cookie:{httpOnly:true,sameSite:'lax',secure:'auto',maxAge:8*3600_000} }));
  const ownOrigin=req=>[...origins].find(o=>new URL(o).host===req.headers.host);
  const oauth=redirect=>clientFactory?clientFactory(redirect):new OAuth2Client(clientId,clientSecret,redirect);
  const requireUser=(req,res,next)=>{if(!req.session.google)return res.status(401).json({error:'Google에 로그인한 뒤 Drive를 연결해 주세요'});next();};
  const accessToken=async req=>{
    const client=oauth();client.setCredentials(req.session.google.tokens);
    client.on('tokens',tokens=>{req.session.google.tokens={...req.session.google.tokens,...tokens};});
    const {token}=await client.getAccessToken();if(!token)throw Error('Google에 다시 로그인해 주세요');
    return token;
  };
  async function drive(req,url,options={}){
    const token=await accessToken(req);
    const response=await fetcher(url,{...options,headers:{...options.headers,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(90_000),redirect:'manual'});
    if(!response.ok && response.status!==308)throw Error(response.status===401?'Google에 다시 로그인해 주세요':`Drive 응답 ${response.status}: 권한과 저장 공간을 확인해 주세요`);
    return response;
  }
  const jsonCall=async(req,url,body)=> (await drive(req,url,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined})).json();
  const api='https://www.googleapis.com/drive/v3/files';
  const folder=async(req,name,parent,role)=>jsonCall(req,api+'?fields=id,name,webViewLink',{name,mimeType:'application/vnd.google-apps.folder',...(parent?{parents:[parent]}:{}),appProperties:{personaRole:role,personasRole:role}});
  router.get('/status',(req,res)=>res.json({configured,user:req.session.google?.user||null,scopes:GOOGLE_SCOPES,redirectUri:ownOrigin(req)+'/api/google/callback'}));
  router.post('/login',(req,res)=>{
    if(!configured)return res.status(503).json({error:'서버의 Google OAuth 클라이언트 설정을 먼저 완료해 주세요'});
    const redirect=ownOrigin(req)+'/api/google/callback';const state=random(), verifier=random(),nonce=random();
    req.session.pendingGoogle={state,verifier,nonce,redirect,createdAt:Date.now()};
    const url=oauth(redirect).generateAuthUrl({scope:GOOGLE_SCOPES,access_type:'offline',prompt:'consent',state,nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
    req.session.save(error=>error?res.status(500).json({error:'로그인 세션을 준비하지 못했어요'}):res.json({url}));
  });
  router.get('/callback',async(req,res)=>{
    res.set('Referrer-Policy','no-referrer');const pending=req.session.pendingGoogle;delete req.session.pendingGoogle;
    if(!pending||Date.now()-pending.createdAt>10*60_000||!same(pending.state,req.query.state)||pending.redirect!==ownOrigin(req)+'/api/google/callback')return res.redirect('/cloud?google=state');
    if(req.query.error||typeof req.query.code!=='string')return res.redirect('/cloud?google=cancelled');
    try {
      const client=oauth(pending.redirect);const {tokens}=await client.getToken({code:req.query.code,codeVerifier:pending.verifier});
      const ticket=await client.verifyIdToken({idToken:tokens.id_token,audience:clientId});const payload=ticket.getPayload();
      if(!payload?.sub || payload.nonce!==pending.nonce || !payload.email_verified)throw Error('Google 계정 확인에 실패했어요');
      if(!(tokens.scope||'').split(' ').includes('https://www.googleapis.com/auth/drive.file'))throw Error('Drive 파일 권한을 확인해 주세요');
      await new Promise((resolve,reject)=>req.session.regenerate(error=>error?reject(error):resolve()));
      req.session.google={user:{id:payload.sub,email:payload.email,name:payload.name||payload.email,picture:payload.picture||''},tokens};
      req.session.save(error=>res.redirect('/cloud?google='+(error?'error':'connected')));
    }catch{res.redirect('/cloud?google=error');}
  });
  router.post('/logout',requireUser,async(req,res)=>{req.session.destroy(()=>{res.clearCookie('persona.google',{path:'/',sameSite:'lax',secure:req.secure});res.clearCookie('personas.google',{path:'/',sameSite:'lax',secure:req.secure});res.json({ok:true});});});
  router.get('/packages',requireUser,async(req,res)=>{
    try{
      if(req.query.pageToken!==undefined&&(typeof req.query.pageToken!=='string'||req.query.pageToken.length>2048))throw Error('Drive 목록 페이지를 다시 확인해 주세요');
      const params=new URLSearchParams({q:"trashed = false and mimeType = 'application/vnd.google-apps.folder' and (appProperties has { key='personaRole' and value='package' } or appProperties has { key='personasRole' and value='package' })",fields:'nextPageToken,files(id,name,createdTime)',orderBy:'createdTime desc',pageSize:'50'});
      if(req.query.pageToken)params.set('pageToken',req.query.pageToken);
      const result=await jsonCall(req,api+'?'+params);
      res.json({files:result.files||[],nextPageToken:result.nextPageToken||null});
    }catch(error){res.status(400).json({error:error.message});}
  });
  router.get('/packages/:id/archive',requireUser,async(req,res)=>{
    try{
      const id=req.params.id;
      if(!/^[a-zA-Z0-9_-]{1,200}$/.test(id))throw Error('Drive 프로젝트 주소를 확인해 주세요');
      const meta=await jsonCall(req,api+'/'+id+'?fields=id,mimeType,trashed,appProperties');
      if(meta.trashed||meta.mimeType!=='application/vnd.google-apps.folder'||(!['package'].includes(meta.appProperties?.personaRole)&&meta.appProperties?.personasRole!=='package'))return res.status(404).json({error:'Persona에서 저장한 프로젝트 폴더를 선택해 주세요'});
      const params=new URLSearchParams({q:`'${id}' in parents and trashed = false and name = 'dataset.zip' and (appProperties has { key='personaRole' and value='dataset' } or appProperties has { key='personasRole' and value='dataset' })`,fields:'files(id,size)',pageSize:'2'});
      const {files=[]}=await jsonCall(req,api+'?'+params);
      if(files.length!==1)return res.status(404).json({error:'이 폴더의 학습 ZIP을 확인할 수 없어요. 저장을 완료한 프로젝트를 선택해 주세요'});
      const file=files[0],size=Number(file.size),limit=450*1024*1024;
      if(!Number.isSafeInteger(size)||size<1||size>limit)throw Error('Drive 학습 ZIP은 450MB 이내로 불러올 수 있어요');
      const response=await drive(req,api+'/'+encodeURIComponent(file.id)+'?alt=media');
      res.set({'Content-Type':'application/zip','Content-Disposition':'attachment; filename="dataset.zip"','Content-Length':String(size)});
      let received=0;
      const bounded=new Transform({transform(chunk,encoding,callback){received+=chunk.length;callback(received>size?Error('Drive 파일 크기가 변경됐어요'):null,chunk);},flush(callback){callback(received===size?null:Error('Drive 파일 다운로드가 완료되지 않았어요'));}});
      await pipeline(Readable.fromWeb(response.body),bounded,res);
    }catch(error){if(!res.headersSent)res.status(400).json({error:error.message});else res.destroy();}
  });
  router.post('/packages',requireUser,async(req,res)=>{
    try{
      if(typeof req.body?.projectId!=='string'||!req.body.projectId||typeof req.body.name!=='string')return res.status(400).json({error:'저장할 프로젝트를 확인해 주세요'});
      const query="trashed = false and mimeType = 'application/vnd.google-apps.folder' and (appProperties has { key='personaRole' and value='root' } or appProperties has { key='personasRole' and value='root' })";
      const found=await jsonCall(req,api+'?'+new URLSearchParams({q:query,fields:'files(id,name)',pageSize:'100'}));
      const root=found.files?.[0]||await folder(req,'Persona Studio',null,'root');
      const runName=safeDriveName(req.body.name)+'_'+new Date().toISOString().replace(/[:.]/g,'-')+'_'+randomBytes(3).toString('hex');
      const run=await folder(req,runName,root.id,'package');const id=random();
      const pkg={id,session:req.sessionID,folderId:run.id,driveFolderPath:`${root.name}/${runName}`,createdAt:Date.now(),files:[]};packages.set(id,pkg);
      res.json({id,driveFolderPath:pkg.driveFolderPath,folderUrl:`https://drive.google.com/drive/folders/${run.id}`});
    }catch(error){res.status(400).json({error:error.message});}
  });
  router.post('/packages/:id/uploads',requireUser,async(req,res)=>{
    const pkg=packages.get(req.params.id);if(!pkg||pkg.session!==req.sessionID)return res.status(404).json({error:'이 계정의 업로드 작업을 확인해 주세요'});
    const {name,size,mimeType}=req.body||{};
    if(!['dataset.zip','train.ipynb'].includes(name)||!Number.isInteger(size)||size<1||size>450*1024*1024)return res.status(400).json({error:'학습 ZIP 또는 노트북 크기를 확인해 주세요'});
    try{
      const response=await drive(req,'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink',{method:'POST',headers:{'Content-Type':'application/json','X-Upload-Content-Type':name==='dataset.zip'?'application/zip':'application/x-ipynb+json','X-Upload-Content-Length':String(size)},body:JSON.stringify({name,parents:[pkg.folderId],appProperties:{personaRole:name==='dataset.zip'?'dataset':'notebook',personasRole:name==='dataset.zip'?'dataset':'notebook'}})});
      const location=response.headers.get('location');const url=new URL(location);
      if(url.origin!=='https://www.googleapis.com'||!url.pathname.startsWith('/upload/drive/'))throw Error('Drive 업로드 주소를 확인하지 못했어요');
      const id=random();uploads.set(id,{id,session:req.sessionID,packageId:pkg.id,url:location,total:size,offset:0,name,createdAt:Date.now(),busy:false});res.json({id,chunkSize:8*1024*1024});
    }catch(error){res.status(400).json({error:error.message});}
  });
  router.post('/uploads/:id/chunk',requireUser,express.raw({type:'application/octet-stream',limit:'8mb'}),async(req,res)=>{
    const upload=uploads.get(req.params.id);if(!upload||upload.session!==req.sessionID)return res.status(404).json({error:'업로드 작업이 만료됐어요. 다시 저장해 주세요'});
    if(upload.busy)return res.status(409).json({error:'이전 조각의 업로드가 끝난 뒤 다시 시도해 주세요'});
    if(upload.file)return res.json({offset:upload.total,file:upload.file});
    if(!Buffer.isBuffer(req.body)||!validChunkRange(req.headers['content-range'],upload.total,upload.offset,req.body.length))return res.status(400).json({error:'업로드 순서와 크기를 확인해 주세요'});
    upload.busy=true;
    try{
      let response;
      try {response=await drive(req,upload.url,{method:'PUT',headers:{'Content-Type':'application/octet-stream','Content-Range':req.headers['content-range']},body:req.body});}
      catch {response=await drive(req,upload.url,{method:'PUT',headers:{'Content-Length':'0','Content-Range':`bytes */${upload.total}`}});}
      if(response.status===308){const range=/bytes=0-(\d+)/.exec(response.headers.get('range')||'');upload.offset=range?Number(range[1])+1:0;res.json({offset:upload.offset});}
      else {upload.file=await response.json();upload.offset=upload.total;packages.get(upload.packageId)?.files.push(upload.file);res.json({offset:upload.total,file:upload.file});}
    }catch(error){res.status(400).json({error:error.message});}
    finally{upload.busy=false;}
  });
  router.post('/packages/:id/complete',requireUser,(req,res)=>{
    const pkg=packages.get(req.params.id);if(!pkg||pkg.session!==req.sessionID)return res.status(404).json({error:'저장한 패키지를 확인해 주세요'});
    const zip=pkg.files.find(f=>f.name==='dataset.zip');
    if(!zip?.id)return res.status(400).json({error:'학습 ZIP을 업로드해 주세요'});
    res.json({folderUrl:`https://drive.google.com/drive/folders/${pkg.folderId}`,driveFolderPath:pkg.driveFolderPath,uploadedAt:new Date().toISOString(),email:req.session.google.user.email});
  });
  return router;
}
