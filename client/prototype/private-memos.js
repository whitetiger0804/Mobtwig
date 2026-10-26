// Local-only prototype store. Production ownership checks belong to the authenticated server.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MOBTWIG_PRIVATE_MEMOS = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const PREFIX = 'mobtwig-private-memos-v1:';
  const DEMO_USERS = Object.freeze([
    Object.freeze({id:'demo-member-pine',name:'파란책갈피'}),
    Object.freeze({id:'demo-member-cloud',name:'느린구름'}),
    Object.freeze({id:'demo-member-leaf',name:'파란책갈피'})
  ]);
  const known = id => DEMO_USERS.some(user => user.id === id);
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
  function ensure(condition, message) { if (!condition) throw new Error(message); }
  function createStore(storage, getCurrentMemberId) {
    function owner(expected) {
      const current = getCurrentMemberId();
      ensure(typeof current === 'string' && current.length > 0, '로그인 후 이용해 주세요.');
      ensure(expected === undefined || expected === current, '계정이 변경되었습니다. 이 계정에서 다시 열어 주세요.');
      return current;
    }
    const key = id => PREFIX + encodeURIComponent(id);
    function read(id) {
      let raw;
      try { raw = storage.getItem(key(id)); }
      catch { throw new Error('목록을 불러오지 못했습니다. 저장 공간을 확인하고 다시 시도해 주세요.'); }
      if (raw === null) return {version:1,ownerId:id,blockedIds:[],notes:{},demoNames:{}};
      let state;
      try { state = JSON.parse(raw); } catch { throw new Error('저장된 메모 형식을 읽을 수 없습니다. 기존 자료는 보존했습니다.'); }
      ensure(plain(state) && state.version === 1 && state.ownerId === id && Array.isArray(state.blockedIds)
        && state.blockedIds.every(known) && new Set(state.blockedIds).size === state.blockedIds.length
        && plain(state.notes) && Object.entries(state.notes).every(([target,note]) => known(target) && plain(note) && typeof note.text === 'string' && Number.isFinite(note.updatedAt))
        && plain(state.demoNames) && Object.entries(state.demoNames).every(([target,name]) => known(target) && typeof name === 'string'),
      '저장된 메모 형식이 올바르지 않습니다. 기존 자료는 보존했습니다.');
      return state;
    }
    function change(expected, mutate) {
      const id = owner(expected), next = read(id);
      mutate(next, id);
      try { storage.setItem(key(id), JSON.stringify(next)); }
      catch { throw new Error('저장하지 못했습니다. 입력은 그대로 유지됩니다. 저장 공간을 확인한 뒤 다시 시도해 주세요.'); }
      return next;
    }
    function target(state, id) {
      ensure(known(id) && (state.blockedIds.includes(id) || own(state.notes,id)), '이 계정의 목록에서 이용자를 다시 선택해 주세요.');
    }
    return {
      load() { return read(owner()); },
      seedDemo(expected) { return change(expected, (state,id) => { state.blockedIds = [...new Set([...state.blockedIds,...DEMO_USERS.filter(u=>u.id!==id).map(u=>u.id)])]; }); },
      addDemoTarget(id, expected) { return change(expected, (state,member) => { ensure(known(id) && id!==member,'유효한 시연 이용자를 선택해 주세요.'); if (!state.blockedIds.includes(id)) state.blockedIds.push(id); }); },
      saveNote(id, text, expected) { return change(expected, state => { target(state,id); ensure(typeof text==='string' && text.trim().length>0,'메모를 입력해 주세요. 기존 메모를 없애려면 삭제를 선택해 주세요.'); state.notes[id]={text,updatedAt:Date.now()}; }); },
      deleteNote(id, expected) { return change(expected, state => { target(state,id); delete state.notes[id]; }); },
      unblock(id, expected) { return change(expected, state => { ensure(state.blockedIds.includes(id),'이미 시연 목록에서 해제된 이용자입니다.'); state.blockedIds=state.blockedIds.filter(value=>value!==id); }); },
      renameDemoTarget(id, name, expected) { return change(expected, state => { ensure(known(id),'유효한 시연 이용자를 선택해 주세요.');ensure(typeof name==='string' && name.trim(),'가상 닉네임을 입력해 주세요.');state.demoNames[id]=name.trim(); }); }
    };
  }
  return Object.freeze({PREFIX,DEMO_USERS,createStore});
});
