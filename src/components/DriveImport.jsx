import React, { useEffect, useRef, useState } from 'react';
import { DownloadCloud, RefreshCw } from 'lucide-react';
import { Button, Field, SelectControl } from './ui';
import { api } from '../lib/api.mjs';
import { loadDriveProject } from '../lib/drive.mjs';
import { imageFromFile } from '../lib/storage.mjs';

export default function DriveImport({ onImport, blocked, notify, onBusyChange }) {
  const [files, setFiles] = useState([]), [selected, setSelected] = useState(''), [next, setNext] = useState(null);
  const [searched, setSearched] = useState(false), [busy, setBusy] = useState(''), [error, setError] = useState(''), [progress, setProgress] = useState(null);
  const active = useRef(null);
  useEffect(() => () => { active.current?.abort(); onBusyChange(false); }, []);
  useEffect(() => { const warn = e => { if (busy === 'import') { e.preventDefault(); e.returnValue = ''; } }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [busy]);
  async function list(more = false) {
    if (active.current) return;
    const abort = new AbortController(); active.current = abort; setBusy('list'); setError('');
    try {
      const result = await api('/api/google/packages' + (more ? '?pageToken=' + encodeURIComponent(next) : ''), undefined, { signal: abort.signal });
      if (abort.signal.aborted) return;
      setFiles(previous => more ? [...previous, ...result.files.filter(f => !previous.some(p => p.id === f.id))] : result.files);
      if (!more) setSelected(result.files[0]?.id || ''); setNext(result.nextPageToken); setSearched(true);
    } catch (error) { if (!abort.signal.aborted) setError(error.message); }
    finally { if (active.current === abort) { active.current = null; setBusy(''); } }
  }
  async function restore() {
    if (active.current || !selected) return;
    const abort = new AbortController(); active.current = abort; setBusy('import'); onBusyChange(true); setError(''); setProgress({ label: 'Drive 프로젝트 준비 중', percent: 0 });
    try {
      const result = await loadDriveProject(selected, imageFromFile, setProgress, abort.signal);
      if (abort.signal.aborted) return;
      await onImport(result.project);
      notify(result.legacy ? '이미지와 캡션을 새 프로젝트로 불러왔어요. 캐릭터 설명, 스타일과 참조 이미지는 프로젝트 설정에서 보완해 주세요' : 'Drive 프로젝트를 새 사본으로 불러왔어요');
    } catch (error) { if (!abort.signal.aborted) setError(error.message); }
    finally { if (active.current === abort) { active.current = null; setBusy(''); onBusyChange(false); setProgress(null); } }
  }
  return <section className="drive-import">
    <div className="section-row">
      <h3>Drive에서 불러오기</h3>
      <Button icon={RefreshCw} busy={busy === 'list'} disabled={!!busy} onClick={() => list()}>{searched ? '목록 새로고침' : '저장한 프로젝트 찾기'}</Button>
    </div>
    <p className="card-note">이 앱으로 저장한 학습 패키지를 새 프로젝트 사본으로 가져와요 · 현재 프로젝트는 그대로 보관해요</p>
    {error && <div className="notice warning" role="alert">{error}</div>}
    {files.length > 0 && <>
      <Field label="Drive에 저장된 프로젝트">
        <SelectControl value={selected} disabled={!!busy} onChange={e => setSelected(e.target.value)}>{files.map(file => <option value={file.id} key={file.id}>{file.name}</option>)}</SelectControl>
      </Field>
      <p className="card-note">저장 시각 {new Date(files.find(f => f.id === selected)?.createdTime).toLocaleString('ko-KR')}</p>
    </>}
    {searched && !files.length && <div className="notice">이 Google 계정에서 저장한 프로젝트가 아직 없어요 · 프로젝트를 저장한 계정으로 로그인했는지 확인해 주세요</div>}
    {busy === 'list' && <p className="card-note" role="status">저장된 프로젝트 목록을 확인하고 있어요</p>}
    {progress && <div className="progress-block" role="status"><span>{progress.label} · {progress.percent}%</span><div className="progress-track"><i style={{ width: `${progress.percent}%` }}/></div></div>}
    <div className="inline-actions">
      {files.length > 0 && <Button icon={DownloadCloud} variant="primary" busy={busy === 'import'} disabled={!!busy || !selected || blocked} onClick={restore}>선택한 프로젝트 불러오기</Button>}
      {next && <Button disabled={!!busy} onClick={() => list(true)}>이전 저장 항목 더 보기</Button>}
      {busy === 'import' && <Button onClick={() => active.current?.abort()}>불러오기 중단</Button>}
    </div>
    {blocked && <p className="card-note">진행 중인 이미지 생성이나 캡션 작성이 끝나면 불러올 수 있어요</p>}
  </section>;
}
