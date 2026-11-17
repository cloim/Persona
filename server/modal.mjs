import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, statSync, createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deployLora, rescanLoraManager } from './deploy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultLoraDir = existsSync('/comfy-data/models/loras') ? '/comfy-data/models/loras' : path.join(root, 'output');
const outputDir = process.env.LORA_DIR || defaultLoraDir;
const loraViewDir = process.env.LORA_VIEW_DIR || '/data/models-view/loras';
const tempDir = process.env.TEMP_TRAIN_DIR || (existsSync('/data') ? '/data/modal_train' : path.join(root, '.cache', 'modal_train'));

if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });

let activeJob = null;
// 학습을 시작한 프로젝트의 배포용 정보(참조 이미지 포함). 상태 응답에는 포함하지 않는다
let activeDeployProject = null;
let externalJobCache = { time: 0, data: null };

function detectRunningExternalModalApp() {
  const now = Date.now();
  if (externalJobCache.data && now - externalJobCache.time < 2000) {
    return externalJobCache.data;
  }

  try {
    const r = spawnSync('modal', ['app', 'list', '--json'], { shell: true, encoding: 'utf-8', timeout: 5000 });
    if (r.status !== 0 || !r.stdout) return null;

    const jsonStart = r.stdout.indexOf('[');
    if (jsonStart === -1) return null;

    const apps = JSON.parse(r.stdout.slice(jsonStart));
    const running = apps.find(a => a.description?.includes('persona') && a.state === 'ephemeral' && !a.stopped_at);
    if (!running) {
      externalJobCache = { time: now, data: null };
      return null;
    }

    const logRes = spawnSync('modal', ['app', 'logs', running.app_id, '--tail', '80'], { shell: true, encoding: 'utf-8', timeout: 6000 });
    const rawLines = logRes.stdout ? logRes.stdout.split(/\r?\n/).filter(l => l.trim().length > 0 && !l.includes('DeprecationWarning')) : [];

    let currentStep = 0;
    let steps = 1000;
    let loss = null;

    for (const line of rawLines) {
      const match = line.match(/(?:step|Step)?\s*(\d+)%\s*\|\s*[^|]+\|\s*(\d+)\/(\d+).*?loss:\s*([0-9.eE+-]+)/i);
      if (match) {
        currentStep = parseInt(match[2], 10);
        steps = parseInt(match[3], 10);
        const l = parseFloat(match[4]);
        if (!isNaN(l)) loss = Number(l < 1 ? l.toFixed(4) : l.toExponential(3));
      } else {
        const stepMatch = line.match(/(?:step|Step)\s*[:=]?\s*(\d+)(?:\s*\/\s*(\d+))?/i);
        if (stepMatch && stepMatch[1]) {
          const s = parseInt(stepMatch[1], 10);
          if (!isNaN(s) && s > currentStep) currentStep = s;
          if (stepMatch[2]) steps = parseInt(stepMatch[2], 10);
        }
        const lossMatch = line.match(/loss\s*[:=]?\s*([0-9.eE+-]+)/i);
        if (lossMatch && lossMatch[1]) {
          const l = parseFloat(lossMatch[1]);
          if (!isNaN(l)) loss = Number(l < 1 ? l.toFixed(4) : l.toExponential(3));
        }
      }
    }

    const job = {
      id: running.app_id,
      status: 'running',
      isExternal: true,
      trigger: running.description,
      modelId: running.description.includes('krea') ? 'krea2' : running.description.includes('moss') ? 'moss' : running.description.includes('qwen') ? 'qwen21' : 'flux1dev',
      steps,
      currentStep,
      loss,
      startedAt: new Date(running.created_at).getTime(),
      completedAt: null,
      logs: rawLines,
      outputFile: null,
      outputSize: null,
    };

    externalJobCache = { time: now, data: job };
    return job;
  } catch {
    return null;
  }
}

export async function deployTrainedLora(file, project) {
  const result = await deployLora({ loraDir: outputDir, viewDir: loraViewDir, file, project });
  result.rescanned = await rescanLoraManager(process.env.COMFY_URL, result.metadata);
  return result;
}

// 학습 완료 직후 결과 파일을 모델 폴더로 옮기고 미리보기와 메타데이터를 채운다
function autoDeploy(job) {
  if (!job.outputFile || job.deployed || !activeDeployProject || !job.outputFile.startsWith(job.trigger)) return;
  job.deployed = { pending: true };
  deployTrainedLora(job.outputFile, activeDeployProject)
    .then(result => {
      job.deployed = { folder: result.folder, preview: result.preview, previewHash: result.previewHash, at: Date.now() };
      job.logs.push(`[시스템] ComfyUI 배포 완료: loras/${result.folder}/${result.file}${result.preview ? ' · 예시 이미지 등록' : ''}`);
    })
    .catch(err => {
      job.deployed = null;
      job.logs.push(`[경고] ComfyUI 배포 중 오류: ${err.message}`);
    });
}

