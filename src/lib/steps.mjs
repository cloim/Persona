import { readiness } from './dataset.mjs';

export const TRIGGER_PATTERN = /^[a-zA-Z0-9_-]{2,64}$/;

export const STEPS = [
  { key: 'setup', path: '/setup', label: '프로젝트 설정', short: '설정', icon: 'Fingerprint' },
  { key: 'dataset', path: '/dataset', label: '이미지셋', short: '이미지', icon: 'LayoutGrid' },
  { key: 'captions', path: '/captions', label: '캡셔닝', short: '캡션', icon: 'Tags' },
  { key: 'training', path: '/training', label: '학습', short: '학습', icon: 'Sprout' },
  { key: 'deploy', path: '/deploy', label: '모델 배포', short: '배포', icon: 'Rocket' },
];

export function trainingPercent(project, job) {
  const total = Number(job?.steps) || Number(project?.training?.steps) || 0;
  const current = Number(job?.currentStep) || 0;
  return total && current ? Math.min(100, Math.round((current / total) * 100)) : 0;
}

export function stepStatus(project, job) {
  const ready = readiness(project);
  const setupDone = TRIGGER_PATTERN.test(project.trigger || '')
    && String(project.name || '').trim().length > 0
    && Boolean(project.reference || String(project.identity || '').trim());
  const running = job?.status === 'running' || job?.status === 'cancelling';
  const trained = Boolean(project.lora?.file);
  let trainingDetail = '대기';
  if (running) trainingDetail = `학습 중 ${trainingPercent(project, job)}%`;
  else if (trained) trainingDetail = '완료';
  return {
    setup: { done: setupDone, detail: setupDone ? project.trigger : '기본 정보 입력' },
    dataset: { done: ready.complete, detail: `${ready.filled} / ${ready.total}장` },
    captions: { done: ready.reviewed === ready.total, detail: `${ready.reviewed} / ${ready.total} 확인` },
    training: { done: trained, detail: trainingDetail },
    deploy: { done: false, detail: project.lora ? '다운로드 가능' : '학습 후 사용' },
  };
}

export function firstIncompleteStep(status) {
  const step = STEPS.find(item => !status[item.key]?.done);
  return step ? step.path : '/deploy';
}
