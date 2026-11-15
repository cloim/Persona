import React from 'react';
import { LoaderCircle } from 'lucide-react';
export { default as SelectControl } from './SelectControl';
export { Modal } from './Modal';
export { default as Toast } from './Toast';
export function Button({ children, icon: Icon, busy, className = '', variant = 'secondary', ...props }) {
  return <button {...props} aria-busy={busy || undefined} disabled={props.disabled || busy} className={`button ${variant} ${className}`}>{busy ? <LoaderCircle size={16} className="spin"/> : Icon ? <Icon size={16}/> : null}{children}</button>;
}
export function Field({ label, hint, children, className = '' }) { return <label className={`field ${className}`}><span className="field-label">{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
export function Empty({ icon: Icon, title, children }) { return <div className="empty"><Icon size={32}/><h3>{title}</h3><p>{children}</p></div>; }