export function checkModalCli() {
  try {
    const ver = spawnSync('modal', ['--version'], { shell: true, encoding: 'utf-8', timeout: 5000 });
    if (ver.status !== 0) return { available: false, error: 'modal CLI가 설치되어 있지 않습니다.' };
    const verMatch = ver.stdout.match(/modal client version:\s*([^\s]+)/i);
    const version = verMatch ? verMatch[1] : 'installed';

    let profile = '';
    const prof = spawnSync('modal', ['profile', 'list'], { shell: true, encoding: 'utf-8', timeout: 5000 });
    if (prof.status === 0) {
      const match = prof.stdout.match(/•\s+([^\s]+)/);
      if (match) profile = match[1];
    }
    return { available: true, version, profile };
  } catch (err) {
    return { available: false, error: err.message };
  }
}

function findLatestSafetensors(dir) {
  if (!existsSync(dir)) return [];
  const results = [];
  function scan(currentDir) {
    try {
      const entries = readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isFile() && entry.name.endsWith('.safetensors')) {
          const stat = statSync(fullPath);
          results.push({ name: entry.name, path: fullPath, time: stat.mtimeMs, size: stat.size });
        } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
          scan(fullPath);
        }
      }
    } catch {}
  }
  scan(dir);
  return results.sort((a, b) => b.time - a.time);
}

function findSafetensorsFile(dir, targetName) {
  if (!existsSync(dir)) return null;
  const direct = path.join(dir, targetName);
  if (existsSync(direct)) return direct;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === targetName) return fullPath;
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const sub = findSafetensorsFile(fullPath, targetName);
        if (sub) return sub;
      }
    }
  } catch {}
  return null;
}

