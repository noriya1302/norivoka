/* Accessibility helpers. No authentication, validation or learning-data changes. */
(()=>{'use strict';
const app=document.getElementById('app');if(!app)return;
app.setAttribute('role','main');app.setAttribute('tabindex','-1');
const skip=document.createElement('a');skip.className='ui-skip';skip.href='#app';skip.textContent='본문으로 건너뛰기';document.body.prepend(skip);
const names={login:'로그인',home:'홈',study:'단어 학습',done:'학습 결과',list:'단어장',stats:'학습 통계',admin:'학습 자료 관리',rank:'랭킹',settings:'설정'};
Object.entries(names).forEach(([id,name])=>{const el=document.getElementById(id);if(el)el.setAttribute('aria-label',name)});
const labels={'adm-rules':'단어 자료 가져오기 규칙','adm-file':'가져올 단어 자료 파일','adm-title':'학습 자료 제목','o-nick':'닉네임'};
Object.entries(labels).forEach(([id,label])=>{const el=document.getElementById(id);if(el&&!el.labels?.length)el.setAttribute('aria-label',label)});
const nav=document.querySelector('.tabbar');if(nav)nav.setAttribute('aria-label','주요 화면');
// Keep account rules hidden, including unsolicited screen-reader descriptions.
const note=document.getElementById('lg-note');if(note){note.hidden=true;note.setAttribute('aria-hidden','true')}
for(const id of ['lg-id','lg-pw','lg-pw2']){const el=document.getElementById(id);if(el)el.setAttribute('aria-describedby','lg-err')}
const tabs=document.querySelector('.login-tabs');if(tabs){tabs.setAttribute('role','group');tabs.setAttribute('aria-label','로그인 또는 회원가입')}
const status=document.querySelector('.fb-wrap');if(status){status.setAttribute('aria-live','polite');status.setAttribute('aria-atomic','true')}
// Full-screen blocking dialogs are modal. The inline dictionary deliberately is not.
for(const id of ['cheer','stk','fpw','ask']){const d=document.getElementById(id);if(d)d.setAttribute('aria-modal','true')}
const dialogs=[...document.querySelectorAll('[role="dialog"]')];
const visible=el=>el.isConnected&&!el.closest('[hidden]')&&el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden';
const focusables=el=>[...el.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')].filter(visible);
const modal=el=>el.getAttribute('aria-modal')==='true';
let active=null,previous=null;
for(const d of dialogs){if(!d.hasAttribute('tabindex'))d.setAttribute('tabindex','-1');if(!d.hasAttribute('aria-label')&&!d.hasAttribute('aria-labelledby')){const h=d.querySelector('h1,h2,h3');if(h){if(!h.id)h.id='ux-dialog-title-'+dialogs.indexOf(d);d.setAttribute('aria-labelledby',h.id)}else d.setAttribute('aria-label','안내')}}
function sync(){const next=dialogs.filter(d=>modal(d)&&visible(d)).at(-1)||null;if(next===active)return;if(next){if(!active)previous=document.activeElement;active=next;(focusables(next)[0]||next).focus({preventScroll:true})}else{active=null;if(previous&&visible(previous))previous.focus({preventScroll:true});previous=null}}
const observer=new MutationObserver(sync);observer.observe(app,{subtree:true,attributes:true,attributeFilter:['hidden','aria-modal','class']});sync();
document.addEventListener('keydown',e=>{if(e.key!=='Tab'||!active||!visible(active))return;const items=focusables(active);if(!items.length){e.preventDefault();active.focus();return}const first=items[0],last=items.at(-1);if(!active.contains(document.activeElement)){e.preventDefault();(e.shiftKey?last:first).focus()}else if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}});
})();
