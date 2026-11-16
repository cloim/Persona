import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { existsSync, mkdirSync, writeFileSync, rmSync, readdirSync, statSync, createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'output');
const tempDir = path.join(root, '.cache', 'modal_train');

if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });

let activeJob = null;
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

export function getModalTrainingJob() {
  if (activeJob && (activeJob.status === 'running' || activeJob.status === 'cancelling')) {
    const { process: _proc, ...info } = activeJob;
    return info;
  }

  const external = detectRunningExternalModalApp();
  if (external) {
    return external;
  }

  if (!activeJob) return { status: 'idle' };
  const { process: _proc, ...info } = activeJob;
  return info;
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
        const files = readdirSync(outputDir)
          .filter(f => f.endsWith('.safetensors'))
          .map(f => {
            const stat = statSync(path.join(outputDir, f));
            return { name: f, time: stat.mtimeMs, size: stat.size };
          })
          .sort((a, b) => b.time - a.time);

        if (files.length > 0) {
          job.outputFile = files[0].name;
          job.outputSize = files[0].size;
          job.logs.push(`[시스템] 결과 파일: ${files[0].name} (${(files[0].size / 1024 / 1024).toFixed(1)} MB)`);
        }
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
  const filePath = path.join(outputDir, safeFilename);
  if (!existsSync(filePath)) {
    return null;
  }
  const stat = statSync(filePath);
  return {
    stream: createReadStream(filePath),
    size: stat.size,
    name: safeFilename,
  };
}
