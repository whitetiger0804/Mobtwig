const $ = id => document.getElementById(id);
const icons = {
  home:'<path d="m3 10 9-7 9 7v11h-6v-7H9v7H3z"/>',
  list:'<path d="M8 5h13M8 12h13M8 19h13"/><path d="M3 5h.01M3 12h.01M3 19h.01" stroke-width="3"/>',
  book:'<path d="M12 6c-3-2-6-2-10-1v15c4-1 7-1 10 1 3-2 6-2 10-1V5c-4-1-7-1-10 1zM12 6v15"/><path d="M5 9h4M5 12h4M15 9h4M15 12h4"/>',
  heart:'<path d="M20.5 4.7a5.4 5.4 0 0 0-8.5 1 5.4 5.4 0 0 0-8.5-1C-2 10 12 21 12 21S26 10 20.5 4.7Z"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>',
  bookmark:'<path d="M6 3h12v18l-6-4-6 4z"/>',
  lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  left:'<circle cx="12" cy="12" r="9"/><path d="m12 8-4 4 4 4M8 12h8"/>',
  right:'<circle cx="12" cy="12" r="9"/><path d="m12 8 4 4-4 4M8 12h8"/>',
  clock:'<path d="M3 8a9 9 0 1 1-1 5M3 3v5h5M12 7v6l4 2"/>',
  headphones:'<path d="M4 14v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="12" width="4" height="9" rx="2"/><rect x="17" y="12" width="4" height="9" rx="2"/>',
  like:'<path d="M7 10h-4v11h4M7 21h11a2 2 0 0 0 2-2l1-7a2 2 0 0 0-2-2h-6l1-5c0-2-3-3-3-1l-4 6z"/>',
  comment:'<path d="M21 11a9 9 0 0 1-9 9 10 10 0 0 1-4-1l-6 2 2-6a9 9 0 1 1 17-4Z"/>'
  ,settings:'<path d="m9 3-1 3-3 1 1 3-3 2 3 2-1 3 3 1 1 3h6l1-3 3-1-1-3 3-2-3-2 1-3-3-1-1-3z"/><circle cx="12" cy="12" r="3"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
document.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon));
const entries = [
  {id:1,name:'이안',category:'인물',sub:'주인공',alias:'기록을 읽는 대장장이',summary:'낡은 물건에 남은 기억을 읽는 견습 대장장이.',at:0,body:'북부 변방의 작은 공방에서 자란 견습 대장장이. 오래된 물건에 손을 대면 그 물건에 남은 짧은 기억을 읽을 수 있다.\n\n완벽한 무기를 만드는 것보다, 물건을 만든 사람의 의도를 이해하는 일을 중요하게 여긴다. 아직 자신의 능력이 어디에서 비롯되었는지는 알지 못한다.'},
  {id:2,name:'세라',category:'인물',sub:'조력자',alias:'내탑의 기록 관리인',summary:'내탑의 서고를 지키며 이안을 돕는 기록 관리인.',at:2,body:'내탑의 오래된 기록을 정리하는 관리인. 출처가 불명확한 문서는 누구에게도 보여주지 않는 원칙을 지닌다.\n\n이안이 가져온 금속 조각에 남은 문양을 알아보고, 그에게 내탑의 서고를 안내한다.'},
  {id:3,name:'내탑',category:'세계관',sub:null,alias:'기억을 보관하는 탑',summary:'도시 중심에 세워진 기록과 유물의 보관소.',at:1,body:'도시 중심에 위치한 거대한 기록 보관소. 여행자들이 가져온 문서와 각 시대의 유물을 층별로 나누어 보관한다.\n\n탑 내부의 금속 장치는 오래된 마력으로 움직인다. 외부인의 출입은 기록 관리인의 허가가 있어야 가능하다.'},
  {id:4,name:'적합도',category:'용어',sub:null,alias:'도구와 사용자의 공명 정도',summary:'장비와 사용자의 마력이 얼마나 잘 맞는지 나타내는 값.',at:2,body:'장비에 담긴 마력과 사용자의 마력이 서로 어울리는 정도를 말한다. 같은 장비라도 사용자에 따라 성능이 달라지는 이유다.\n\n적합도는 장비의 등급과 별개이며, 높은 등급의 장비가 항상 좋은 선택은 아니다.'},
  {id:5,name:'기록석',category:'아이템',sub:'재료',alias:'기억을 품은 광물',summary:'주변의 마력과 짧은 기억을 담아두는 푸른 광물.',at:0,body:'희미한 푸른빛을 내는 광물. 오랜 시간 같은 장소에 놓여 있으면 주변의 마력과 기억을 흡수한다.\n\n일반적으로는 장식 재료로 쓰이지만, 기억을 읽는 능력이 있는 사람에게는 과거의 흔적을 찾는 단서가 된다.'},
  {id:6,name:'공명',category:'마법',sub:null,alias:'서로 다른 마력이 응답하는 현상',summary:'두 물체의 마력이 같은 리듬으로 반응하는 현상.',at:3,body:'가까이 놓인 두 물체가 서로의 마력에 반응하여 같은 진동을 만들어내는 현상. 공명이 일어나면 작은 빛이나 소리가 발생한다.\n\n대장장이들은 공명을 확인하여 재료와 장비가 잘 어울리는지 판단한다.'},
  {id:7,name:'은빛 망치',category:'아이템',sub:'장비',alias:'정밀 가공용 도구',summary:'미세한 마력의 변화를 감지하는 공방의 도구.',at:4,body:'내탑의 장인이 만든 정밀 가공용 망치. 손잡이의 기록석을 통해 금속 내부에 흐르는 마력의 변화를 감지한다.'},
  {id:8,name:'브란',category:'인물',sub:'조력자',alias:'산길의 안내자',summary:'산길을 따라 이동하는 일행의 안내자.',at:5,body:'북부 산길의 지형을 잘 아는 안내자. 장비를 고르는 기준과 각 재료의 성질을 이안에게 알려준다.'},
  {id:9,name:'흰가지 길드',category:'조직',sub:null,alias:'유물을 찾는 탐사 길드',summary:'흩어진 기록과 유물을 찾아 모으는 탐사 길드.',at:6,body:'도시 밖의 폐허를 탐사하여 유물과 기록을 수집하는 길드. 발견한 기록의 사본을 내탑에 기증한다.'},
  {id:10,name:'구름고래',category:'생물',sub:null,alias:'고공의 여행자',summary:'구름 사이를 헤엄치는 거대한 생물.',at:8,body:'높은 산맥 위의 구름층에 사는 생물. 비가 내리기 전 마력을 따라 이동하는 습성이 있다.'}
];
const categories=['전체','인물','세계관','용어','아이템','마법','조직','생물'];
const subcategories={인물:['주인공','조력자'],아이템:['재료','장비']};
let state={view:'toc',category:'전체',sub:'전체',query:'',progress:3,reverse:false};
let detailTrigger=null, toastTimer;
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$('toast').hidden=true},2300);}
function switchView(view){closeDetail(false);state.view=view;$('toc-view').hidden=view!=='toc';$('encyclopedia-view').hidden=view!=='encyclopedia';for(const [id,v] of [['toc-button','toc'],['book-button','encyclopedia']]){$(id).classList.toggle('active',view===v);$(id).setAttribute('aria-pressed',String(view===v));}if(view==='encyclopedia')renderDictionary();}
function tabButton(label,selected,action){const button=document.createElement('button');button.textContent=label;button.setAttribute('role','tab');button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;button.addEventListener('click',()=>{const parent=button.parentElement;action();const active=parent.querySelector('[aria-selected="true"]');active?.focus({preventScroll:true});active?.scrollIntoView({block:'nearest',inline:'nearest'});});button.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const siblings=Array.from(button.parentElement.children);const index=siblings.indexOf(button);const next=event.key==='Home'?0:event.key==='End'?siblings.length-1:(index+(event.key==='ArrowRight'?1:-1)+siblings.length)%siblings.length;siblings[next].click();});return button;}
function renderDictionary(){
  const categoryScroll=$('categories').scrollLeft,subScroll=$('subcategories').scrollLeft;
  $('categories').replaceChildren(...categories.map(c=>tabButton(c,state.category===c,()=>{state.category=c;state.sub='전체';renderDictionary();})));
  const subs=subcategories[state.category];$('subcategories').hidden=!subs;
  $('subcategories').replaceChildren(...(subs?['전체',...subs].map(label=>tabButton(label,state.sub===label,()=>{state.sub=label;renderDictionary();})) : []));
  $('categories').scrollLeft=categoryScroll;$('subcategories').scrollLeft=subScroll;
  $('reading-status-text').textContent=`${state.progress===0?'프롤로그':state.progress+'화'}까지 읽은 내용을 기준으로 보여드려요`;
  $('progress-label').textContent=state.progress===0?'프롤로그 읽음':state.progress+'화까지 읽음';
  const query=state.query.trim().toLocaleLowerCase('ko');
  const filtered=entries.filter(e=>(state.category==='전체'||e.category===state.category)&&(state.sub==='전체'||e.sub===state.sub)&&(!query||(e.at<=state.progress&&[e.name,e.alias,e.summary].some(t=>t.toLocaleLowerCase('ko').includes(query)))));
  $('clear-search').hidden=!state.query;$('list-label').textContent=query?'검색 결과':state.category==='전체'?'전체 항목':state.category+(state.sub==='전체'?'':' · '+state.sub);
  $('count').textContent=`${filtered.filter(e=>e.at<=state.progress).length}개 공개${filtered.some(e=>e.at>state.progress)?' · 잠금 '+filtered.filter(e=>e.at>state.progress).length+'개':''}`;
  $('entry-list').replaceChildren();
  if(!filtered.length){const empty=document.createElement('div');empty.className='empty-state';const title=document.createElement('strong');title.textContent='찾는 항목이 없어요';const desc=document.createElement('span');desc.textContent='다른 검색어로 찾아보세요. 공개된 항목만 검색됩니다.';empty.append(title,desc);$('entry-list').append(empty);return;}
  filtered.forEach(e=>{const locked=e.at>state.progress;const row=document.createElement(locked?'div':'button');row.className='entry-row'+(locked?' locked':'');
    if(locked){row.innerHTML=`<span class="entry-avatar">${icon('lock')}</span><div class="entry-copy"><div class="entry-type">${e.category}</div><strong>아직 공개되지 않은 항목</strong><p>${e.at}화까지 읽으면 확인할 수 있어요</p></div>`;}
    else{row.innerHTML=`<span class="entry-avatar ${e.category}">${e.name[0]}</span><div class="entry-copy"><div class="entry-type">${e.category}${e.sub?' · '+e.sub:''}</div><strong>${e.name}</strong><p>${e.summary}</p></div><span class="chevron" aria-hidden="true">›</span>`;row.addEventListener('click',()=>openDetail(e,row));}
    $('entry-list').append(row);
  });
}
function openDetail(entry,trigger){if(entry.at>state.progress)return;detailTrigger=trigger;$('detail-category').textContent=entry.category+(entry.sub?' · '+entry.sub:'');$('detail-title').textContent=entry.name;$('detail-alias').textContent=entry.alias;$('detail-body').textContent=entry.body;$('first-appearance').textContent=entry.at===0?'프롤로그에서 처음 등장':entry.at+'화에서 처음 등장';$('detail-overlay').hidden=false;$('detail').focus();}
function closeDetail(restore=true){if($('detail-overlay').hidden)return;$('detail-overlay').hidden=true;if(restore&&detailTrigger?.isConnected)detailTrigger.focus();detailTrigger=null;}
function renderEpisodes(){const names=['프롤로그','1. 야호','2. 적합도 1.1','3. 내탑 위기','4. 기초 장비 제작 가이드','5. 산길의 안내자','6. 대장장이 데뷔전','7. 오래된 기록','8. 구름 위의 여행자'];const rows=names.map((name,i)=>{const row=document.createElement('button');row.className='episode-row'+(i<=state.progress?' read':'');row.innerHTML=`<div class="episode-main"><div class="episode-title"><span class="free-tag">무료</span><span class="episode-title-text">${name}</span></div><div class="episode-meta"><span class="ep-tag">EP.${i}</span><span>▤ ${(4426+i*213).toLocaleString()}</span><span>♙ ${(108072-i*1238).toLocaleString()}</span><span>▣ ${167-i*4}</span></div></div><div class="episode-date"><small>공개시간</small>06.${15+i}</div>`;row.addEventListener('click',()=>{document.querySelector('.episode-number').textContent='EP.'+i;document.querySelector('.episode-heading>span:last-child').textContent=name.replace(/^\d+\. /,'');state.progress=Math.max(state.progress,i);$('progress').value=state.progress;renderEpisodes();renderDictionary();toast(`${i===0?'프롤로그':i+'화'} 읽기 위치로 이동했어요`);});return row;});$('episodes').replaceChildren(...(state.reverse?rows.reverse():rows));}
$('book-button').onclick=()=>switchView('encyclopedia');$('toc-button').onclick=()=>switchView('toc');
$('search').addEventListener('input',e=>{state.query=e.target.value;renderDictionary();});$('clear-search').onclick=()=>{state.query='';$('search').value='';renderDictionary();$('search').focus();};
$('close-detail').onclick=()=>closeDetail();$('return-list').onclick=()=>closeDetail();$('detail-overlay').onclick=e=>{if(e.target===$('detail-overlay'))closeDetail();};
document.addEventListener('keydown',e=>{if($('detail-overlay').hidden)return;if(e.key==='Escape'){closeDetail();return;}if(e.key==='Tab'){const first=$('close-detail'),last=$('return-list');if(e.shiftKey&&(document.activeElement===first||document.activeElement===$('detail'))){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
$('progress').oninput=e=>{state.progress=Number(e.target.value);closeDetail(false);renderDictionary();renderEpisodes();};
$('sort').onclick=()=>{state.reverse=!state.reverse;$('sort').textContent=state.reverse?'✓ 최신화부터':'✓ 첫화부터';renderEpisodes();};
function reset(){state={view:'toc',category:'전체',sub:'전체',query:'',progress:3,reverse:false};$('progress').value=3;$('search').value='';$('sort').textContent='✓ 첫화부터';document.querySelector('.episode-number').textContent='EP.3';document.querySelector('.episode-heading>span:last-child').textContent='내탑 위기';switchView('toc');renderDictionary();renderEpisodes();$('favorite').setAttribute('aria-pressed','false');$('favorite').classList.remove('active');}
$('reset').onclick=reset;$('home').onclick=reset;$('favorite').onclick=()=>{const next=$('favorite').getAttribute('aria-pressed')!=='true';$('favorite').setAttribute('aria-pressed',String(next));$('favorite').classList.toggle('active',next);toast(next?'작품을 찜했어요':'찜을 해제했어요');};
for(const [id,message] of Object.entries({settings:'읽기 설정 화면은 이번 시연 범위에 포함되지 않아요',previous:'이전화 이동은 목차에서 시연할 수 있어요',next:'다음화 이동은 목차에서 시연할 수 있어요',history:'백과사전을 닫아도 읽기 위치는 유지돼요',listen:'이번 시연은 백과사전 기능을 중심으로 구성했어요',recommend:'작품을 추천했어요',comments:'댓글 화면은 이번 시연 범위에 포함되지 않아요'}))$(id).onclick=()=>toast(message);
renderEpisodes();renderDictionary();
