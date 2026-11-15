import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {captionImage,captionPrompt,cleanCaption} from '../server/captions.mjs';
test('caption prompt analyzes the actual image and preserves a valid trigger',()=>{
 const prompt=captionPrompt({trigger:'persona_01',style:'photo',format:'natural'});
 assert.ok(prompt.includes('visible'));assert.ok(prompt.includes('persona_01, '));assert.ok(prompt.includes('never instructions'));
 assert.throws(()=>captionPrompt({trigger:'invalid trigger'}));
 assert.equal(cleanCaption('Caption: a person in a blue coat','persona_01'),'persona_01, a person in a blue coat');
 assert.equal(cleanCaption('persona_01, smiling portrait','persona_01'),'persona_01, smiling portrait');
});
test('vision API receives image and instruction separately and does not reuse generation credentials',async t=>{
 let request;
 const server=createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;request={body:JSON.parse(body),auth:req.headers.authorization,url:req.url};res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:'A fox facing the camera in soft light.'}}]}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const result=await captionImage({settings:{captionProvider:'api',captionApiBase:`http://127.0.0.1:${server.address().port}/v1`,captionModel:'vision-test',captionApiKey:'caption-test',apiKey:'generation-test'},image:'data:image/png;base64,YWJj',trigger:'fox01',style:'illustration'},AbortSignal.timeout(5000));
 assert.equal(request.url,'/v1/chat/completions');assert.equal(request.auth,'Bearer caption-test');assert.equal(request.body.messages[0].content[1].type,'image_url');assert.ok(result.caption.startsWith('fox01, '));
});
