// Pass this function to page.evaluate() in the project's browser QA session.
// Check real geometry after opening each page, editor tab and modal.
export function auditComponentGeometry() {
  const findings=[];
  for(const select of document.querySelectorAll('select')){
    const rect=select.getBoundingClientRect();if(!rect.width||!rect.height)continue;
    const wrapper=select.closest('.select-control'),icons=wrapper?.querySelectorAll('.select-control-chevron');
    const label=select.getAttribute('aria-label')||select.closest('.field')?.querySelector('.field-label')?.textContent||'선택 입력';
    if(!wrapper||icons.length!==1){findings.push({component:'SelectControl',label,error:'공용 래퍼와 단일 chevron 필요'});continue;}
    const icon=icons[0],bounds=icon.getBoundingClientRect();
    const delta=Math.abs(rect.y+rect.height/2-bounds.y-bounds.height/2),inset=rect.right-bounds.right;
    if(delta>1||Math.abs(inset-11)>1)findings.push({component:'SelectControl',label,error:'chevron 정렬',delta,inset});
    if(getComputedStyle(select).appearance!=='none'||parseFloat(getComputedStyle(select).paddingRight)<38||getComputedStyle(icon).pointerEvents!=='none'||icon.getAttribute('aria-hidden')!=='true')findings.push({component:'SelectControl',label,error:'기본 화살표, 여백 또는 장식 아이콘 계약'});
  }
  const toast=document.querySelector('.toast');
  if(toast){
    const close=toast.querySelector('.toast-close'),message=toast.querySelector('.toast-message');
    if(!close||!message)findings.push({component:'Toast',error:'공용 메시지와 닫기 버튼 필요'});
    else{
      const rect=toast.getBoundingClientRect(),button=close.getBoundingClientRect(),padding=parseFloat(getComputedStyle(toast).paddingRight),border=parseFloat(getComputedStyle(toast).borderRightWidth);
      const gap=rect.right-button.right-padding-border;
      if(Math.abs(gap)>1)findings.push({component:'Toast',error:'닫기 버튼 오른쪽 정렬',gap});
      if(rect.left<0||rect.right>innerWidth||rect.top<0||rect.bottom>innerHeight)findings.push({component:'Toast',error:'뷰포트 넘침'});
      if(toast.parentNode!==document.body)findings.push({component:'Toast',error:'body 포털 필요'});
      if(!close.getAttribute('aria-label')||button.width<32||button.height<32)findings.push({component:'Toast',error:'닫기 버튼 접근성 또는 터치 영역'});
    }
  }
  return findings;
}
