import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, CheckCheck, CircleHelp, ImagePlus, Images, Leaf, ListFilter, Plus, Search, Settings2, Sparkles, Upload, WandSparkles, X, TriangleAlert, LoaderCircle } from 'lucide-react';
import { PRESETS, GROUPS, readiness, resizeSlots } from '../lib/dataset.mjs';
import { trainingModel } from '../lib/training.mjs';
import { Button, SelectControl, Modal, Empty } from '../components/ui';
import Pose from '../components/Pose';

export default function DatasetPage({ project, updateProject, openShot, editCharacter, registerImage, notify, generation }) {
  const [group, setGroup] = useState('all'); const [status, setStatus] = useState('all'); const [search, setSearch] = useState('');
  const [pendingSize, setPendingSize] = useState(null); const [busy, setBusy] = useState(false); const [drag, setDrag] = useState(false); const input = useRef();
  const progress = readiness(project); const preset = PRESETS.find(p => p.value === project.size);
  const filtered = project.slots.filter(s => (group === 'all' || s.group === group) && (status === 'all' || (status === 'empty' ? !s.image : status === 'review' ? s.image && !s.reviewed : s.reviewed)) && `${s.title} ${s.caption}`.toLowerCase().includes(search.toLowerCase()));
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
    const empty = project.slots.filter(s => !s.image); let count = 0; const errors = [];
    setBusy(true);
    for (let i = 0; i < Math.min(candidates.length, empty.length); i++) {
      try { await registerImage(empty[i].id, candidates[i]); count++; } catch (error) { errors.push(error.message); }
    }
    setBusy(false); if (input.current) input.current.value = '';
    notify(`${count}장을 빈 슬롯 순서대로 등록했어요${candidates.length > empty.length ? ` · 남은 ${candidates.length - empty.length}장은 슬롯이 부족해요` : ''}${errors.length ? ` · ${errors.length}장 확인 필요: ${errors[0]}` : ''}`, errors.length > 0);
  }
  return <div className="workspace-page">
    <section className="project-banner">
      <button className="project-portrait" onClick={editCharacter} aria-label="캐릭터 참조 이미지 설정">{project.reference ? <img src={project.reference.data} alt="캐릭터 참조"/> : <Pose/>}<span><Plus size={14}/></span></button>
      <div className="project-summary"><div className="project-name"><h2>{project.name}</h2><button className="icon-button small" onClick={editCharacter} aria-label="캐릭터 정보 편집"><Settings2 size={16}/></button></div><p>{project.identity || '고유한 캐릭터의 다양한 모습을 모아 보세요'}</p><div className="project-tags"><span><span className="tiny-dot"/>진행 중</span><code>{project.trigger}</code><span>{trainingModel(project.model).label} LoRA</span><span>{project.style === 'photo' ? '실사' : project.style === 'anime' ? '애니메이션' : '일러스트'}</span></div></div>
      <div className="project-completion"><div><strong>{progress.filled}<span> / {progress.total}</span></strong><span>이미지 준비 완료</span></div><div className="progress-track"><i style={{ width: `${progress.filled / progress.total * 100}%` }}/></div><small>{progress.complete ? '좋아요! 캡션을 확인하면 학습을 시작할 수 있어요' : '한 장씩, 캐릭터를 더 선명하게'}</small></div>
    </section>
    <div className="workflow-steps"><span className="current"><b>1</b>이미지셋 구성</span><Chevron/><span className={progress.complete ? 'current' : ''}><b>2</b>캡션 확인</span><Chevron/><span className={progress.ready ? 'current' : ''}><b>3</b>학습 준비</span></div>
    <div className="workspace-columns"><div className="board-column">
      <section className="board-setup"><div><h3>어떤 이미지셋을 만들까요?</h3><p>크기를 선택하면 필요한 구도와 표정을 준비해 드려요</p></div><div className="size-control"><span className="size-control-label">이미지셋 크기</span><SelectControl aria-label="이미지셋 크기" value={project.size} disabled={busy || !!generation} onChange={e => changeSize(Number(e.target.value))}>{PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</SelectControl></div></section>
      <div className="board-toolbar"><div className="board-tabs" role="tablist" aria-label="이미지 상태"><button role="tab" aria-selected={status === 'all'} className={status === 'all' ? 'selected' : ''} onClick={() => setStatus('all')}>전체 이미지 <span>{project.size}</span></button><button role="tab" aria-selected={status === 'empty'} className={status === 'empty' ? 'selected' : ''} onClick={() => setStatus('empty')}>미등록 <span>{project.size - progress.filled}</span></button><button role="tab" aria-selected={status === 'review'} className={status === 'review' ? 'selected' : ''} onClick={() => setStatus('review')}>확인 필요 <span>{progress.filled - progress.reviewed}</span></button></div><Button icon={Upload} busy={busy} disabled={!!generation || progress.complete} onClick={() => input.current.click()}>한 번에 등록</Button><input ref={input} hidden multiple type="file" accept="image/png,image/jpeg,image/webp" onChange={e => bulkUpload(e.target.files)}/></div>
      <div className="board-filters"><div className="group-filters"><button className={group === 'all' ? 'active' : ''} onClick={() => setGroup('all')}>모든 구도</button>{GROUPS.map(g => <button key={g.key} className={group === g.key ? 'active' : ''} onClick={() => setGroup(g.key)}><i style={{ background: g.color }}/>{g.tag}</button>)}</div><label className="search-box"><Search size={15}/><input aria-label="이미지 검색" placeholder="구도 검색" value={search} onChange={e => setSearch(e.target.value)}/>{search && <button aria-label="검색 지우기" onClick={() => setSearch('')}><X size={13}/></button>}</label></div>
      <div className={`image-board ${drag ? 'drag-active' : ''}`} onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDrag(false); }} onDrop={e => { e.preventDefault(); setDrag(false); bulkUpload(e.dataTransfer.files); }}>
        {drag && <div className="drop-overlay"><Upload size={34}/><strong>여기에 이미지를 놓아 주세요</strong><span>빈 슬롯부터 순서대로 등록해요</span></div>}
        {filtered.map(slot => { const index = project.slots.findIndex(s => s.id === slot.id); const g = GROUPS.find(g => g.key === slot.group); return <button key={slot.id} className={`shot-card ${slot.image ? 'has-image' : ''}`} onClick={() => openShot(slot.id)}><div className="shot-visual">{slot.image ? <img src={slot.image.data} alt={slot.title} loading="lazy"/> : <Pose group={slot.group} index={Number(slot.id.split('-')[1])}/>}<span className="shot-number">{String(index + 1).padStart(2, '0')}</span>{slot.image ? <span className={`shot-state ${slot.reviewed ? 'reviewed' : ''}`}>{slot.reviewed ? <CheckCheck size={13}/> : <Check size={13}/>}</span> : <span className="shot-add"><Plus size={15}/><span>이미지 등록</span></span>}{generation?.slotId === slot.id && <div className="generating-overlay"><LoaderCircle className="spin" size={24}/><span>생성 중</span></div>}</div><div className="shot-info"><div><strong>{slot.title}</strong><span className="shot-group" style={{ '--group-color': g.color }}>{g.tag}</span></div><p>{slot.image ? `${slot.image.width} × ${slot.image.height} · ${slot.reviewed ? '캡션 확인 완료' : '캡션 확인 필요'}` : slot.tip}</p></div></button>; })}
        {!filtered.length && <Empty icon={Images} title="해당하는 이미지가 없어요">다른 필터를 선택하거나 검색어를 바꿔 보세요</Empty>}
      </div><div className="board-bottom"><span><ImagePlus size={15}/>이미지를 보드에 끌어 놓아 한 번에 등록할 수 있어요</span><span>PNG, JPG, WebP · 장당 최대 25MB</span></div>
    </div>
    <aside className="inspector">
      <section className="balance-panel"><div className="panel-heading"><h3><SlidersIcon/>셋 밸런스</h3><span className="subtle-pill">{project.size}장 구성</span></div><p>다양한 모습이 모일수록<br/>캐릭터는 더 자연스러워져요</p><div className="balance-bar">{GROUPS.map((g,i) => <span key={g.key} style={{ background: g.color, flex: preset.counts[i] }}/>)}</div><div className="coverage-list">{GROUPS.map(g => { const list = project.slots.filter(s => s.group === g.key); const count = list.filter(s => s.image).length; return <button key={g.key} onClick={() => setGroup(group === g.key ? 'all' : g.key)}><span><i style={{ background: g.color }}/>{g.label}</span><strong>{count}<small> / {list.length}</small></strong><div className="coverage-track"><i style={{ background: g.color, width: `${count / list.length * 100}%` }}/></div></button>; })}</div><div className="balance-tip"><Leaf size={17}/><span>권장 구성은 시작점이에요<br/>양보다 일관된 캐릭터와 품질에 집중해요</span></div></section>
      <section className="ai-panel"><div className="ai-symbol"><Sparkles size={23}/></div><h3>필요한 모습이 없다면,<br/>AI로 만들어 보세요</h3><p>각 구도에 맞는 프롬프트를 준비했어요<br/>참조 이미지로 캐릭터의 특징도 함께</p><Button icon={WandSparkles} onClick={() => { const slot = project.slots.find(s => !s.image); if (slot) openShot(slot.id); else notify('수정할 이미지 카드를 선택해 재생성할 수 있어요'); }}>이미지 생성하기<ArrowRight size={15}/></Button><Link to="/connections">ComfyUI · Codex · OpenAI API <Chevron/></Link></section>
      <section className="next-panel"><div className="panel-heading"><h3>다음 단계</h3><TagsIcon/></div><p>{progress.complete ? '이미지 준비 완료! 캡션을 확인하고 학습을 시작해요' : '이미지를 모두 모으면 캡션 초안을 확인하고 학습을 준비할 수 있어요'}</p><Link to={progress.complete ? '/captions' : '/guide'}>{progress.complete ? '캡션 확인하기' : '이미지셋 준비 팁'}<ArrowRight size={15}/></Link></section>
      {!!progress.warnings.length && <section className="warning-panel"><TriangleAlert size={17}/><div><strong>품질 확인 {progress.warnings.length}건</strong><p>{progress.warnings[0].message}</p><button onClick={() => openShot(progress.warnings[0].id)}>이미지 확인하기 <ArrowRight size={13}/></button></div></section>}
    </aside></div>
    <Modal isOpen={!!pendingSize} onClose={() => setPendingSize(null)} title="이미지셋 크기 줄이기" footer={<><Button onClick={() => setPendingSize(null)}>현재 구성 유지</Button><Button variant="primary" onClick={() => { updateProject({ size: pendingSize.size, slots: pendingSize.next }); setPendingSize(null); notify('새 이미지셋 크기를 적용했어요'); }}>선택한 크기로 변경</Button></>}><p>{pendingSize?.removed.length}장의 등록된 이미지가 새 구성에 포함되지 않아요. 필요한 이미지는 상단의 백업 버튼으로 먼저 보관해 주세요.</p><ul>{pendingSize?.removed.map(s => <li key={s.id}>{s.title}</li>)}</ul></Modal>
  </div>;
}
function Chevron() { return <ArrowRight className="step-chevron" size={13}/>; }
function SlidersIcon() { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor"/><path d="M5 2v4M11 6v4M6 10v4" stroke="currentColor" strokeWidth="2"/></svg>; }
function TagsIcon() { return <CheckCheck size={18} color="#769b7c"/>; }
