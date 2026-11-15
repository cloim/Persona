import React from 'react';
export default function Pose({ index = 0, group = 'portrait', className = '' }) {
  const colors = { portrait: ['#eaf0e7','#73977d','#c7d6be'], expression: ['#faf0e3','#b68e69','#ead2b1'], body: ['#eaf0f6','#7a96b5','#c8d7e6'], variation: ['#f1ecf6','#9b87ae','#d9cbe3'] };
  const [bg, line, fill] = colors[group];
  const full = group === 'body'; const side = index % 8 === 3 || index % 8 === 4; const turn = index % 8 === 1 ? -9 : index % 8 === 2 ? 9 : 0;
  return <svg className={`pose ${className}`} viewBox="0 0 240 180" fill="none" aria-hidden="true">
    <rect width="240" height="180" fill={bg}/>
    <path d="M24 24h17M24 24v17M216 24h-17M216 24v17M24 156h17M24 156v-17M216 156h-17M216 156v-17" stroke={line} opacity=".25" strokeWidth="1.5"/>
    <circle cx="120" cy="91" r="66" fill="white" opacity=".35"/>
    <g stroke={line} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" transform={full ? 'translate(61 11) scale(.5)' : 'translate(0 0)'}>
      <path d="M81 147c2-22 15-31 26-34v-16h26v16c19 5 28 14 30 34" fill={fill}/>
      <path d="M107 111c5 8 20 9 26 0M95 126l-3 20M146 126l3 20"/>
      {side ? <><path d="M106 47c27-5 41 12 38 29l9 12-10 4c-2 17-13 25-25 21l-12-12-6-40z" fill={bg}/><path d="M105 77c-9-3-13 8-5 13M136 76l5 1M139 98h-8M103 75c-10-17-6-32 11-34 19-3 28 9 30 21l-20-3-12 12" fill={fill}/></> : <><path d={`M94 65c0-34 52-34 52 0v17c0 21-14 33-26 33S94 103 94 82z`} fill={bg}/><path d="M94 79c-9-5-10 9 0 14M146 79c9-5 10 9 0 14"/><path d="M92 77c-9-26 2-41 28-41s36 18 28 41l-7-19c-11 2-24-4-29-11-1 12-11 16-17 17z" fill={fill}/><path d={`M${105 + turn} 78h5m20 0h5M${121 + turn / 2} 78l-2 12h4`}/>{group === 'expression' && index % 6 === 1 ? <path d="M110 97q10 19 20 0z" fill={fill}/> : group === 'expression' && index % 6 === 3 ? <ellipse cx="120" cy="100" rx="4" ry="6"/> : <path d={group === 'expression' || index === 0 ? 'M112 98q8 7 16 0' : 'M115 100h10'}/>}</>}
      {full && <><path d="M82 143l-8 83 11 2 16-70M160 143l8 83-11 2-16-70" fill={fill}/><path d="M94 147l4 92-8 77h20l11-78 10 78h20l-9-78 4-92" fill={bg}/><path d="M90 316l-8 10h28v-10M131 316v10h28l-8-10" fill={fill}/></>}
    </g>
    <path d="M70 157h100" stroke={line} opacity=".18"/>
  </svg>;
}