export function getModalTrainingJob(trigger) {
  if (activeJob && (activeJob.status === 'running' || activeJob.status === 'cancelling')) {
    const { process: _proc, ...info } = activeJob;
    return info;
  }

  const external = detectRunningExternalModalApp();
  if (external) {
    return external;
  }

  if (activeJob) {
    if (activeJob.status === 'completed' && !activeJob.outputFile) {
      const files = findLatestSafetensors(outputDir);
      if (files.length > 0) {
        const matched = files.find(f => activeJob.trigger && f.name.includes(activeJob.trigger)) || files[0];
        activeJob.outputFile = matched.name;
        activeJob.outputSize = matched.size;
        activeJob.logs.push(`[시스템] 결과 파일 확인 완료: ${matched.name} (${(matched.size / 1024 / 1024).toFixed(1)} MB)`);
      } else if (activeJob.trigger) {
        try {
          const loraName = `${activeJob.trigger}_krea2.safetensors`;
          const target = path.join(outputDir, loraName);
          const dl = spawnSync('modal', ['volume', 'get', 'persona-output', `${activeJob.trigger}_krea2/${loraName}`, target], { shell: true, timeout: 60000 });
          if (dl.status === 0 && existsSync(target)) {
            const stat = statSync(target);
            activeJob.outputFile = loraName;
            activeJob.outputSize = stat.size;
            activeJob.logs.push(`[시스템] Modal Volume에서 결과 파일 자동 수신 완료: ${loraName} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
          }
        } catch {}
      }
    }
    if (activeJob.status === 'completed') autoDeploy(activeJob);
    const { process: _proc, ...info } = activeJob;
    return info;
  }

  // activeJob이 없을 때(새로고침/재시작): 디스크 상태 또는 최근 완료된 LoRA 파일 복구
  try {
    const jobStateFile = path.join(tempDir, 'last_train_job.json');
    if (existsSync(jobStateFile)) {
      const saved = JSON.parse(readFileSync(jobStateFile, 'utf-8'));
      if (saved && (!trigger || saved.trigger === trigger)) {
        return saved;
      }
    }
  } catch {}

  const files = findLatestSafetensors(outputDir);
  if (files.length > 0) {
    const matched = trigger ? files.find(f => f.name.includes(trigger)) : files[0];
    if (matched) {
      return {
        status: 'completed',
        trigger: trigger || matched.name.split('_')[0],
        outputFile: matched.name,
        outputSize: matched.size,
        completedAt: matched.time,
        modelId: 'krea2',
        currentStep: 1000,
        steps: 1000,
        logs: [`[시스템] 완성된 LoRA 모델 파일이 준비되었습니다: ${matched.name}`]
      };
    }
  }

  return { status: 'idle' };
}

export function cancelModalTraining() {
  const current = (activeJob && (activeJob.status === 'running' || activeJob.status === 'cancelling')) ? activeJob : detectRunningExternalModalApp();
  if (!current || current.status !== 'running') {
    return { ok: false, message: '진행 중인 학습 작업이 없습니다.' };
  }

  if (current.isExternal) {
    try {
      spawnSync('modal', ['app', 'stop', '-y', current.id], { shell: true, timeout: 8000 });
      externalJobCache = { time: 0, data: null };
      return { ok: true, message: '외부 Modal 앱을 중지했습니다.' };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }

  activeJob.status = 'cancelling';
  activeJob.logs.push('[시스템] 사용자에 의해 학습이 취소되었습니다.');
  if (activeJob.process && activeJob.process.pid) {
    try {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(activeJob.process.pid), '/T', '/F']);
      } else {
        activeJob.process.kill('SIGINT');
      }
    } catch {
      // ignore
    }
  }
  return { ok: true };
}

export async function startModalTraining({ project, slots }) {
  if (activeJob && (activeJob.status === 'running' || activeJob.status === 'cancelling')) {
    throw new Error('이미 실행 중인 Modal 학습 작업이 있습니다.');
  }

  const cliCheck = checkModalCli();
  if (!cliCheck.available) {
    throw new Error(`Modal CLI를 실행할 수 없습니다: ${cliCheck.error}`);
  }

  const trigger = (project.trigger || 'character').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'character';
  const modelId = project.model || 'krea2';
  const t = project.training || {};
  const steps = Number(t.steps) || 1000;
  const rank = Number(t.rank) || 8;
  const lr = Number(t.learningRate) || 0.0001;

  const validSlots = (slots || project.slots || []).filter(s => s.image && s.caption && s.caption.trim());
  if (validSlots.length === 0) {
    throw new Error('학습에 사용할 등록된 이미지와 캡션이 없습니다.');
  }

  const jobId = `train_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const datasetJobDir = path.join(tempDir, jobId);
  mkdirSync(datasetJobDir, { recursive: true });

  // 1. 임시 데이터셋 폴더에 이미지와 TXT 저장
  validSlots.forEach((slot, idx) => {
    const num = String(idx + 1).padStart(3, '0');
    const ext = (slot.image.type || 'image/png').split('/')[1]?.replace('jpeg', 'jpg') || 'png';
    const baseName = `${trigger}_${num}`;

    // 이미지 바이너리 저장
    const b64Data = slot.image.data.split(',')[1];
    if (b64Data) {
      writeFileSync(path.join(datasetJobDir, `${baseName}.${ext}`), Buffer.from(b64Data, 'base64'));
    }
    // 캡션 txt 저장
    writeFileSync(path.join(datasetJobDir, `${baseName}.txt`), slot.caption.trim() + '\n', 'utf-8');
  });

  const charaName = trigger ? trigger.replace(/[^a-zA-Z0-9_-]/g, '_') : 'character';
  const isKrea2 = modelId === 'krea2';
  const scriptPath = isKrea2
    ? path.join(root, 'scripts', 'modal_train_krea2.py')
    : path.join(root, 'scripts', 'modal_train.py');

  const epochs = Math.max(1, Math.round(steps / (validSlots.length || 36)));

  const args = isKrea2
    ? [
        'run',
        scriptPath,
        '--name', charaName,
        '--dataset-dir', datasetJobDir,
        '--trigger-word', trigger,
        '--epochs', String(epochs),
        '--rank', String(rank || 32),
        '--lr', String(lr || 0.0005),
      ]
    : [
        'run',
        scriptPath,
        '--dataset-dir', datasetJobDir,
        '--model', modelId,
        '--trigger', trigger,
        '--steps', String(steps),
        '--rank', String(rank),
        '--lr', String(lr),
        '--output-dir', outputDir,
      ];

  const job = {
    id: jobId,
    status: 'running',
    trigger,
    modelId,
    steps,
    currentStep: 0,
    loss: null,
    startedAt: Date.now(),
    completedAt: null,
    logs: [
      `[시스템] Modal A10G 클라우드 학습을 시작합니다. (트리거: ${trigger}, 모델: ${modelId}, 스텝: ${steps})`,
      `[시스템] 데이터셋 준비 완료: 이미지 ${validSlots.length}장 및 TXT 캡션.`,
      `[시스템] 실행 명령: modal ${args.join(' ')}`,
    ],
    outputFile: null,
    outputSize: null,
    process: null,
  };

  activeJob = job;
  activeDeployProject = { name: project.name, trigger: project.trigger, model: modelId, identity: project.identity, reference: project.reference, training: { steps, rank } };

  const child = spawn('modal', args, {
    shell: true,
    cwd: root,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });

  job.process = child;

  const handleOutput = data => {
    const text = data.toString('utf-8');
    const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);

    for (const rawLine of lines) {
      const line = rawLine.replace(/hf_[A-Za-z0-9]+/g, '[HF_TOKEN]');
      job.logs.push(line);
      if (job.logs.length > 800) job.logs.shift();

      // 스텝 및 Loss 파싱 예: "Step 120/1000", "step: 120", "loss: 0.1234" 등
      const stepMatch = line.match(/(?:step|Step)\s*[:=]?\s*(\d+)(?:\s*\/\s*(\d+))?/i);
      if (stepMatch && stepMatch[1]) {
        const cur = parseInt(stepMatch[1], 10);
        if (!isNaN(cur) && cur <= steps) job.currentStep = cur;
      }
      const lossMatch = line.match(/(?:loss|Loss)\s*[:=]?\s*([0-9.]+)/i);
      if (lossMatch && lossMatch[1]) {
        const l = parseFloat(lossMatch[1]);
        if (!isNaN(l)) job.loss = Number(l.toFixed(4));
      }
    }
  };

  child.stdout.on('data', handleOutput);
  child.stderr.on('data', handleOutput);

  child.on('close', code => {
    job.completedAt = Date.now();
    try {
      rmSync(datasetJobDir, { recursive: true, force: true });
    } catch {
      // ignore
    }

    if (job.status === 'cancelling') {
      job.status = 'cancelled';
      job.logs.push('[시스템] 학습 작업이 취소되었습니다.');
      return;
    }

    if (code === 0) {
      job.status = 'completed';
      job.currentStep = steps;
      job.logs.push('[시스템] 원격 학습 및 로컬 동기화가 성공적으로 완료되었습니다!');

      // 출력 폴더에서 가장 최신의 safetensors 검색
      try {
        let files = findLatestSafetensors(outputDir);
        if (files.length === 0 && trigger) {
          try {
            const loraName = `${trigger}_krea2.safetensors`;
            const target = path.join(outputDir, loraName);
            spawnSync('modal', ['volume', 'get', 'persona-output', `${trigger}_krea2/${loraName}`, target], { shell: true, timeout: 60000 });
            files = findLatestSafetensors(outputDir);
          } catch {}
        }

        if (files.length > 0) {
          const matched = files.find(f => trigger && f.name.includes(trigger)) || files[0];
          job.outputFile = matched.name;
          job.outputSize = matched.size;
          job.logs.push(`[시스템] 결과 파일: ${matched.name} (${(matched.size / 1024 / 1024).toFixed(1)} MB)`);
          autoDeploy(job);
        }

        try {
          const jobStateFile = path.join(tempDir, 'last_train_job.json');
          writeFileSync(jobStateFile, JSON.stringify({
            id: jobId,
            status: 'completed',
            trigger,
            modelId,
            steps,
            currentStep: steps,
            loss: job.loss,
            outputFile: job.outputFile,
            outputSize: job.outputSize,
            completedAt: job.completedAt || Date.now(),
            logs: job.logs.slice(-30),
          }), 'utf-8');
        } catch {}
      } catch (err) {
        job.logs.push(`[경고] 결과 파일 확인 중 오류: ${err.message}`);
      }
    } else {
      job.status = 'failed';
      job.logs.push(`[시스템] 학습 실패 (프로세스 종료 코드: ${code})`);
    }
  });

  child.on('error', err => {
    job.status = 'failed';
    job.completedAt = Date.now();
    job.logs.push(`[오류] 프로세스 실행 오류: ${err.message}`);
    try {
      rmSync(datasetJobDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  return { jobId, status: 'running' };
}

export function getOutputFileStream(filename) {
  const safeFilename = path.basename(filename);
  const filePath = findSafetensorsFile(outputDir, safeFilename);
  if (!filePath || !existsSync(filePath)) {
    return null;
  }
  const stat = statSync(filePath);
  return {
    stream: createReadStream(filePath),
    size: stat.size,
    name: safeFilename,
  };
}
