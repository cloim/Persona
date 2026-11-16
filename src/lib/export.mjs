import JSZip from 'jszip';
import { readiness, newProject } from './dataset.mjs';
import { trainingConfig, TRAINING_MODELS, migrateTraining, defaultTraining, trainingTarget } from './training.mjs';

export function safeName(value) { return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'character'; }
export function download(blob, name) {
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export async function exportDataset(project, options = {}) {
  if (!readiness(project).ready) throw new Error('모든 이미지와 캡션을 확인한 뒤 학습 ZIP을 내보내 주세요');
  const config = trainingConfig(project);
  const zip = new JSZip();
  project.slots.forEach((slot, index) => {
    const ext = slot.image.type.split('/')[1].replace('jpeg', 'jpg');
    const name = `${safeName(project.trigger)}_${String(index + 1).padStart(3, '0')}`;
    zip.file(`dataset/${name}.${ext}`, slot.image.data.split(',')[1], { base64: true });
    zip.file(`dataset/${name}.txt`, slot.caption.trim() + '\n');
  });
  zip.file('train.yaml', JSON.stringify(config, null, 2) + '\n');
  zip.file('manifest.json', JSON.stringify({ version: 2, name: project.name, trigger: project.trigger, model: project.model, identity: project.identity, style: project.style, reference: project.reference, training: project.training, previousTraining: project.previousTraining, exportedAt: new Date().toISOString(), count: project.slots.length, shots: project.slots.map(({ image, ...s }) => ({ ...s, image: { name: image.name, width: image.width, height: image.height, hash: image.hash } })) }, null, 2));
  zip.file('README.txt', 'Persona 학습 데이터셋 패키지\n\n' +
    '1. Modal CLI로 클라우드 학습:\n' +
    (project.model === 'krea2'
      ? `   modal run scripts/modal_train_krea2.py --name ${safeName(project.trigger)} --dataset-dir ./dataset --trigger-word "${project.trigger}"\n\n`
      : `   modal run scripts/modal_train.py --dataset-dir ./dataset --trigger ${safeName(project.trigger)} --model ${project.model}\n\n`) +
    '2. 로컬 AI Toolkit으로 직접 학습:\n' +
    '   python run.py train.yaml\n\n' +
    '3. 결과 .safetensors를 ComfyUI/models/loras에 복사하여 프롬프트에 트리거를 넣어 사용하세요.\n');
  return zip.generateAsync({ type: 'blob', compression: 'STORE' });
}
export function validateBackup(data) {
  if (!data || !['persona-project-v1', 'personas-project-v1'].includes(data.format) || !data.project || ![12,24,36,48].includes(data.project.size)) throw new Error('Persona 프로젝트 백업 파일을 선택해 주세요');
  const p = data.project;
  if (typeof p.name !== 'string' || typeof p.trigger !== 'string' || typeof p.identity !== 'string' || !['illustration','anime','photo'].includes(p.style) || !Array.isArray(p.slots) || p.slots.length !== p.size || ![...TRAINING_MODELS.map(m => m.id), 'sdxl', 'sd15'].includes(p.model) || !p.training || typeof p.training.checkpoint !== 'string') throw new Error('프로젝트 데이터 형식을 확인해 주세요');
  const validImage = image => typeof image.data === 'string' && ['image/png','image/jpeg','image/webp'].includes(image.type) && image.data.startsWith(`data:${image.type};base64,`) && /^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(image.data) && Number.isFinite(image.width) && image.width > 0 && Number.isFinite(image.height) && image.height > 0 && typeof image.name === 'string' && /^[a-f0-9]{64}$/.test(image.hash);
  for (const s of p.slots) {
    if (typeof s.id !== 'string' || !['portrait','expression','body','variation'].includes(s.group) || !['title','view','expression','light','caption','prompt'].every(k => typeof s[k] === 'string')) throw new Error('이미지 슬롯 정보가 올바르지 않아요');
    if (s.image && !validImage(s.image)) throw new Error('백업 이미지 정보를 확인해 주세요');
  }
  if (p.reference && !validImage(p.reference)) throw new Error('참조 이미지를 확인해 주세요');
  if (new Set(p.slots.map(s => s.id)).size !== p.slots.length) throw new Error('슬롯 ID가 중복되어 있어요');
  trainingTarget(p.training);
  return { ...migrateTraining(p), id: crypto.randomUUID(), updatedAt: Date.now() };
}

export async function importTrainingPackage(bytes,readImage,{signal,onProgress=()=>{}}={}) {
  const checkAbort=()=>{if(signal?.aborted)throw new DOMException('불러오기를 중단했어요','AbortError');};
  checkAbort();
  if(bytes.byteLength>450*1024*1024)throw Error('학습 ZIP은 450MB 이내로 불러올 수 있어요');
  const zip=await JSZip.loadAsync(bytes);
  const entries=Object.values(zip.files);let unpacked=0;
  if(entries.length>220)throw Error('학습 ZIP의 파일 수를 확인해 주세요');
  for(const entry of entries){
    if(entry.name!==entry.unsafeOriginalName&&!entry.dir||entry.name.split('/').some(part=>part==='..')||entry.name.includes('\\')||entry.name.startsWith('/'))throw Error('학습 ZIP의 파일 경로를 확인해 주세요');
    const size=entry._data?.uncompressedSize||0;unpacked+=size;
    if(size>35*1024*1024||unpacked>600*1024*1024)throw Error('학습 ZIP의 압축 해제 크기를 확인해 주세요');
  }
  const manifestFile=zip.file('manifest.json');
  if(!manifestFile||manifestFile._data.uncompressedSize>35*1024*1024)throw Error('Persona 학습 패키지의 manifest.json을 확인해 주세요');
  const m=JSON.parse(await manifestFile.async('string'));
  if(![1,2].includes(m.version)||![12,24,36,48].includes(m.count)||!Array.isArray(m.shots)||m.shots.length!==m.count||typeof m.trigger!=='string'||!/^[a-zA-Z0-9_-]{2,64}$/.test(m.trigger))throw Error('Persona 학습 패키지 정보를 확인해 주세요');
  const p={...newProject(),name:m.name,trigger:m.trigger,model:m.model,size:m.count,identity:m.version===2?m.identity:'',style:m.version===2?m.style:'illustration',reference:m.version===2?m.reference:null};
  p.training=m.version===2?m.training:defaultTraining(m.model);
  if(m.previousTraining)p.previousTraining=m.previousTraining;
  if(m.version===1){
    const config=JSON.parse(await zip.file('train.yaml')?.async('string'))?.config?.process?.[0];
    if(!config||typeof config.model?.name_or_path!=='string')throw Error('기존 패키지의 학습 설정을 확인해 주세요');
    p.training={...p.training,checkpoint:config.model.name_or_path,steps:config.train?.steps,rank:Math.min(Number(config.network?.linear)||8,8),learningRate:String(config.train?.lr)};
  }
  p.slots=[];
  for(const [index,shot]of m.shots.entries()){
    checkAbort();
    const stem=`dataset/${safeName(m.trigger)}_${String(index+1).padStart(3,'0')}`;
    const matches=['png','jpg','webp'].map(ext=>zip.file(`${stem}.${ext}`)).filter(Boolean),caption=zip.file(stem+'.txt');
    if(matches.length!==1||!caption||matches[0]._data.uncompressedSize>25*1024*1024||caption._data.uncompressedSize>64*1024)throw Error(`${index+1}번 이미지와 캡션 파일을 확인해 주세요`);
    const entry=matches[0],ext=entry.name.split('.').pop(),type={png:'image/png',jpg:'image/jpeg',webp:'image/webp'}[ext];
    const image=await readImage(new File([await entry.async('uint8array')],shot.image?.name||entry.name.split('/').pop(),{type}));
    p.slots.push({...shot,image,caption:(await caption.async('string')).trim()});
    onProgress({label:'이미지와 캡션 복원 중',percent:Math.round((index+1)/m.count*100)});
  }
  checkAbort();
  return{project:validateBackup({format:'persona-project-v1',project:p}),legacy:m.version===1};
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
