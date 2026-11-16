import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { LoaderCircle } from 'lucide-react';
export { default as SelectControl } from './SelectControl';
export { Modal } from './Modal';
export { default as Toast } from './Toast';

export function Button({ children, icon: Icon, busy, className = '', variant = 'secondary', ...props }) {
  return <button {...props} aria-busy={busy || undefined} disabled={props.disabled || busy} className={`button ${variant} ${className}`}>{busy ? <LoaderCircle size={16} className="spin"/> : Icon ? <Icon size={16}/> : null}{children}</button>;
}

export function Field({ label, hint, children, className = '' }) {
  return <label className={`field ${className}`}><span className="field-label">{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function Empty({ icon: Icon, title, children }) {
  return <div className="empty"><Icon size={32}/><h3>{title}</h3>{children && <div className="empty-body">{children}</div>}</div>;
}

// 앵커 아래에 포털로 띄우는 메뉴. 위치는 DOM 속성으로만 지정한다.
// Escape는 window 캡처 단계에서 처리해 열려 있는 Modal보다 먼저 이 메뉴만 닫는다.
export function Popover({ anchorRef, open, onClose, align = 'end', label, children }) {
  const panel = useRef(null);
  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !panel.current) return undefined;
    const place = () => {
      const rect = anchorRef.current.getBoundingClientRect();
      const el = panel.current;
      el.style.top = `${Math.round(rect.bottom + 6)}px`;
      el.style.left = align === 'end' ? 'auto' : `${Math.round(rect.left)}px`;
      el.style.right = align === 'end' ? `${Math.round(window.innerWidth - rect.right)}px` : 'auto';
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, anchorRef, align]);
  useEffect(() => {
    if (!open) return undefined;
    const key = event => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
      anchorRef.current?.focus();
    };
    const pointer = event => {
      if (panel.current?.contains(event.target) || anchorRef.current?.contains(event.target)) return;
      onClose();
    };
    window.addEventListener('keydown', key, true);
    document.addEventListener('pointerdown', pointer, true);
    panel.current?.querySelector('[role="menuitem"]:not([disabled])')?.focus();
    return () => { window.removeEventListener('keydown', key, true); document.removeEventListener('pointerdown', pointer, true); };
  }, [open, onClose, anchorRef]);
  if (!open) return null;
  return createPortal(<div ref={panel} className="popover" role="menu" aria-label={label}>{children}</div>, document.body);
}
