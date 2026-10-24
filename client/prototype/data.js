/* All stories, authors, covers, accounts and reviews are fictional demo data. */
window.MOBTWIG_DATA = {
  books: [
    {id:'moon',title:'달빛을 수선하는 밤',author:'윤슬',genre:'판타지',category:'소설',rating:4.9,reads:'12.4만',color:'#332c66',accent:'#e5d3aa',art:'moon',tag:'기억을 잇는 작은 공방',intro:'고장 난 물건에는 잊힌 기억이 남아 있다. 달빛 아래 작은 공방을 연 이안은 어느 날, 소리를 잃은 종 하나를 건네받는다. 물건을 고칠수록 선명해지는, 누군가의 오래된 약속.',chapters:['소리를 잃은 종','기억이 머무는 곳','은빛 서고의 방문자','오래된 약속','마지막 기록석','다시 울리는 종'],summary:['','이안은 소리를 잃은 종을 수선하기로 한다. 종의 표면에서 낯선 문양을 발견한다.','이안은 종에 남은 기억을 읽고 기록석의 존재를 알게 된다.','기록 관리인 세라는 이안에게 은빛 서고를 소개하고 종의 문양을 함께 조사한다.','이안과 세라는 종이 마을의 약속을 기록해 왔다는 사실을 확인한다.','이안은 마지막 기록석을 찾아 종의 기억을 복원할 준비를 마친다.']},
    {id:'garden',title:'비가 그친 뒤의 정원',author:'한여름',genre:'드라마',category:'소설',rating:4.8,reads:'8.2만',color:'#456357',accent:'#eadfbc',art:'garden',tag:'서툰 마음도 자라는 곳',intro:'비가 그친 오후, 오래 비어 있던 정원의 문이 열린다. 서로 다른 계절을 지나온 사람들이 작은 씨앗 하나를 나누며 다시 일상을 가꾸는 이야기.',chapters:['열린 문','씨앗을 나누는 오후','초록빛 편지','나란히 걷는 길']},
    {id:'stars',title:'별을 건너는 우체부',author:'윤슬',genre:'판타지',category:'소설',rating:4.7,reads:'9.6만',color:'#253f58',accent:'#e1c988',art:'stars',tag:'언젠가 닿을 우리의 편지',intro:'주소 없는 편지를 배달하는 우체부. 오늘의 목적지는 지도에 없는 별이다. 한 장의 편지가 은하 끝에서 시작하는 다정한 모험.',chapters:['주소 없는 편지','지도 밖의 별','느린 궤도','편지가 닿는 날']},
    {id:'sea',title:'파도가 남긴 문장',author:'서해',genre:'에세이',category:'에세이',rating:4.8,reads:'5.1만',color:'#47858c',accent:'#f1ead6',art:'sea',tag:'잠시 쉬어 가도 괜찮아',intro:'바닷가 마을에서 주워 모은 작고 평범한 문장들. 달리는 하루를 멈추고, 내 속도로 숨 쉬는 법을 다시 생각한다.',chapters:['밀물','아침의 해변','이름 없는 조개','다시 바다']},
    {id:'forest',title:'숲의 시간을 걷다',author:'정록',genre:'에세이',category:'에세이',rating:4.6,reads:'3.8만',color:'#344e40',accent:'#d6d9b1',art:'forest',tag:'느린 발걸음의 기록',intro:'나무의 시간을 따라 걷는 열두 번의 산책. 길가의 작은 풀과 계절의 표정에서 발견하는 일상의 다른 시선.',chapters:['숲 입구','나무의 나이','천천히 자라는 것','돌아오는 길']},
    {id:'city',title:'밤의 도서관',author:'이서진',genre:'추리·미스터리',category:'소설',rating:4.9,reads:'15.7만',color:'#624d65',accent:'#f0d6b1',art:'city',tag:'책이 사라지는 자정',intro:'자정마다 한 권씩 사라지는 책. 마지막 대출 기록을 따라가던 사서는, 도서관에 없는 방 하나를 발견한다.',chapters:['자정의 대출','없는 방','빈 서가','마지막 페이지']}
  ],
  dictionary: [
    {id:'ian',book:'moon',name:'이안',type:'인물',sub:'주인공',at:0,alias:'달빛 공방의 수선사',brief:'물건에 남은 기억을 읽는 젊은 수선사.',body:'마을 끝의 작은 달빛 공방을 운영한다. 오래된 물건에 손을 대면 그 물건에 남은 짧은 기억을 읽을 수 있다. 무엇이든 새것으로 바꾸기보다는, 원래의 모습을 이해하는 일을 좋아한다.'},
    {id:'workshop',book:'moon',name:'달빛 공방',type:'세계관',at:0,alias:'이야기가 다시 시작되는 곳',brief:'고장 난 물건과 오래된 마음이 모이는 공방.',body:'마을의 오래된 시계탑 아래에 자리한 작은 공방이다. 문 앞에는 이름 없는 꽃들이 피어 있고, 달이 뜨면 창문에 은빛이 머문다.'},
    {id:'stone',book:'moon',name:'기록석',type:'아이템',sub:'재료',at:3,alias:'기억을 품은 광물',brief:'주변의 소리와 기억을 담아 두는 푸른 돌.',body:'같은 장소에 오래 머무르면 주변의 기억을 흡수하는 광물이다. 기록석에 담긴 기억은 눈으로 볼 수 없지만, 이안은 손끝의 작은 진동으로 읽어 낸다.'},
    {id:'resonance',book:'moon',name:'공명',type:'개념',at:4,alias:'기억이 서로 응답하는 순간',brief:'두 물건의 기억이 같은 리듬으로 반응하는 현상.',body:'서로 연결된 기억을 품은 물건들이 가까이 놓이면 같은 리듬으로 빛나는 현상이다. 물건을 수선할 때 흩어진 기억의 관계를 찾는 단서가 된다.'},
    {id:'sera',book:'moon',name:'세라',type:'인물',sub:'조력자',at:6,alias:'은빛 서고의 기록 관리인',brief:'오래된 문서와 약속을 지키는 관리인.',body:'은빛 서고의 기록을 관리한다. 낯선 문양의 출처를 조사하던 이안을 만나 종에 담긴 기록을 함께 찾아 나선다.'},
    {id:'library',book:'moon',name:'은빛 서고',type:'세계관',at:7,alias:'마을의 약속을 모아 둔 곳',brief:'마을의 오래된 기록을 보관하는 서고.',body:'마을이 생겨난 뒤 맺어진 약속과 계약의 기록을 보관한다. 기록 관리인의 안내를 받아야 안쪽 서가에 들어갈 수 있다.'},
    {id:'promise',book:'moon',name:'새벽의 약속',type:'개념',at:10,alias:'종에 남겨진 마지막 기록',brief:'마을 사람들이 함께 맺었던 오래된 약속.',body:'마을 사람들이 서로의 시간을 지켜 주기로 맺은 약속. 종은 그 약속이 잊히지 않도록 매일 새벽 울려 왔다.'}
  ],
  reviews:[
    {id:'seed-1',book:'moon',owner:'seed-a',name:'책갈피',rating:5,text:'물건의 기억을 읽는다는 설정이 좋아요. 서두르지 않는 문장 덕분에 저도 천천히 읽게 됐어요.',date:'2026.10.20'},
    {id:'seed-2',book:'moon',owner:'seed-b',name:'초록문장',rating:4,text:'공방의 분위기가 눈앞에 그려집니다. 설정집을 바로 확인할 수 있어서 이야기 따라가기가 편하네요.',date:'2026.10.19'},
    {id:'seed-3',book:'garden',owner:'seed-c',name:'오후네시',rating:5,text:'하루 끝에 한 편씩 읽기 좋은 이야기예요.',date:'2026.10.18'}
  ]
};

