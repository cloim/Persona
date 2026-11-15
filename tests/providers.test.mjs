import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { validBase, prepareWorkflow, compatibleGenerate, comfyGenerate } from '../server/providers.mjs';

test('workflow substitutes prompt safely, uses integer seed and preserves links',()=>{
  const workflow={'1':{class_type:'Text',inputs:{text:'{{prompt}}'}},'2':{class_type:'KSampler',inputs:{seed:'{{seed}}',model:['3',0]}},'3':{class_type:'LoadImage',inputs:{image:'{{reference}}'}}};
  const actual=prepareWorkflow(workflow,'a "quoted"\ncharacter',42,'ref.png'); assert.equal(actual['1'].inputs.text,'a "quoted"\ncharacter');assert.equal(actual['2'].inputs.seed,42);assert.deepEqual(actual['2'].inputs.model,['3',0]);assert.equal(actual['3'].inputs.image,'ref.png');assert.equal(workflow['1'].inputs.text,'{{prompt}}');
  assert.throws(()=>prepareWorkflow({nodes:[]},'test',1));assert.throws(()=>prepareWorkflow({'1':{class_type:'T',inputs:{text:'test'}}},'test',1));
});
test('base URLs reject non-HTTP and embedded credentials',()=>{assert.equal(validBase('http://127.0.0.1:8188/'),'http://127.0.0.1:8188');assert.throws(()=>validBase('file:///etc/passwd'));assert.throws(()=>validBase('https://user:secret@example.com'));});
test('compatible API supports text generation and multipart reference edits', async t=>{
  const requests=[];const server=createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;requests.push({url:req.url,body,headers:req.headers});res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{b64_json:'YWJj'}]}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
  const settings={apiBase:`http://127.0.0.1:${server.address().port}/v1`,apiModel:'test-model',apiKey:'test-only'};
  assert.equal(await compatibleGenerate({settings,prompt:'test'},AbortSignal.timeout(5000)),'data:image/png;base64,YWJj');
  assert.equal(requests[0].url,'/v1/images/generations');assert.equal(JSON.parse(requests[0].body).prompt,'test');assert.equal(requests[0].headers.authorization,'Bearer test-only');
  await compatibleGenerate({settings,prompt:'edit',reference:'data:image/png;base64,YWJj'},AbortSignal.timeout(5000));assert.equal(requests[1].url,'/v1/images/edits');assert.ok(requests[1].headers['content-type'].includes('multipart/form-data'));assert.ok(requests[1].body.includes('name="image"'));assert.ok(requests[1].body.includes('edit'));
});
test('ComfyUI queues workflow, polls history, and downloads image', async t=>{
  let posted;const server=createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;if(req.url==='/prompt'){posted=JSON.parse(body);res.setHeader('content-type','application/json');res.end(JSON.stringify({prompt_id:'p1'}));}else if(req.url==='/history/p1'){res.setHeader('content-type','application/json');res.end(JSON.stringify({p1:{status:{completed:true},outputs:{'9':{images:[{filename:'out.png',subfolder:'',type:'output'}]}}}}));}else{res.setHeader('content-type','image/png');res.end(Buffer.from('test'));}});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
  const settings={comfyUrl:`http://127.0.0.1:${server.address().port}`,workflow:JSON.stringify({'1':{class_type:'Text',inputs:{text:'{{prompt}}'}}})};
  const image=await comfyGenerate({settings,prompt:'character'},AbortSignal.timeout(5000),()=>{});assert.ok(image.startsWith('data:image/png'));assert.equal(posted.prompt['1'].inputs.text,'character');
});
