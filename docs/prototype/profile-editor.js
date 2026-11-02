(function(root){
 'use strict';
 const PREFIX='mobtwig-account-profile-v1:',POLICY={nameLength:30,fileBytes:2*1024*1024,pixels:24000000,size:512,dataChars:700000};
 function validate(value){
  const name=String(value.name||'').trim();
  if(!name)throw Error('닉네임을 입력해 주세요. 공백만 사용할 수 없어요.');
  if(Array.from(name).length>POLICY.nameLength)throw Error('시연에서는 닉네임을 30자까지 사용할 수 있어요.');
  const image=value.image||null;
  if(image!==null&&(typeof image!=='string'||image.length>POLICY.dataChars||!/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(image)))throw Error('프로필 이미지를 다시 선택해 주세요.');
  return {name,image};
 }
 function createStore(storage,getUser){
  const key=id=>PREFIX+encodeURIComponent(id);
  function read(){const user=getUser();if(!user)return null;let raw;try{raw=storage.getItem(key(user.id));}catch{throw Error('저장된 프로필을 읽지 못했어요. 다시 시도해 주세요.');}if(raw===null)return {name:user.name,image:null};try{const value=JSON.parse(raw);if(value.owner!==user.id)throw Error();return validate(value);}catch{throw Error('저장된 프로필을 읽지 못했어요. 기존 저장본은 유지합니다.');}}
  function save(value,owner){if(!owner||getUser()?.id!==owner)throw Error('계정이 변경되었어요. 현재 계정에서 다시 열어 주세요.');read();const clean=validate(value);try{storage.setItem(key(owner),JSON.stringify({owner,...clean}));}catch{throw Error('프로필을 저장하지 못했어요. 입력은 유지되니 다시 시도해 주세요.');}return clean;}
  return {read,save};
 }
 function create(ctx){
  const store=createStore({getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)},ctx.getUser),esc=ctx.escape;
  let draft=null,token=null;
  function identity(){try{return store.read();}catch{return ctx.getUser()?{name:ctx.getUser().name,image:null}:null;}}
  function avatar(extra='',value=identity()){return `<span class="avatar ${extra}">${value?.image?`<img src="${esc(value.image)}" alt="">`:esc(Array.from(value?.name||'모')[0])}</span>`;}
  function sync(page){if(draft&&(draft.owner!==ctx.getUser()?.id||page!=='profile-edit')){draft=null;token=null;}const saved=identity();if(saved&&ctx.getUser())ctx.getUser().name=saved.name;}
  function error(message){const node=document.querySelector('#profile-error');if(node)node.textContent=message;}
  function page(){if(!ctx.getUser())return ctx.shell(ctx.gate(),'mypage','프로필 편집');let loadError='';if(!draft){try{draft={owner:ctx.getUser().id,...store.read()};}catch(e){loadError=e.message;}}
   const value=draft||{name:ctx.getUser().name,image:null};
   return ctx.shell(`${ctx.backHead('프로필 편집','mypage')}<form class="form-panel profile-editor" data-profile-form data-owner="${esc(ctx.getUser().id)}"><div class="profile-image-editor"><div id="profile-preview">${avatar('profile-preview',value)}</div><div class="profile-image-actions"><label class="secondary profile-file-label">이미지 선택<input type="file" id="profile-image" accept="image/png,image/jpeg,image/webp" aria-label="프로필 이미지 선택" ${draft?'':'disabled'}></label><button type="button" class="text-link" data-profile-action="reset" ${draft?'':'disabled'}>기본 이미지로 복원</button></div></div><label class="field"><span>닉네임</span><input name="nickname" value="${esc(value.name)}" autocomplete="nickname" ${draft?'':'disabled'}></label><p class="section-note">시연 정책: 닉네임 30자, 중복 허용 · PNG/JPEG/WebP 2MB 이하 · 최대 512px로 축소 후 원형 중앙 표시. 직접 자르기는 제공하지 않아요.</p><p class="section-note">저장하면 공통 프로필과 새 글·댓글에 반영돼요. 과거 글·댓글의 작성자 이름은 이 시연에서 유지합니다.</p><p id="profile-image-status" role="status"></p><p id="profile-error" class="form-error" role="alert">${esc(loadError)}</p><div class="form-footer"><button class="primary" type="submit" ${draft?'':'disabled'}>프로필 저장</button><button type="button" class="secondary" data-profile-action="cancel">취소</button>${draft?'':'<button type="button" class="secondary" data-profile-action="retry">다시 읽기</button>'}</div></form>`,'mypage','프로필 편집');
  }
  document.addEventListener('input',event=>{if(event.target.matches('[data-profile-form] [name="nickname"]')&&draft)draft.name=event.target.value;});
  document.addEventListener('click',event=>{const action=event.target.closest('[data-profile-action]')?.dataset.profileAction;if(!action)return;if(action==='cancel'){draft=null;token=null;ctx.go('mypage');}if(action==='retry')ctx.render();if(action==='reset'&&draft){token=null;draft.image=null;document.querySelector('#profile-preview').innerHTML=avatar('profile-preview',draft);document.querySelector('#profile-image').value='';document.querySelector('#profile-image-status').textContent='기본 이미지입니다. 저장하면 적용돼요.';error('');}});
  document.addEventListener('change',async event=>{if(event.target.id!=='profile-image'||!draft)return;const file=event.target.files?.[0];if(!file)return;const active=draft,request={};token=request;const status=document.querySelector('#profile-image-status');status.textContent='이미지를 준비하고 있어요.';error('');try{
   if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>POLICY.fileBytes)throw Error('시연에서는 PNG/JPEG/WebP 2MB 이하 이미지를 선택해 주세요.');
   const url=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reader.onabort=()=>reject(Error('이미지를 읽지 못했어요. 이전 선택과 닉네임은 유지됩니다.'));reader.readAsDataURL(file);});
   const image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('이미지를 읽지 못했어요. 다른 파일로 다시 선택해 주세요.'));img.src=url;});
   if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth*image.naturalHeight>POLICY.pixels)throw Error('이미지 해상도가 너무 커요. 더 작은 파일을 선택해 주세요.');
   const scale=Math.min(1,POLICY.size/Math.max(image.naturalWidth,image.naturalHeight)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);const converted=validate({name:'preview',image:canvas.toDataURL('image/png')}).image;
   if(token!==request||draft!==active||ctx.getUser()?.id!==active.owner)return;active.image=converted;document.querySelector('#profile-preview').innerHTML=avatar('profile-preview',active);status.textContent='미리보기입니다. 저장하면 적용돼요.';
  }catch(e){if(token===request&&draft===active){error(e.message);status.textContent='이미지 선택 실패 · 이전 선택을 유지했어요.';}}finally{if(token===request){token=null;event.target.value='';}}});
  document.addEventListener('submit',event=>{if(!event.target.matches('[data-profile-form]'))return;event.preventDefault();if(!draft)return;draft.name=event.target.elements.nickname.value;try{if(token)throw Error('이미지 준비가 끝난 뒤 저장해 주세요.');const saved=store.save(draft,draft.owner);ctx.getUser().name=saved.name;draft=null;ctx.go('mypage');ctx.toast('프로필을 저장했어요.');}catch(e){error(e.message);}});
  return {identity,avatar,sync,page};
 }
 const api={PREFIX,POLICY,validate,createStore,create};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MOBTWIG_PROFILE=api;
})(typeof window!=='undefined'?window:globalThis);
