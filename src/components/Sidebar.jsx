import React, { useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { Check, ChevronsUpDown, Fingerprint, LayoutGrid, LoaderCircle, Rocket, Settings2, Sprout, Tags } from 'lucide-react';
import { STEPS } from '../lib/steps.mjs';

const ICONS = { Fingerprint, LayoutGrid, Tags, Sprout, Rocket };

export default function Sidebar({ project, status, running, open, onClose, onOpenProjects }) {
  useEffect(() => {
    if (!open) return undefined;
    const key = event => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open, onClose]);
  return <>
    {open && <div className="nav-scrim" onClick={onClose}/>}
    <aside className={`sidebar${open ? ' open' : ''}`}>
      <NavLink to="/" className="brand" aria-label="Persona 홈">
        <span className="brand-mark"><img src="/logo-white.svg" alt=""/></span>
        <span className="brand-name">persona</span>
      </NavLink>
      <button type="button" className="project-switcher" onClick={onOpenProjects} aria-label={`프로젝트 전환, 현재 ${project.name}`}>
        <span className="thumb">{project.reference ? <img src={project.reference.data} alt=""/> : (project.name.trim().slice(0, 1) || 'P')}</span>
        <strong>{project.name}</strong>
        <ChevronsUpDown size={16} aria-hidden="true"/>
      </button>
      <nav aria-label="작업 단계" className="step-nav">
        {STEPS.map((step, index) => {
          const state = status[step.key];
          return <NavLink key={step.key} to={step.path} className={({ isActive }) => `step-item${isActive ? ' active' : ''}`}>
            <span className={`step-badge${state.done ? ' done' : ''}`}>
              {step.key === 'training' && running ? <LoaderCircle size={14} className="spin"/> : state.done ? <Check size={14} strokeWidth={3}/> : index + 1}
            </span>
            <span className="step-text"><strong>{step.label}</strong><small>{state.detail}</small></span>
          </NavLink>;
        })}
      </nav>
      <NavLink to="/settings" className={({ isActive }) => `step-item settings-item${isActive ? ' active' : ''}`}>
        <span className="step-icon"><Settings2 size={18}/></span>
        <span className="step-text"><strong>설정</strong></span>
      </NavLink>
    </aside>
  </>;
}

export function StepTabBar({ status, running }) {
  return <nav className="tab-bar" aria-label="작업 단계 탭">
    {STEPS.map(step => {
      const Icon = ICONS[step.icon];
      const done = status[step.key].done;
      return <NavLink key={step.key} to={step.path} className={({ isActive }) => `tab-item${isActive ? ' active' : ''}`}>
        <span className="tab-icon">
          {step.key === 'training' && running ? <LoaderCircle size={20} className="spin"/> : <Icon size={20}/>}
          {done && <i className="tab-dot" aria-label="완료"/>}
        </span>
        <span>{step.short}</span>
      </NavLink>;
    })}
  </nav>;
}
