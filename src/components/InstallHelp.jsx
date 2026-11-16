import React from 'react';
import { Copy } from 'lucide-react';
import { Button, Modal } from './ui';

export default function InstallHelp({onClose,notify}) {
  async function copy(){try{await navigator.clipboard.writeText(location.origin+'/dataset');notify('앱 주소를 복사했어요');}catch{notify('브라우저 주소창에서 현재 주소를 복사해 주세요',true);}}
  return <Modal isOpen onClose={onClose} title="홈 화면에 추가" footer={<><Button icon={Copy} onClick={copy}>앱 주소 복사</Button><Button variant="primary" onClick={onClose}>확인</Button></>}>
    <div className="install-help">
      <p>브라우저 메뉴에서 <strong>홈 화면에 추가</strong> 또는 <strong>앱 설치</strong>를 선택해 주세요</p>
      <section><h3>보안 폴더 안에서 메뉴가 없다면</h3><p>현재 브라우저의 북마크에 이 페이지를 저장해 다시 열 수 있어요<br/>홈 아이콘 추가 기능은 기기와 브라우저가 제공할 때 사용할 수 있어요</p></section>
      <section><h3>보안 폴더 안에서 다른 브라우저로 확인</h3><ol className="simple-list"><li>보안 폴더의 + 버튼에서 Chrome을 추가해요</li><li>추가한 Chrome에서 복사한 앱 주소를 열어요</li><li>메뉴에 홈 화면 추가나 설치 항목이 있는지 확인해요</li></ol></section>
      <p className="card-note">브라우저를 바꾸면 이미지셋은 자동으로 옮겨지지 않아요<br/>프로젝트 백업을 내려받아 새 브라우저에서 가져오면 이어서 작업할 수 있어요</p>
      <a className="text-link" href="https://www.samsung.com/uk/support/mobile-devices/what-is-the-secure-folder-and-how-can-i-use-it/" target="_blank" rel="noreferrer">삼성 보안 폴더의 앱 추가 안내</a>
    </div>
  </Modal>;
}
