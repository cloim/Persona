import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownToLine, Check, ChevronDown, Cloud, FileJson, Plus, Trash2, Upload } from 'lucide-react';
import { Button, Modal, Popover } from './ui';
import DriveImport from './DriveImport';

export default function ProjectsModal({ isOpen, onClose, project, projects, busy, google, notify, onSwitch, onCreate, onDelete, onBackup, onImportFile, importProject }) {
  const fileInput = useRef(null);
  const importButton = useRef(null);
  const [menu, setMenu] = useState(false);
  const [showDrive, setShowDrive] = useState(false);
  const [driveBusy, setDriveBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const list = [project, ...projects.filter(p => p.id !== project.id)];
  const closeMenu = () => setMenu(false);

  async function confirmDelete() {
    const target = deleteTarget;
    if (await onDelete(target)) setDeleteTarget(null);
  }

  return <>
    <Modal isOpen={isOpen} onClose={onClose} title="프로젝트" size="md" footer={<>
      <div className="footer-start">
        <Button ref={importButton} icon={Upload} disabled={busy || driveBusy} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(open => !open)}>가져오기<ChevronDown size={14}/></Button>
        <Popover anchorRef={importButton} open={menu} onClose={closeMenu} align="start" label="가져오기">
          <button type="button" role="menuitem" className="menu-item" onClick={() => { closeMenu(); fileInput.current.click(); }}><FileJson size={16}/>백업 파일(.json)</button>
          <button type="button" role="menuitem" className="menu-item" onClick={() => { closeMenu(); setShowDrive(true); }}><Cloud size={16}/>Google Drive</button>
        </Popover>
      </div>
      <Button variant="primary" icon={Plus} disabled={busy} onClick={onCreate}>새 프로젝트</Button>
    </>}>
      <ul className="project-list">
        {list.map(p => {
          const current = p.id === project.id;
          const filled = p.slots.filter(s => s.image).length;
          return <li className={`project-row${current ? ' current' : ''}`} key={p.id}>
            <button type="button" className="project-main" disabled={busy} aria-current={current || undefined} onClick={() => current ? onClose() : onSwitch(p)}>
              <span className="thumb">{p.reference ? <img src={p.reference.data} alt=""/> : (p.name.trim().slice(0, 1) || 'P')}</span>
              <span className="project-meta"><strong>{p.name}</strong><small>{filled}/{p.size}장 · {p.trigger}</small></span>
              {current && <Check size={18} className="project-check" aria-label="현재 프로젝트"/>}
            </button>
            <button type="button" className="icon-button" aria-label={`${p.name} 백업 내려받기`} data-tooltip="백업 내려받기" onClick={() => onBackup(p)}><ArrowDownToLine size={18}/></button>
            {!current && <button type="button" className="icon-button danger" disabled={busy} aria-label={`${p.name} 프로젝트 삭제`} data-tooltip="삭제" onClick={() => setDeleteTarget(p)}><Trash2 size={18}/></button>}
          </li>;
        })}
      </ul>
      {showDrive && <div className="drive-section">
        {google?.user
          ? <DriveImport key={google.user.id} onImport={importProject} blocked={busy} notify={notify} onBusyChange={setDriveBusy}/>
          : <p className="card-note">Google Drive에서 불러오려면 로그인이 필요해요 <Link className="text-link" to="/settings" onClick={onClose}>설정에서 로그인</Link></p>}
      </div>}
      <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={async e => { const file = e.target.files[0]; if (file) await onImportFile(file); e.target.value = ''; }}/>
    </Modal>
    <Modal isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="프로젝트 삭제" size="sm" footer={<>
      <Button onClick={() => setDeleteTarget(null)}>유지하기</Button>
      <Button variant="danger" onClick={confirmDelete}>프로젝트 삭제</Button>
    </>}>
      <p>{deleteTarget?.name}의 이미지와 캡션을 이 브라우저에서 삭제해요 · 보관할 내용이 있다면 해당 프로젝트의 백업을 먼저 내려받아 주세요</p>
    </Modal>
  </>;
}
