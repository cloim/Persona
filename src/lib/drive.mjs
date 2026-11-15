import { api } from './api.mjs';
import { exportDataset, importTrainingPackage } from './export.mjs';
import { trainingConfig } from './training.mjs';

export async function uploadTrainingPackage(project,onProgress,signal) {
  trainingConfig(project);
  const pkg=await api('/api/google/packages',{projectId:project.id,name:project.name},{signal});
  onProgress({label:'학습 패키지 준비 중',percent:0});
  const blob=await exportDataset(project,{driveFolderPath:pkg.driveFolderPath});
  const total=blob.size;let sent=0;
  const upload=await api(`/api/google/packages/${pkg.id}/uploads`,{name:'dataset.zip',size:blob.size},{signal});let offset=0;
  while(offset<blob.size){
    const chunk=blob.slice(offset,Math.min(blob.size,offset+upload.chunkSize));
    const result=await api(`/api/google/uploads/${upload.id}/chunk`,chunk,{signal,headers:{'Content-Range':`bytes ${offset}-${offset+chunk.size-1}/${blob.size}`}});
    if(result.offset<=offset)throw new Error('업로드 연결을 확인한 뒤 다시 저장해 주세요');
    sent+=result.offset-offset;offset=result.offset;
    onProgress({label:'학습 데이터셋 ZIP 업로드 중',percent:Math.round(sent/total*100)});
  }
  return{...await api(`/api/google/packages/${pkg.id}/complete`,{},{signal}),trainingTarget:project.training.target||'modal-a10g'};
}

export async function loadDriveProject(folderId,readImage,onProgress,signal) {
  const response=await fetch(`/api/google/packages/${encodeURIComponent(folderId)}/archive`,{cache:'no-store',credentials:'same-origin',signal});
  if(!response.ok){const error=await response.json().catch(()=>({}));throw Error(error.error||'Drive 프로젝트를 내려받지 못했어요');}
  if(!response.headers.get('content-type')?.includes('application/zip'))throw Error('Drive 학습 ZIP 응답을 확인해 주세요');
  const total=Number(response.headers.get('content-length')),limit=450*1024*1024;
  if(!Number.isSafeInteger(total)||total<1||total>limit)throw Error('Drive 학습 ZIP 크기를 확인해 주세요');
  const reader=response.body.getReader(),chunks=[];let received=0;
  try{
    while(true){const {done,value}=await reader.read();if(done)break;received+=value.length;if(received>total)throw Error('Drive 학습 ZIP 크기가 변경됐어요');chunks.push(value);onProgress({label:'Drive에서 다운로드 중',percent:Math.round(received/total*100)});}
    if(received!==total)throw Error('Drive 다운로드 연결을 확인한 뒤 다시 시도해 주세요');
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  onProgress({label:'학습 패키지 확인 중',percent:0});
  return importTrainingPackage(await new Blob(chunks).arrayBuffer(),readImage,{signal,onProgress});
}