// Fictional content types and ranking fixtures for the home prototype, not real metrics.
window.MOBTWIG_DATA.books.forEach((b,i)=>{
 b.workType=b.category==='에세이'?'book':'novel';
 b.demoRank={daily:[92,71,84,88,63,96][i],weekly:[97,86,93,78,91,81][i]};
});
const homeSamples=[
 ['hunter','퇴근 후에는 던전 관리자','도하','현대판타지','city','#33485c','#e1d4b5','평범한 하루 끝에 열린 다른 세계',98,83],
 ['sword','매화 아래 돌아온 검','청운','무협','forest','#454c57','#e5d5b3','다시 쥔 검끝에 피어난 약속',89,99],
 ['letter','계절을 건너 네게','소담','로맨스','garden','#866578','#f6dfc6','가장 느린 편지가 전한 마음',94,87],
 ['crown','왕관 대신 정원을','은하','로맨스판타지','stars','#655882','#ecdbb8','나의 결말은 내가 가꾸기로 했다',87,95]
];
for(const [id,title,author,genre,art,color,accent,tag,daily,weekly] of homeSamples){
 window.MOBTWIG_DATA.books.push({id,title,author,genre,art,color,accent,tag,workType:'novel',category:'소설',rating:4.7,reads:'2.3만',intro:tag+'. 홈 탐색을 위한 가상의 시연 작품입니다.',chapters:['새로운 시작','뜻밖의 만남','다음 이야기'],demoRank:{daily,weekly}});
}

// Search/filter fixtures are fictional and do not represent actual serial activity.
window.MOBTWIG_DATA.books.forEach((b,i)=>{
 b.schedule=i%3===0?['비정기']:i%3===1?['월','수','금']:['화','목','토','일'];
 b.serialStatus=b.workType==='book'||i===2?'완결':'연재 중';
 b.tags=b.id==='moon'?['기억','공방','힐링']:b.id==='garden'?['정원','일상','힐링']:[b.genre,b.id==='hunter'?'헌터':'성장'];
 b.demoViews=[124000,82000,96000,51000,38000,157000,23000,34000,45000,56000][i]||0;
 b.reads=b.demoViews>=10000?(b.demoViews/10000).toFixed(1)+'만':String(b.demoViews);
 b.demoUpdated=`2026-10-${String(10+i).padStart(2,'0')}`;
});
