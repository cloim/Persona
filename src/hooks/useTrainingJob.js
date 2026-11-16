import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.mjs';

const POLL_MS = 2500;
const isActive = status => status === 'running' || status === 'cancelling';
const TRAINING_PROJECT_KEY = 'persona-training-project';

// 이 브라우저에서 학습을 시작한 프로젝트 ID. 외부 CLI 실행처럼 기록이 없으면 null
export function trainingProjectId() {
  try { return localStorage.getItem(TRAINING_PROJECT_KEY); } catch { return null; }
}

function resizeImageIfLarge(dataUrl, maxDim = 1280, quality = 0.9) {
  return new Promise(resolve => {
    if (typeof Image === 'undefined' || typeof document === 'undefined') return resolve(dataUrl);
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width <= maxDim && height <= maxDim) return resolve(dataUrl);
      if (width > height) {
        height = Math.round((height * maxDim) / width);
        width = maxDim;
      } else {
        width = Math.round((width * maxDim) / height);
        height = maxDim;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

async function prepareSlotsForTraining(slots) {
  const valid = (slots || []).filter(s => s.image && s.caption && s.caption.trim());
  return Promise.all(valid.map(async s => {
    let data = s.image.data;
    let type = s.image.type || 'image/jpeg';
    if (data && typeof data === 'string' && data.startsWith('data:image/')) {
      try {
        const resized = await resizeImageIfLarge(data, 1280, 0.9);
        if (resized !== data) {
          data = resized;
          type = 'image/jpeg';
        }
      } catch {
        // 원본 유지
      }
    }
    return {
      id: s.id,
      caption: s.caption.trim(),
      image: { data, type }
    };
  }));
}

export default function useTrainingJob(notify, trigger) {
  const [job, setJob] = useState({ status: 'idle' });
  const [cliInfo, setCliInfo] = useState(null);
  const previous = useRef('idle');
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  const apply = useCallback(next => {
    const before = previous.current;
    previous.current = next.status;
    if (isActive(before) && next.status === 'completed') notifyRef.current('Modal 클라우드 학습이 완료됐어요. LoRA 파일을 배포 단계에서 내려받을 수 있어요');
    else if (isActive(before) && next.status === 'failed') notifyRef.current('학습 실행 중 오류가 발생했어요. 로그를 확인해 주세요', true);
    setJob(next);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const url = trigger ? `/api/train/status?trigger=${encodeURIComponent(trigger)}` : '/api/train/status';
      const next = await api(url);
      apply(next);
      return next;
    } catch {
      return { status: 'idle' };
    }
  }, [apply, trigger]);

  useEffect(() => {
    api('/api/train/info').then(setCliInfo).catch(() => setCliInfo({ available: false }));
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!isActive(job.status)) return undefined;
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [job.status, refresh]);

  const start = useCallback(async project => {
    try {
      notifyRef.current('학습용 데이터셋을 준비하고 있어요...');
      const cleanSlots = await prepareSlotsForTraining(project.slots);
      const { slots: _omitted, ...projectMeta } = project;
      await api('/api/train/start', { project: projectMeta, slots: cleanSlots });
      try { localStorage.setItem(TRAINING_PROJECT_KEY, project.id); } catch {}
      notifyRef.current('Modal 클라우드 A10G 인스턴스에 학습 작업을 요청했어요');
      previous.current = 'running';
      setJob(prev => ({ ...prev, status: 'running', currentStep: 0, loss: null, outputFile: null, logs: ['[시스템] 학습 작업을 시작합니다...'] }));
      refresh();
      return true;
    } catch (error) {
      notifyRef.current(error.message, true);
      return false;
    }
  }, [refresh]);

  const cancel = useCallback(async () => {
    try {
      await api('/api/train/cancel', {});
      notifyRef.current('학습 취소를 요청했어요');
      refresh();
    } catch (error) {
      notifyRef.current(error.message, true);
    }
  }, [refresh]);

  return { job, cliInfo, refresh, start, cancel };
}
