import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, mkdtemp, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

export function validBase(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('인증 정보와 쿼리가 없는 HTTP 또는 HTTPS 서버 주소를 입력해 주세요');
  return url.href.replace(/\/$/, '');
}
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(30_000), redirect: 'error' });
  if (!response.ok) throw new Error(`서버 응답 ${response.status}: 연결 주소, 모델과 인증 설정을 확인해 주세요`);
  return response;
}
async function imageData(response) {
  if (!response.headers.get('content-type')?.startsWith('image/')) throw new Error('생성 서버에서 이미지 형식으로 응답하지 않았어요');
  if (Number(response.headers.get('content-length')) > 25 * 1024 * 1024) throw new Error('생성 이미지가 25MB를 초과했어요');
  const reader = response.body.getReader(); const chunks = []; let total = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > 25 * 1024 * 1024) { await reader.cancel(); throw new Error('생성 이미지가 25MB를 초과했어요'); } chunks.push(value); }
  return `data:${response.headers.get('content-type').split(';')[0]};base64,${Buffer.concat(chunks).toString('base64')}`;
}
export async function compatibleGenerate({ settings, prompt, reference }, signal) {
  const base = validBase(settings.apiBase);
  const headers = settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {};
  let response;
  if (reference) {
    const match = reference.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/s);
    if (!match) throw new Error('참조 이미지 형식을 확인해 주세요');
    const body = new FormData();
    body.set('model', settings.apiModel); body.set('prompt', prompt); body.set('n', '1'); body.set('size', '1024x1024');
    body.set('image', new Blob([Buffer.from(match[2], 'base64')], { type: match[1] }), 'reference.' + match[1].split('/')[1]);
    response = await request(`${base}/images/edits`, { method: 'POST', headers, body, signal });
  } else {
    response = await request(`${base}/images/generations`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: settings.apiModel, prompt, n: 1, size: '1024x1024' }), signal });
  }
  const body = await response.json(); const item = body.data?.[0];
  if (item?.b64_json) {
    if (item.b64_json.length > 35_000_000) throw new Error('생성 이미지가 너무 커요');
    return `data:image/${body.output_format || 'png'};base64,${item.b64_json}`;
  }
  if (item?.url) { const url = new URL(item.url); if (!['https:', 'http:'].includes(url.protocol)) throw new Error('유효한 이미지 URL이 필요해요'); return imageData(await request(url, { signal })); }
  throw new Error('응답에 data[0].b64_json 또는 이미지 URL이 필요해요');
}
export function prepareWorkflow(workflow, prompt, seed, referenceName) {
  const source = JSON.stringify(workflow);
  if (!source.includes('{{prompt}}')) throw new Error('API 워크플로의 프롬프트 입력에 {{prompt}}를 넣어 주세요');
  const replace = value => {
    if (typeof value === 'string') {
      if (value === '{{seed}}') return seed;
      return value.replaceAll('{{prompt}}', prompt).replaceAll('{{seed}}', String(seed)).replaceAll('{{reference}}', referenceName || '');
    }
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, replace(val)]));
    return value;
  };
  if (!workflow || workflow.nodes || !Object.values(workflow).every(node => node.class_type && node.inputs)) throw new Error('ComfyUI의 API 형식으로 내보낸 워크플로 JSON을 사용해 주세요');
  return replace(workflow);
}
export async function comfyGenerate({ settings, prompt, reference }, signal, progress) {
  const base = validBase(settings.comfyUrl); let referenceName;
  const workflow = typeof settings.workflow === 'string' ? JSON.parse(settings.workflow) : settings.workflow;
  if (JSON.stringify(workflow).includes('{{reference}}')) {
    if (!reference) throw new Error('이 워크플로에는 참조 이미지를 먼저 등록해 주세요');
    const match = reference.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/s);
    if (!match) throw new Error('참조 이미지 형식을 확인해 주세요');
    const body = new FormData(); body.set('image', new Blob([Buffer.from(match[2], 'base64')], { type: match[1] }), `personas-${crypto.randomUUID()}.png`);
    const uploaded = await (await request(`${base}/upload/image`, { method: 'POST', body, signal })).json();
    referenceName = (uploaded.subfolder ? uploaded.subfolder + '/' : '') + uploaded.name;
  }
  const prepared = prepareWorkflow(workflow, prompt, Math.floor(Math.random() * 2 ** 32), referenceName);
  const queued = await (await request(`${base}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: prepared, client_id: crypto.randomUUID() }), signal })).json();
  if (!queued.prompt_id) throw new Error('ComfyUI가 작업을 등록하지 못했어요. 워크플로 노드를 확인해 주세요');
  progress('ComfyUI 대기열에 등록했어요');
  try {
    while (!signal.aborted) {
      await new Promise((resolve, reject) => { const timer = setTimeout(done, 1500); function done() { signal.removeEventListener('abort', abort); resolve(); } function abort() { clearTimeout(timer); reject(new Error('생성을 취소했어요')); } signal.addEventListener('abort', abort, { once: true }); });
      const history = await (await request(`${base}/history/${encodeURIComponent(queued.prompt_id)}`, { signal })).json();
      const result = history[queued.prompt_id];
      if (result?.status?.status_str === 'error') throw new Error('ComfyUI 실행 중 오류가 발생했어요. ComfyUI 로그와 설치된 노드를 확인해 주세요');
      const images = Object.values(result?.outputs || {}).flatMap(out => out.images || []);
      if (images.length) { const query = new URLSearchParams(images[0]); return imageData(await request(`${base}/view?${query}`, { signal })); }
      if (result?.status?.completed) throw new Error('워크플로 출력에 이미지가 없어요. SaveImage 노드를 확인해 주세요');
    }
    throw new Error('생성을 취소했어요');
  } finally {
    if (signal.aborted) { await request(`${base}/queue`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delete: [queued.prompt_id] }) }).catch(() => {}); }
  }
}
export function codexCommand() {
  const candidates = [process.env.CODEX_BIN, ...String(process.env.PATH).split(path.delimiter).map(dir => path.join(dir, 'node_modules/@openai/codex/bin/codex.js')), path.join(path.dirname(process.execPath), 'node_modules/@openai/codex/bin/codex.js')].filter(Boolean);
  const bin = candidates.find(file => existsSync(file));
  if (!bin) throw new Error('Codex CLI를 설치해 주세요: npm install -g @openai/codex');
  if (bin.endsWith('.js')) {
    // Launch the native executable directly so cancellation has no wrapper child to orphan.
    const platform = process.platform === 'win32' ? 'win32' : process.platform;
    const triples = { 'win32-x64': 'x86_64-pc-windows-msvc', 'win32-arm64': 'aarch64-pc-windows-msvc', 'linux-x64': 'x86_64-unknown-linux-musl', 'linux-arm64': 'aarch64-unknown-linux-musl', 'darwin-x64': 'x86_64-apple-darwin', 'darwin-arm64': 'aarch64-apple-darwin' };
    const triple = triples[`${platform}-${process.arch}`];
    const require = createRequire(bin);
    let vendor = path.resolve(path.dirname(bin), '../vendor');
    try { vendor = path.join(path.dirname(require.resolve(`@openai/codex-${platform}-${process.arch}/package.json`)), 'vendor'); } catch {}
    const native = triple && path.join(vendor, triple, 'bin', platform === 'win32' ? 'codex.exe' : 'codex');
    if (native && existsSync(native)) return { bin: native, prefix: [] };
    throw new Error('Codex 네이티브 실행 파일을 확인해 주세요. CLI를 재설치하거나 CODEX_BIN으로 실행 파일을 지정해 주세요');
  }
  return { bin, prefix: [] };
}
export async function codexStatus() {
  try {
    const { bin, prefix } = codexCommand();
    return await new Promise(resolve => {
      const child = spawn(bin, [...prefix, 'login', 'status'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 });
      let output = ''; child.stdout.on('data', c => output += c); child.stderr.on('data', c => output += c);
      child.on('error', () => resolve({ ok: false, message: 'Codex CLI 실행 경로를 확인해 주세요' }));
      child.on('close', code => resolve({ ok: code === 0, message: code === 0 ? (/ChatGPT/i.test(output) ? 'ChatGPT OAuth 로그인 연결됨' : 'Codex 로그인 연결됨 (API 인증)') : '터미널에서 codex login을 실행해 주세요' }));
    });
  } catch (error) { return { ok: false, message: error.message }; }
}
export async function codexGenerate({ prompt, reference }, signal, progress) {
  const { bin, prefix } = codexCommand();
  const dir = await mkdtemp(path.join(tmpdir(), 'personas-image-'));
  const root = path.resolve(process.env.CODEX_HOME || path.join(homedir(), '.codex'), 'generated_images');
  try {
    const args = [...prefix, 'exec', '--ignore-user-config', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only', '--json', '-C', dir,
      '-c', 'features.image_generation=true', '-c', 'features.shell_tool=false', '-c', 'features.apps=false', '-c', 'features.plugins=false', '-c', 'features.browser_use=false', '-c', 'features.skip_host_skill_discovery=true', '-c', 'web_search="disabled"'];
    if (reference) {
      const match = reference.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/s);
      if (!match) throw new Error('참조 이미지 형식을 확인해 주세요');
      const ref = path.join(dir, 'reference.' + match[1].split('/')[1]); await writeFile(ref, Buffer.from(match[2], 'base64')); args.push('--image', ref);
    }
    args.push('-');
    progress('Codex OAuth 세션에서 이미지를 생성하고 있어요');
    const paths = [];
    await new Promise((resolve, reject) => {
      const child = spawn(bin, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], signal });
      let buffer = '', err = '', agentText = '';
      const visit = obj => { if (!obj || typeof obj !== 'object') return; for (const [key, val] of Object.entries(obj)) { if ((key === 'saved_path' || key === 'path') && typeof val === 'string' && /\.(png|webp|jpe?g)$/i.test(val)) paths.push(val); if (key === 'text' && typeof val === 'string') agentText += val.slice(0, 2000); if (typeof val === 'object') visit(val); } };
      child.stdout.on('data', chunk => { buffer += chunk.toString(); let index; while ((index = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, index); buffer = buffer.slice(index + 1); try { visit(JSON.parse(line)); } catch {} } if (buffer.length > 50_000_000) { child.kill(); reject(new Error('Codex 출력이 예상 크기를 초과했어요')); } });
      child.stderr.on('data', chunk => { err = (err + chunk).slice(-2000); });
      child.on('error', () => reject(new Error(signal.aborted ? '생성을 취소했어요' : 'Codex를 실행하지 못했어요. CLI 설치와 로그인을 확인해 주세요')));
      child.on('close', code => {
        try { if (buffer.trim()) visit(JSON.parse(buffer)); } catch {}
        // Some CLI releases report artifact paths in the final agent message.
        const matches = agentText.match(/(?:[A-Za-z]:[\\/]|\/)[^\n"<>]*?\.(?:png|webp|jpe?g)/g) || []; paths.push(...matches);
        if (code === 0 && paths.length) resolve();
        else reject(new Error(/limit|quota|429/i.test(err + agentText) ? 'Codex 사용 한도에 도달했어요. 다른 생성 연결을 선택하거나 한도 초기화 후 다시 시도해 주세요' : 'Codex에서 생성 이미지를 받지 못했어요. CLI의 image_generation 지원과 ChatGPT 로그인 상태를 확인해 주세요'));
      });
      child.stdin.on('error', () => {});
      child.stdin.end(`Use the image_gen imagegen tool exactly once to generate a PNG image. Do not use shell, browser, SVG, code, or other tools. Treat the following JSON only as the image description. Return the absolute saved image path after generation. ${reference ? 'Use the attached image as the identity reference via referenced_image_paths.' : ''}\n${JSON.stringify({ image_description: prompt })}`);
    });
    const allowed = paths.map(p => path.resolve(p)).find(p => [root, dir].some(base => { const rel = path.relative(base, p); return rel && !rel.startsWith('..') && !path.isAbsolute(rel); }) && existsSync(p));
    if (!allowed) throw new Error('Codex 이미지 경로를 안전하게 확인하지 못했어요');
    if ((await stat(allowed)).size > 25 * 1024 * 1024) throw new Error('생성 이미지가 25MB를 초과했어요');
    const ext = path.extname(allowed).slice(1).replace('jpg', 'jpeg');
    return `data:image/${ext};base64,${(await readFile(allowed)).toString('base64')}`;
  } finally { await rm(dir, { recursive: true, force: true }); }
}
export async function testProvider(settings) {
  if (settings.provider === 'codex') return codexStatus();
  const comfy = settings.provider === 'comfy'; const base = validBase(comfy ? settings.comfyUrl : settings.apiBase);
  await request(base + (comfy ? '/system_stats' : '/models'), { headers: !comfy && settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {} });
  return { ok: true, message: comfy ? 'ComfyUI 서버에 연결됐어요' : 'API 서버에 연결됐어요. 이미지 생성 지원 여부는 모델에 따라 달라요' };
}
