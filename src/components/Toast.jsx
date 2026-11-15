import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, TriangleAlert, X } from 'lucide-react';
import './Toast.css';

export default function Toast({ notification, onClose }) {
  const [hovered,setHovered]=useState(false),[focused,setFocused]=useState(false);
  useEffect(()=>{
    if(hovered||focused)return;
    const timer=setTimeout(onClose,5500);
    return()=>clearTimeout(timer);
  },[notification.id,onClose,hovered,focused]);
  return createPortal(<div className={`toast ${notification.error?'toast-error':''}`} role={notification.error?'alert':'status'} aria-atomic="true" data-ui-audit-overlay
    onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)}
    onFocusCapture={()=>setFocused(true)} onBlurCapture={e=>{if(!e.currentTarget.contains(e.relatedTarget))setFocused(false);}}>
    {notification.error?<TriangleAlert size={19} aria-hidden="true"/>:<CheckCircle2 size={19} aria-hidden="true"/>}
    <span className="toast-message">{notification.message}</span>
    <button type="button" className="toast-close" aria-label="알림 닫기" onClick={onClose}><X size={16} aria-hidden="true"/></button>
  </div>,document.body);
}
