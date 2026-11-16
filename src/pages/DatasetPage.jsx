import React, { useRef, useState } from 'react';
import { ImagePlus, Images, LoaderCircle, Plus, TriangleAlert, Upload } from 'lucide-react';
import { PRESETS, GROUPS, readiness, resizeSlots } from '../lib/dataset.mjs';
import { Button, SelectControl, Modal, Empty } from '../components/ui';
import Pose from '../components/Pose';

const STATUS_FILTERS = [
  { key: 'all', label: '전체' },
  { key: 'empty', label: '빈 슬롯' },
  { key: 'filled', label: '등록됨' },
];

export default function DatasetPage({ project, updateProject, openShot, registerImage, notify, generation }) {
  const [group, setGroup] = useState('all');
  const [status, setStatus] = useState('all');
  const [pendingSize, setPendingSize] = useState(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef();
  const progress = readiness(project);
  const filtered = project.slots.filter(s => (group === 'all' || s.group === group) && (status === 'all' || (status === 'empty' ? !s.image : !!s.image)));
  const filtersActive = group !== 'all' || status !== 'all';

  function changeSize(size) {
    if (generation || busy) return notify('현재 작업이 끝나면 이미지셋 크기를 바꿔 주세요', true);
    const { next, removed } = resizeSlots(project, size);
    if (removed.length) setPendingSize({ size, next, removed });
    else { updateProject({ size, slots: next }); notify(`${size}장 구성으로 준비했어요. 기존 이미지와 캡션은 이어서 사용해요`); }
  }

  async function bulkUpload(files) {
    if (busy || generation) return;
    const candidates = [...files].filter(f => /^image\/(png|jpeg|webp)$/.test(f.type));
    if (!candidates.length) return notify('PNG, JPG, WebP 이미지를 선택해 주세요', true);
    const empty = project.slots.filter(s => !s.image);
    let count = 0;
    const errors = [];
    setBusy(true);
    for (let i = 0; i < Math.min(candidates.length, empty.length); i++) {
      try { await registerImage(empty[i].id, candidates[i]); count++; } catch (error) { errors.push(error.message); }
    }
    setBusy(false);
    if (input.current) input.current.value = '';
    notify(`${count}장을 빈 슬롯 순서대로 등록했어요${candidates.length > empty.length ? ` · 남은 ${candidates.length - empty.length}장은 슬롯이 부족해요` : ''}${errors.length ? ` · ${errors.length}장 확인 필요: ${errors[0]}` : ''}`, errors.length > 0);
  }

  function resetFilters() { setGroup('all'); setStatus('all'); }

  return <div className="page dataset-page">
    <div className="toolbar" role="toolbar" aria-label="이미지셋 도구">
      <div className="segmented" role="group" aria-label="이미지 상태">
        {STATUS_FILTERS.map(f => <button type="button" key={f.key} className={status === f.key ? 'active' : ''} aria-pressed={status === f.key} onClick={() => setStatus(f.key)}>{f.label}</button>)}
      </div>
      <div className="chip-row">
        <button type="button" className="chip" aria-pressed={group === 'all'} onClick={() => setGroup('all')}>전체 <b>{progress.filled}/{progress.total}</b></button>
        {GROUPS.map(g => {
          const list = project.slots.filter(s => s.group === g.key);
          return <button type="button" key={g.key} className="chip" aria-pressed={group === g.key} onClick={() => setGroup(group === g.key ? 'all' : g.key)}>
            <i className="group-dot" style={{ '--group-color': g.color }}/>{g.tag} <b>{list.filter(s => s.image).length}/{list.length}</b>
          </button>;
        })}
      </div>
      <div className="toolbar-end">
        <SelectControl aria-label="이미지셋 크기" value={project.size} disabled={busy || !!generation} onChange={e => changeSize(Number(e.target.value))}>
          {PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </SelectControl>
        <Button variant="primary" icon={Upload} busy={busy} disabled={!!generation || progress.complete} onClick={() => input.current.click()}>이미지 추가</Button>
        <input ref={input} hidden multiple type="file" accept="image/png,image/jpeg,image/webp" onChange={e => bulkUpload(e.target.files)}/>
      </div>
    </div>

    {!!progress.warnings.length && <div className="warning-bar" role="status">
      <TriangleAlert size={16}/>
      <span>품질 확인 {progress.warnings.length}건 · {progress.warnings[0].title}: {progress.warnings[0].message}</span>
      <button type="button" className="text-button" onClick={() => openShot(progress.warnings[0].id, 'image')}>확인</button>
    </div>}

    <div
      className={`image-board${drag ? ' drag-active' : ''}`}
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDrag(false); }}
      onDrop={e => { e.preventDefault(); setDrag(false); bulkUpload(e.dataTransfer.files); }}
    >
      {drag && <div className="drop-overlay"><Upload size={34}/><strong>여기에 이미지를 놓아 주세요</strong><span>빈 슬롯부터 순서대로 등록해요</span></div>}
      {filtered.length > 0 && <div className="shot-grid">
        {filtered.map(slot => {
          const index = project.slots.findIndex(s => s.id === slot.id);
          const g = GROUPS.find(item => item.key === slot.group);
          return <button type="button" key={slot.id} className={`shot-card${slot.image ? ' has-image' : ''}`} onClick={() => openShot(slot.id, 'image')} aria-label={`${String(index + 1).padStart(2, '0')} ${slot.title}${slot.image ? '' : ', 빈 슬롯'}`}>
            <span className="shot-visual">
              {slot.image ? <img src={slot.image.data} alt="" loading="lazy"/> : <>
                <Pose group={slot.group} index={Number(slot.id.split('-')[1])}/>
                <span className="shot-add"><Plus size={22}/></span>
              </>}
              <span className="shot-number">{String(index + 1).padStart(2, '0')}</span>
              {generation?.slotId === slot.id && <span className="generating-overlay"><LoaderCircle className="spin" size={24}/><span>생성 중</span></span>}
            </span>
            <span className="shot-info"><i className="group-dot" style={{ '--group-color': g.color }}/><strong>{slot.title}</strong></span>
          </button>;
        })}
      </div>}
      {!filtered.length && <Empty icon={Images} title="해당하는 이미지가 없어요"><Button onClick={resetFilters} disabled={!filtersActive}>필터 초기화</Button></Empty>}
    </div>
    <p className="board-hint"><ImagePlus size={14}/>PNG, JPG, WebP · 장당 25MB · 보드에 끌어 놓아 한 번에 등록</p>

    <Modal isOpen={!!pendingSize} onClose={() => setPendingSize(null)} title="이미지셋 크기 줄이기" footer={<>
      <Button onClick={() => setPendingSize(null)}>현재 구성 유지</Button>
      <Button variant="primary" onClick={() => { updateProject({ size: pendingSize.size, slots: pendingSize.next }); setPendingSize(null); notify('새 이미지셋 크기를 적용했어요'); }}>선택한 크기로 변경</Button>
    </>}>
      <p>{pendingSize?.removed.length}장의 등록된 이미지가 새 구성에 포함되지 않아요 · 필요한 이미지는 프로젝트 메뉴의 백업으로 먼저 보관해 주세요</p>
      <ul>{pendingSize?.removed.map(s => <li key={s.id}>{s.title}</li>)}</ul>
    </Modal>
  </div>;
}
