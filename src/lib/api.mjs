let token;
export async function api(url, body, options = {}) {
  async function request(path,init){try{return await fetch(path,{cache:'no-store',credentials:'same-origin',...init});}catch(error){if(options.signal?.aborted)throw error;throw new Error('작업실 서버에 연결하지 못했어요. 네트워크 연결을 확인한 뒤 다시 시도해 주세요');}}
  async function json(response){const type=response.headers.get('content-type')||'';if(!type.includes('application/json'))throw new Error('이 주소에서 작업실 API를 확인하지 못했어요. 앱 접속 주소를 확인해 주세요');try{return await response.json();}catch{throw new Error('서버 응답을 읽지 못했어요. 연결을 다시 확인해 주세요');}}
  if (body!==undefined && !token) { const session = await request('/api/session',{signal:options.signal}); if (!session.ok) throw new Error('작업실 서버에 연결하지 못했어요. 네트워크 연결을 확인한 뒤 다시 시도해 주세요'); const data=await json(session);if(typeof data.token!=='string'||!data.token)throw new Error('작업실 연결 정보를 확인하지 못했어요. 앱 접속 주소를 확인해 주세요');token=data.token; }
  const binary=body instanceof Blob;
  const res = await request(url, body === undefined ? {signal:options.signal} : { method: 'POST', headers: { 'Content-Type': binary?'application/octet-stream':'application/json', 'x-personas-token': token, ...options.headers }, body: binary?body:JSON.stringify(body), signal:options.signal });
  const result = await json(res);
  if(res.status===403 && result.code==='csrf' && !options.retried){token=null;return api(url,body,{...options,retried:true});}
  if (!res.ok) throw new Error(result.error || '요청을 처리하지 못했어요'); return result;
}
