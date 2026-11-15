import express from 'express';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { allowedAccess } from './access.mjs';
import { compatibleGenerate, comfyGenerate, codexGenerate, testProvider } from './providers.mjs';
import { captionImage } from './captions.mjs';
import { googleRouter } from './google.mjs';
import { checkModalCli, getModalTrainingJob, cancelModalTraining, startModalTraining, getOutputFileStream } from './modal.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
const app = express(); const token = randomBytes(32).toString('hex');
const port = Number(process.env.PORT || 4317); const production = process.argv.includes('--production');
const access = allowedAccess(port, process.env.PERSONAS_ALLOWED_ORIGINS);
const jobs = new Map();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
app.use('/api', (req, res, next) => {
  const host = req.headers.host;
  if (!access.hosts.has(host)) return res.status(403).json({ error: '허용된 작업실 주소에서 연결해 주세요' });
  if (req.headers.origin && !access.origins.has(req.headers.origin)) return res.status(403).json({ error: '같은 작업실에서 요청해 주세요' });
  res.set('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.headers['x-personas-token'] !== token) return res.status(403).json({ code:'csrf', error: '작업실을 새로고침한 뒤 다시 시도해 주세요' });
  next();
});
app.use(express.json({ limit: '38mb' }));
app.get('/api/session', (req, res) => res.json({ token, version: '1.0.0' }));
app.use('/api/google', googleRouter({ origins:access.origins, clientId:process.env.GOOGLE_CLIENT_ID, clientSecret:process.env.GOOGLE_CLIENT_SECRET }));
let captionRunning=0;
app.post('/api/caption',async(req,res)=>{
  if(captionRunning>=2)return res.status(429).json({error:'진행 중인 캡션 작성이 끝나면 다시 시도해 주세요'});
  if(!req.body.settings || typeof req.body.trigger!=='string')return res.status(400).json({error:'캡션 설정과 트리거를 확인해 주세요'});
  captionRunning++;const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),180_000);
  res.on('close',()=>{if(!res.writableEnded)controller.abort();});
  try{res.json(await captionImage(req.body,controller.signal));}
  catch(error){res.status(400).json({error:error.message});}
  finally{clearTimeout(timer);captionRunning--;}
});
app.post('/api/test-connection', async (req, res) => {
  try { res.json(await testProvider(req.body)); } catch (error) { res.status(400).json({ error: error.message.startsWith('fetch') ? '서버에 연결하지 못했어요. 주소와 실행 상태를 확인해 주세요' : error.message }); }
});
app.post('/api/generate', (req, res) => {
  const { settings, prompt, reference } = req.body;
  if (!settings || !['comfy', 'codex', 'api'].includes(settings.provider) || typeof prompt !== 'string' || prompt.length < 5 || prompt.length > 16000 || (reference && typeof reference !== 'string')) return res.status(400).json({ error: '생성 연결과 프롬프트를 확인해 주세요' });
  if ([...jobs.values()].some(j => j.status === 'running')) return res.status(409).json({ error: '진행 중인 이미지 생성이 끝난 뒤 시도해 주세요' });
  const id = crypto.randomUUID(); const controller = new AbortController();
  const job = { id, status: 'running', message: '이미지 생성을 준비하고 있어요', controller, createdAt: Date.now() }; jobs.set(id, job);
  const timer = setTimeout(() => controller.abort(), 10 * 60 * 1000);
  const generate = settings.provider === 'comfy' ? comfyGenerate : settings.provider === 'codex' ? codexGenerate : compatibleGenerate;
  generate({ settings, prompt, reference }, controller.signal, message => { job.message = message; })
    .then(image => { job.status = 'complete'; job.image = image; job.message = '이미지가 준비됐어요'; })
    .catch(error => { job.status = controller.signal.aborted ? 'cancelled' : 'error'; job.message = controller.signal.aborted ? '생성을 취소했거나 제한 시간 10분을 초과했어요' : error.message; })
    .finally(() => { clearTimeout(timer); delete job.controller; setTimeout(() => jobs.delete(id), 15 * 60 * 1000).unref(); });
  res.status(202).json({ id });
});
app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id); if (!job) return res.status(404).json({ error: '생성 작업이 만료됐어요. 다시 생성해 주세요' });
  const { controller, ...safe } = job; res.json(safe);
});
app.post('/api/jobs/:id/cancel', (req, res) => { const job = jobs.get(req.params.id); job?.controller?.abort(); res.json({ ok: true }); });
app.get('/api/train/info', (req, res) => { res.json(checkModalCli()); });
app.get('/api/train/status', (req, res) => { res.json(getModalTrainingJob()); });
app.post('/api/train/start', async (req, res) => {
  try {
    const { project, slots } = req.body;
    if (!project || typeof project !== 'object') return res.status(400).json({ error: '프로젝트 정보가 필요합니다.' });
    res.json(await startModalTraining({ project, slots }));
  } catch (error) { res.status(400).json({ error: error.message }); }
});
app.post('/api/train/cancel', (req, res) => { res.json(cancelModalTraining()); });
app.get('/api/train/output/:filename', (req, res) => {
  const file = getOutputFileStream(req.params.filename);
  if (!file) return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
  res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', file.size);
  file.stream.pipe(res);
});
app.use('/api', (req, res) => res.status(404).json({ error: '지원하는 API 경로를 확인해 주세요' }));
if (production) { app.use(express.static(path.join(root, 'dist'))); app.get('/{*path}', (req, res) => res.sendFile(path.join(root, 'dist/index.html'))); }
else { const { createServer: createViteServer } = await import('vite'); const vite = await createViteServer({ root, server: { middlewareMode: true }, appType: 'spa' }); app.use(vite.middlewares); }
app.use((error, req, res, next) => { res.status(400).json({ error: '요청 형식과 파일 크기를 확인해 주세요' }); });
app.listen(port, '127.0.0.1', () => console.log(`Personas 작업실 http://localhost:${port} (${production ? 'production' : 'development'})`));
