// General high-school subjects in the 2022 revised national curriculum.
// The national subject groups and school-managed department sheets are separate.
const sources = [
  {title:'교육부 고시 제2022-33호 (2022.12.22.)', url:'https://www.moe.go.kr/boardCnts/viewRenew.do?boardID=141&boardSeq=93458&lev=0&m=0404&opType=N&s=moe&statusYN=W'},
  {title:'부산광역시교육청 고교학점제 지원센터 · 교과(군)별 과목 안내', url:'https://home.pen.go.kr/hscredit/cm/cntnts/cntntsView.do?cntntsId=3729&mi=17411'},
  {title:'경기고교학점제 지원센터 · 고등학교 과목 안내', url:'https://more.goe.go.kr/hagjeomje/subList/30300002205'}
];
const categories=['공통','일반선택','진로선택','융합선택'];
const groups=[
  {id:'korean',name:'국어'}, {id:'math',name:'수학'}, {id:'english',name:'영어'},
  {id:'social',name:'사회(역사/도덕 포함)'}, {id:'science',name:'과학'},
  {id:'pe',name:'체육'}, {id:'arts',name:'예술'}, {id:'technology',name:'기술·가정'},
  {id:'information',name:'정보'}, {id:'languages',name:'제2외국어'},
  {id:'hanmun',name:'한문'}, {id:'liberal',name:'교양'}
];
const entries=[];
function add(groupId,category,names,note='') {
  for(const name of names.split('|').filter(Boolean))entries.push({id:`nc22-${entries.length+1}`,name,groupId,category,note,official:true,curriculum:'2022 개정'});
}
add('korean','공통','공통국어1|공통국어2');
add('korean','일반선택','화법과 언어|독서와 작문|문학');
add('korean','진로선택','주제 탐구 독서|문학과 영상|직무 의사소통');
add('korean','융합선택','독서 토론과 글쓰기|매체 의사소통|언어생활 탐구');
add('math','공통','공통수학1|공통수학2');
add('math','공통','기본수학1|기본수학2','공통수학 대체 과목');
add('math','일반선택','대수|미적분Ⅰ|확률과 통계');
add('math','진로선택','기하|미적분Ⅱ|경제 수학|인공지능 수학|직무 수학');
add('math','융합선택','수학과 문화|실용 통계|수학과제 탐구');
add('english','공통','공통영어1|공통영어2');
add('english','공통','기본영어1|기본영어2','공통영어 대체 과목');
add('english','일반선택','영어Ⅰ|영어Ⅱ|영어 독해와 작문');
add('english','진로선택','영미 문학 읽기|영어 발표와 토론|심화 영어|심화 영어 독해와 작문|직무 영어');
add('english','융합선택','실생활 영어 회화|미디어 영어|세계 문화와 영어');
add('social','공통','한국사1|한국사2|통합사회1|통합사회2');
add('social','일반선택','세계시민과 지리|세계사|사회와 문화|현대사회와 윤리');
add('social','진로선택','한국지리 탐구|도시의 미래 탐구|동아시아 역사 기행|정치|법과 사회|경제|윤리와 사상|인문학과 윤리|국제 관계의 이해');
add('social','융합선택','여행지리|역사로 탐구하는 현대 세계|사회문제 탐구|금융과 경제생활|윤리문제 탐구|기후변화와 지속가능한 세계');
add('science','공통','통합과학1|통합과학2|과학탐구실험1|과학탐구실험2');
add('science','일반선택','물리학|화학|생명과학|지구과학');
add('science','진로선택','역학과 에너지|전자기와 양자|물질과 에너지|화학 반응의 세계|세포와 물질대사|생물의 유전|지구시스템과학|행성우주과학');
add('science','융합선택','과학의 역사와 문화|기후변화와 환경생태|융합과학 탐구');
add('pe','일반선택','체육1|체육2');
add('pe','진로선택','운동과 건강|스포츠 문화|스포츠 과학');
add('pe','융합선택','스포츠 생활1|스포츠 생활2');
add('arts','일반선택','음악|미술|연극');
add('arts','진로선택','음악 연주와 창작|음악 감상과 비평|미술 창작|미술 감상과 비평');
add('arts','융합선택','음악과 미디어|미술과 매체');
add('technology','일반선택','기술·가정');
add('technology','진로선택','로봇과 공학세계|생활과학 탐구');
add('technology','융합선택','창의 공학 설계|지식 재산 일반|생애 설계와 자립|아동발달과 부모');
add('information','일반선택','정보');
add('information','진로선택','인공지능 기초|데이터 과학');
add('information','융합선택','소프트웨어와 생활');
const languages=[['독일어','독일어권 문화'],['프랑스어','프랑스어권 문화'],['스페인어','스페인어권 문화'],['중국어','중국 문화'],['일본어','일본 문화'],['러시아어','러시아 문화'],['아랍어','아랍 문화'],['베트남어','베트남 문화']];
for(const [name,culture] of languages){add('languages','일반선택',name);add('languages','진로선택',`${name} 회화|심화 ${name}`);add('languages','융합선택',culture);}
add('hanmun','일반선택','한문');add('hanmun','진로선택','한문 고전 읽기');add('hanmun','융합선택','언어생활과 한자');
add('liberal','일반선택','진로와 직업|생태와 환경');
add('liberal','진로선택','인간과 철학|논리와 사고|인간과 심리|교육의 이해|삶과 종교|보건');
add('liberal','융합선택','인간과 경제활동|논술');
const catalog=entries;
const normalize=name=>String(name??'').replace(/\s/g,'').replaceAll('Ⅰ','I').replaceAll('Ⅱ','II').replace(/[·⋅ㆍ]/g,'·');
const suggestedGroup=name=>({국어:'korean',수학:'math',영어:'english',사회:'social',역사:'social',윤리:'social',과학:'science',체육:'pe',미술:'arts',음악:'arts',예술:'arts',정보:'information',기술가정:'technology','기술·가정':'technology',일본어:'languages',중국어:'languages',제2외국어:'languages',한문:'hanmun',진로:'liberal',교양:'liberal'})[name]??'all';

export {sources,categories,groups,catalog,normalize,suggestedGroup};
