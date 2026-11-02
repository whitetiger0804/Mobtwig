// Adjustable demo interval. Edge copies keep every wrap to one adjacent slide.
(() => {
 'use strict';
 const controllers=new Map();let autoplayPreference=null;
 function setup(track){
  const section=track.closest('.home-banner-section'),originals=[...track.querySelectorAll('.home-banner')],count=originals.length,loop=count>1;
  const toggle=section.querySelector('.banner-autoplay'),counter=section.querySelector('.banner-counter'),media=matchMedia('(prefers-reduced-motion:reduce)');
  const configured=Number(window.MOBTWIG_UI_CONFIG?.bannerIntervalMs??5000),interval=Number.isFinite(configured)&&configured>=100?configured:5000;
  const abort=new AbortController(),on=(target,name,fn,options={})=>target?.addEventListener(name,fn,{...options,signal:abort.signal});
  if(loop){const copy=node=>{const clone=node.cloneNode(true);clone.dataset.bannerClone='true';clone.removeAttribute('data-action');clone.removeAttribute('data-id');clone.setAttribute('aria-hidden','true');clone.setAttribute('tabindex','-1');clone.inert=true;return clone;};track.prepend(copy(originals[count-1]));track.append(copy(originals[0]));}
  let selected=0,physical=loop?1:0,lastWidth=track.clientWidth,timer=null,idle=null,frame=null,disposed=false,adjusting=false,animating=false,destination=null,draining=false,gesture=null,blockClick=false;
  const holds=new Set(),pointers=new Set(),queue=[];
  const step=()=>track.clientWidth+12,logical=p=>loop?((p-1)%count+count)%count:0;
  track.tabIndex=0;track.setAttribute('aria-label','광고판 좌우 이동');
  const enabled=()=>autoplayPreference??!media.matches;
  function clear(){if(timer!==null)clearTimeout(timer);timer=null;}
  function restart(){clear();if(disposed||!track.isConnected||count<2||!enabled()||holds.size||document.hidden||animating)return;timer=setTimeout(()=>{timer=null;advance(1);},interval);}
  function hold(reason,value){if(value){holds.add(reason);clear();}else{holds.delete(reason);restart();}}
  function sync(){
   if(!adjusting){physical=count?Math.max(0,Math.min(loop?count+1:0,Math.round(track.scrollLeft/step()))):0;selected=logical(physical);}
   for(const arrow of section.querySelectorAll('[data-action="banner-move"]'))arrow.disabled=count<2;
   if(counter){counter.textContent=`${count?selected+1:0}/${count}`;counter.setAttribute('aria-label',`광고판 ${count}개 중 ${count?selected+1:0}번째`);}
  }
  // Disable snap only for the invisible copy -> original jump, then restore before input.
  function place(p){adjusting=true;physical=p;track.style.scrollSnapType='none';track.scrollTo({left:p*step(),behavior:'instant'});void track.offsetWidth;if(frame!==null)cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{frame=null;track.style.scrollSnapType='';adjusting=false;sync();});}
  function settle(){
   if(disposed||gesture?.moved||draining)return;
   if(destination!==null&&Math.abs(track.scrollLeft-destination*step())>2){scheduleSettle();return;}
   clearTimeout(idle);idle=null;sync();
   if(loop&&(physical===0||physical===count+1))place(physical===0?count:1);
   animating=false;destination=null;holds.delete('motion');
   if(queue.length){const direction=queue.shift();draining=true;requestAnimationFrame(()=>{draining=false;if(!disposed)advance(direction);});}else restart();
  }
  function scheduleSettle(){clearTimeout(idle);idle=setTimeout(settle,140);}
  function advance(direction){
   if(!loop||disposed)return;
   if(animating||adjusting){if(queue.length<8)queue.push(direction);scheduleSettle();return;}
   clear();sync();if(physical===0||physical===count+1)place(physical===0?count:1);
   destination=physical+direction;animating=true;holds.add('motion');
   track.scrollTo({left:destination*step(),behavior:media.matches?'instant':'smooth'});scheduleSettle();
  }
  function syncControl(){if(toggle){toggle.hidden=count<2;toggle.textContent=enabled()?'자동 넘김 정지':'자동 넘김 재개';}counter?.setAttribute('aria-live',enabled()&&loop?'off':'polite');}
  on(track,'banner-step',event=>advance(Math.sign(event.detail)||1));
  on(toggle,'click',()=>{autoplayPreference=!enabled();syncControl();restart();});
  on(media,'change',()=>{if(media.matches)autoplayPreference=false;syncControl();restart();});
  on(document,'visibilitychange',()=>hold('hidden',document.hidden));
  on(section,'focusin',()=>hold('focus',true));on(section,'focusout',()=>queueMicrotask(()=>hold('focus',section.contains(document.activeElement))));
  on(section,'click',event=>{if(event.detail>0)event.target.closest('.banner-bottom button')?.blur();});
  on(section,'pointerdown',event=>{if(event.pointerType!=='touch'){pointers.add(event.pointerId);hold('pointer',true);}},{capture:true});
  const pointerEnd=event=>{pointers.delete(event.pointerId);if(!pointers.size)hold('pointer',false);};on(document,'pointerup',pointerEnd);on(document,'pointercancel',pointerEnd);
  on(section,'touchstart',()=>hold('touch',true),{passive:true});const touchEnd=event=>{if(!event.touches.length){hold('touch',false);scheduleSettle();}};on(document,'touchend',touchEnd);on(document,'touchcancel',touchEnd);
  on(section,'wheel',restart,{passive:true});on(section,'keydown',restart);
  on(track,'pointerdown',event=>{blockClick=false;if(!event.isPrimary||event.button!==0)return;queue.length=0;destination=null;gesture={id:event.pointerId,x:event.clientX,y:event.clientY,left:track.scrollLeft,mouse:event.pointerType==='mouse',moved:false};});
  on(track,'pointermove',event=>{if(!gesture||gesture.id!==event.pointerId)return;const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;if(Math.hypot(dx,dy)>8)blockClick=true;if(!gesture.mouse||(!gesture.moved&&Math.abs(dx)<=Math.max(8,Math.abs(dy))))return;if(!gesture.moved){gesture.moved=true;track.setPointerCapture(event.pointerId);track.classList.add('banner-dragging');}event.preventDefault();track.scrollLeft=gesture.left-dx;});
  function finish(event){if(!gesture||gesture.id!==event.pointerId)return;const drag=gesture;gesture=null;if(drag.moved){const target=Math.round(track.scrollLeft/step())*step();track.classList.remove('banner-dragging');if(track.hasPointerCapture(event.pointerId))track.releasePointerCapture(event.pointerId);track.scrollTo({left:target,behavior:media.matches?'instant':'smooth'});}scheduleSettle();}
  on(track,'pointerup',finish);on(track,'pointercancel',finish);on(track,'lostpointercapture',()=>{gesture=null;track.classList.remove('banner-dragging');scheduleSettle();});
  on(track,'click',event=>{if(blockClick&&event.detail!==0){event.preventDefault();event.stopImmediatePropagation();}},{capture:true});
  on(track,'scroll',()=>{if(adjusting)return;sync();hold('motion',true);animating=true;scheduleSettle();},{passive:true});
  on(track,'scrollend',()=>{if(!adjusting)settle();});
  on(track,'keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)||event.altKey||event.ctrlKey||event.metaKey)return;event.preventDefault();if(event.key==='ArrowLeft'||event.key==='ArrowRight')advance(event.key==='ArrowRight'?1:-1);else{queue.length=0;destination=null;selected=event.key==='Home'?0:count-1;place(loop?selected+1:0);scheduleSettle();}});
  const observer=new ResizeObserver(()=>{if(lastWidth!==track.clientWidth){lastWidth=track.clientWidth;queue.length=0;destination=null;animating=false;holds.delete('motion');place(loop?selected+1:0);restart();}sync();});observer.observe(track);
  const modalRoot=document.getElementById('modal-root'),modalObserver=new MutationObserver(()=>hold('modal',!!modalRoot?.children.length));if(modalRoot)modalObserver.observe(modalRoot,{childList:true});hold('modal',!!modalRoot?.children.length);
  place(loop?1:0);sync();syncControl();restart();
  return()=>{disposed=true;clear();clearTimeout(idle);if(frame!==null)cancelAnimationFrame(frame);abort.abort();observer.disconnect();modalObserver.disconnect();};
 }
 function connect(){for(const [track,cleanup]of controllers)if(!track.isConnected){cleanup();controllers.delete(track);}document.querySelectorAll('#home-banners').forEach(track=>{if(!controllers.has(track))controllers.set(track,setup(track));});}
 new MutationObserver(connect).observe(document.getElementById('app'),{childList:true});connect();
})();
