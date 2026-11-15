import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createServer} from 'node:http';
import {googleRouter,GOOGLE_SCOPES,validChunkRange,safeDriveName} from '../server/google.mjs';
import {newProject} from '../src/lib/dataset.mjs';

test('Drive permissions and chunk validation remain bounded to app files',()=>{
 assert.ok(GOOGLE_SCOPES.includes('https://www.googleapis.com/auth/drive.file'));assert.ok(!GOOGLE_SCOPES.includes('https://www.googleapis.com/auth/drive'));
 assert.equal(safeDriveName('name/unsafe\\folder'),'name_unsafe_folder');
 assert.ok(validChunkRange('bytes 0-3/10',10,0,4));assert.ok(!validChunkRange('bytes 4-7/10',10,0,4));assert.ok(!validChunkRange('bytes 0-10/10',10,0,11));
});
test('OAuth state, private session and resumable Drive package flow',async t=>{
 const app=express();app.use(express.json());let authOptions;let fileNo=0;const external=[];
 const fakeClient={generateAuthUrl(options){authOptions=options;return 'https://accounts.google.com/o/oauth2/v2/auth?state='+options.state;},async getToken(){return{tokens:{access_token:'test-access',id_token:'test-id',scope:GOOGLE_SCOPES.join(' ')}};},async verifyIdToken(){return{getPayload:()=>({sub:'user-1',email:'user@example.com',email_verified:true,name:'Example',nonce:authOptions.nonce})};},setCredentials(){},on(){},async getAccessToken(){return{token:'test-access'};}};
 const fakeFetch=async(url,options={})=>{external.push({url,options});assert.equal(options.redirect,'manual');
  if(url.includes('uploadType=resumable'))return new Response('',{status:200,headers:{location:'https://www.googleapis.com/upload/drive/v3/files?upload_id='+ (++fileNo)}});
  if(url.includes('upload_id=')){const no=new URL(url).searchParams.get('upload_id');if(options.headers['Content-Range']==='bytes 0-1/4')return new Response(null,{status:308,headers:{range:'bytes=0-1',location:url}});return Response.json({id:'file-'+no,name:no==='1'?'dataset.zip':'train.ipynb'});}
  if(options.method==='POST'){const data=JSON.parse(options.body);return Response.json({id:'folder-'+external.length,name:data.name});}
  const params=new URL(url).searchParams;
  if(params.get('alt')==='media')return new Response(new Uint8Array([1,2,3,4]));
  if(params.get('fields')?.includes('appProperties'))return Response.json({id:'saved-folder',mimeType:'application/vnd.google-apps.folder',appProperties:{personasRole:url.includes('outside')?'other':'package'}});
  if(params.get('q')?.includes('in parents'))return Response.json({files:[{id:'saved-zip',size:'4'}]});
  if(params.get('q')?.includes("value='package'"))return Response.json({files:[{id:'saved-folder',name:'Example',createdTime:'2026-11-15T00:00:00Z'}],nextPageToken:'next-page'});
  return Response.json({files:[]});
 };
 const origins=new Set(['http://127.0.0.1:1']);
 app.use('/api/google',googleRouter({origins,clientId:'test-client',clientSecret:'test-secret',clientFactory:()=>fakeClient,fetcher:fakeFetch}));
 const server=createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}`;origins.clear();origins.add(base);let cookie='';
 const call=async(path,body,headers={})=>{const res=await fetch(base+'/api/google'+path,{method:body===undefined?'GET':'POST',headers:{...(body?{'Content-Type':body instanceof Uint8Array?'application/octet-stream':'application/json'}:{}),...(cookie?{cookie}:{}),...headers},body:body===undefined?undefined:body instanceof Uint8Array?body:JSON.stringify(body),redirect:'manual'});const set=res.headers.get('set-cookie');if(set)cookie=set.split(';')[0];return res;};
 assert.equal((await call('/packages',{})).status,401);
 assert.equal((await call('/packages')).status,401);assert.equal((await call('/packages/saved-folder/archive')).status,401);
 let login=await(await call('/login',{})).json();assert.equal((await call('/callback?state=wrong&code=mock')).status,302);assert.equal((await(await call('/status')).json()).user,null);
 login=await(await call('/login',{})).json();const state=new URL(login.url).searchParams.get('state');assert.equal((await call('/callback?state='+state+'&code=mock')).status,302);
 const status=await(await call('/status')).json();assert.equal(status.user.email,'user@example.com');assert.ok(!JSON.stringify(status).includes('test-access'));
 const pkg=await(await call('/packages',{projectId:'project-1',name:'Example'})).json();assert.ok(pkg.driveFolderPath.startsWith('Personas Studio/'));
 for(const name of ['dataset.zip']){const upload=await(await call(`/packages/${pkg.id}/uploads`,{name,size:4})).json();let result=await(await call(`/uploads/${upload.id}/chunk`,new Uint8Array([1,2]),{'Content-Range':'bytes 0-1/4'})).json();assert.equal(result.offset,2);assert.ok(!result.file);result=await(await call(`/uploads/${upload.id}/chunk`,new Uint8Array([3,4]),{'Content-Range':'bytes 2-3/4'})).json();assert.equal(result.offset,4);}
 const complete=await(await call(`/packages/${pkg.id}/complete`,{})).json();assert.ok(complete.folderUrl.startsWith('https://drive.google.com/drive/folders/'));assert.ok(!external.some(req=>req.url.includes('permissions')));
 const list=await(await call('/packages?pageToken=previous-page')).json();assert.equal(list.files[0].id,'saved-folder');assert.equal(list.nextPageToken,'next-page');assert.ok(external.some(req=>new URL(req.url).searchParams.get('pageToken')==='previous-page'));
 assert.equal((await call('/packages/outside/archive')).status,404);assert.equal((await call('/packages/bad%27id/archive')).status,400);
 const archive=await call('/packages/saved-folder/archive');assert.equal(archive.headers.get('content-type'),'application/zip');assert.deepEqual([...new Uint8Array(await archive.arrayBuffer())],[1,2,3,4]);
});
