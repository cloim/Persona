import test from 'node:test';
import assert from 'node:assert/strict';
test('Google status reads independently of the write session and reports transport failures accurately',async t=>{
  const calls=[];t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,options});return Response.json({configured:true,user:null});});
  const{api}=await import('../src/lib/api.mjs');assert.equal((await api('/api/google/status')).configured,true);
  assert.deepEqual(calls.map(c=>c.url),['/api/google/status']);assert.equal(calls[0].options.cache,'no-store');assert.equal(calls[0].options.credentials,'same-origin');
  globalThis.fetch.mock.mockImplementation(async()=>{throw new TypeError('Failed to fetch');});
  await assert.rejects(api('/api/google/status'),/네트워크/);
  globalThis.fetch.mock.mockImplementation(async()=>new Response('<html>cached app</html>',{headers:{'Content-Type':'text/html'}}));
  await assert.rejects(api('/api/google/status'),/접속 주소/);
  globalThis.fetch.mock.mockImplementation(async()=>Response.json({configured:false,user:null}));
  assert.equal((await api('/api/google/status')).configured,false);
});
