// 국내 프로 스포츠 홈 경기장 데이터.
// 좌표는 근사값이며 실제와 ±100m 정도 오차가 있을 수 있음.
// 운영 중 정확도가 필요하면 KSPO/리그 공식 자료로 검증 후 보정 권장.

export type Sport = 'basketball' | 'baseball' | 'football' | 'volleyball';
export type League =
  | 'KBO'
  | 'K1'
  | 'K2'
  | 'KBL'
  | 'WKBL'
  | 'V-M'
  | 'V-F';

export interface Stadium {
  id: number;
  name: string;
  team: string;
  sport: Sport;
  league: League;
  lat: number;
  lng: number;
}

export const SPORT_LABEL: Record<Sport, string> = {
  basketball: '농구',
  baseball: '야구',
  football: '축구',
  volleyball: '배구',
};

export const LEAGUE_LABEL: Record<League, string> = {
  KBO: 'KBO',
  K1: 'K1',
  K2: 'K2',
  KBL: 'KBL',
  WKBL: 'WKBL',
  'V-M': 'V-리그 남자',
  'V-F': 'V-리그 여자',
};

// 경기장 chooser 칩에 표기되는 이름 (사용자 친화적인 표현)
export const LEAGUE_CHIP_LABEL: Record<League, string> = {
  KBO: '프로야구',
  K1: 'K리그1',
  K2: 'K리그2',
  'V-M': '남자배구',
  'V-F': '여자배구',
  KBL: '남자농구',
  WKBL: '여자농구',
};

// chip 노출 순서 (인기 순)
export const LEAGUE_CHIP_ORDER: League[] = [
  'KBO',
  'K1',
  'K2',
  'V-M',
  'V-F',
  'KBL',
  'WKBL',
];

// 스포츠 -> 포함 리그 매핑
export const SPORT_LEAGUES: Record<Sport, League[]> = {
  basketball: ['KBL', 'WKBL'],
  baseball: ['KBO'],
  football: ['K1', 'K2'],
  volleyball: ['V-M', 'V-F'],
};

export const STADIUMS: Stadium[] = [
  // KBO (10개팀, 잠실은 두산/LG 공용)
  { id: 101, name: '잠실야구장', team: '두산 베어스 / LG 트윈스', sport: 'baseball', league: 'KBO', lat: 37.5122, lng: 127.0719 },
  { id: 102, name: '인천 SSG 랜더스필드', team: 'SSG 랜더스', sport: 'baseball', league: 'KBO', lat: 37.4370, lng: 126.6932 },
  { id: 103, name: '고척스카이돔', team: '키움 히어로즈', sport: 'baseball', league: 'KBO', lat: 37.4982, lng: 126.8675 },
  { id: 104, name: '창원NC파크', team: 'NC 다이노스', sport: 'baseball', league: 'KBO', lat: 35.2226, lng: 128.5806 },
  { id: 105, name: '사직야구장', team: '롯데 자이언츠', sport: 'baseball', league: 'KBO', lat: 35.1942, lng: 129.0617 },
  { id: 106, name: '대구삼성라이온즈파크', team: '삼성 라이온즈', sport: 'baseball', league: 'KBO', lat: 35.8410, lng: 128.6810 },
  { id: 107, name: '한화생명 이글스파크', team: '한화 이글스', sport: 'baseball', league: 'KBO', lat: 36.3170, lng: 127.4291 },
  { id: 108, name: '수원KT위즈파크', team: 'KT 위즈', sport: 'baseball', league: 'KBO', lat: 37.2998, lng: 127.0096 },
  { id: 109, name: '광주-기아 챔피언스 필드', team: 'KIA 타이거즈', sport: 'baseball', league: 'KBO', lat: 35.1683, lng: 126.8889 },

  // K1 (12팀)
  { id: 201, name: '울산문수경기장', team: '울산 HD', sport: 'football', league: 'K1', lat: 35.5388, lng: 129.2592 },
  { id: 202, name: '서울월드컵경기장', team: 'FC 서울', sport: 'football', league: 'K1', lat: 37.5681, lng: 126.8978 },
  { id: 203, name: '춘천송암스포츠타운', team: '강원 FC', sport: 'football', league: 'K1', lat: 37.8717, lng: 127.7355 },
  { id: 204, name: '광주축구전용구장', team: '광주 FC', sport: 'football', league: 'K1', lat: 35.1521, lng: 126.8847 },
  { id: 205, name: '김천종합운동장', team: '김천 상무', sport: 'football', league: 'K1', lat: 36.1330, lng: 128.1109 },
  { id: 206, name: '인천축구전용경기장', team: '인천 유나이티드', sport: 'football', league: 'K1', lat: 37.4683, lng: 126.6276 },
  { id: 207, name: '전주월드컵경기장', team: '전북 현대', sport: 'football', league: 'K1', lat: 35.7884, lng: 127.1198 },
  { id: 208, name: '포항스틸야드', team: '포항 스틸러스', sport: 'football', league: 'K1', lat: 36.0083, lng: 129.3672 },
  { id: 209, name: '수원종합운동장', team: '수원 FC', sport: 'football', league: 'K1', lat: 37.2871, lng: 127.0098 },
  { id: 210, name: 'DGB대구은행파크', team: '대구 FC', sport: 'football', league: 'K1', lat: 35.8593, lng: 128.5840 },
  { id: 211, name: '제주월드컵경기장', team: '제주 유나이티드', sport: 'football', league: 'K1', lat: 33.2462, lng: 126.4111 },
  { id: 212, name: '대전월드컵경기장', team: '대전 하나시티즌', sport: 'football', league: 'K1', lat: 36.3661, lng: 127.3210 },

  // K2 (13팀)
  { id: 301, name: '부산아시아드주경기장', team: '부산 아이파크', sport: 'football', league: 'K2', lat: 35.1934, lng: 129.0570 },
  { id: 302, name: '창원축구센터', team: '경남 FC', sport: 'football', league: 'K2', lat: 35.2227, lng: 128.6802 },
  { id: 303, name: '수원월드컵경기장', team: '수원 삼성 블루윙즈', sport: 'football', league: 'K2', lat: 37.2861, lng: 127.0367 },
  { id: 304, name: '안양종합운동장', team: '안양 FC', sport: 'football', league: 'K2', lat: 37.3877, lng: 126.9352 },
  { id: 305, name: '부천종합운동장', team: '부천 FC 1995', sport: 'football', league: 'K2', lat: 37.4742, lng: 126.7639 },
  { id: 306, name: '천안종합운동장', team: '천안 시티 FC', sport: 'football', league: 'K2', lat: 36.8049, lng: 127.1480 },
  { id: 307, name: '청주종합경기장', team: '충북 청주 FC', sport: 'football', league: 'K2', lat: 36.6303, lng: 127.4731 },
  { id: 308, name: '이순신종합운동장', team: '충남 아산 FC', sport: 'football', league: 'K2', lat: 36.7857, lng: 127.0014 },
  { id: 309, name: '탄천종합운동장', team: '성남 FC', sport: 'football', league: 'K2', lat: 37.4194, lng: 127.1289 },
  { id: 310, name: '목동종합운동장', team: '서울 이랜드 FC', sport: 'football', league: 'K2', lat: 37.5311, lng: 126.8740 },
  { id: 311, name: '김포솔터축구장', team: '김포 FC', sport: 'football', league: 'K2', lat: 37.6132, lng: 126.7257 },
  { id: 312, name: '안산와스타디움', team: '안산 그리너스 FC', sport: 'football', league: 'K2', lat: 37.3120, lng: 126.8326 },
  { id: 313, name: '화성종합경기타운', team: '화성 FC', sport: 'football', league: 'K2', lat: 37.1995, lng: 126.8311 },

  // KBL 남자 농구 (10팀)
  { id: 401, name: '안양체육관', team: '안양 정관장 레드부스터스', sport: 'basketball', league: 'KBL', lat: 37.3925, lng: 126.9282 },
  { id: 402, name: '원주종합체육관', team: '원주 DB 프로미', sport: 'basketball', league: 'KBL', lat: 37.3477, lng: 127.9494 },
  { id: 403, name: '잠실학생체육관', team: '서울 SK 나이츠', sport: 'basketball', league: 'KBL', lat: 37.5163, lng: 127.0728 },
  { id: 404, name: '잠실실내체육관', team: '서울 삼성 썬더스', sport: 'basketball', league: 'KBL', lat: 37.5159, lng: 127.0724 },
  { id: 405, name: '수원KT소닉붐아레나', team: '수원 KT 소닉붐', sport: 'basketball', league: 'KBL', lat: 37.2611, lng: 127.0289 },
  { id: 406, name: '사직실내체육관', team: '부산 KCC 이지스', sport: 'basketball', league: 'KBL', lat: 35.1934, lng: 129.0617 },
  { id: 407, name: '대구실내체육관', team: '대구 한국가스공사 페가수스', sport: 'basketball', league: 'KBL', lat: 35.8411, lng: 128.6790 },
  { id: 408, name: '울산동천체육관', team: '울산 현대모비스 피버스', sport: 'basketball', league: 'KBL', lat: 35.5478, lng: 129.2603 },
  { id: 409, name: '창원실내체육관', team: '창원 LG 세이커스', sport: 'basketball', league: 'KBL', lat: 35.2295, lng: 128.6818 },
  { id: 410, name: '고양체육관', team: '고양 소노 스카이거너스', sport: 'basketball', league: 'KBL', lat: 37.6580, lng: 126.8326 },

  // WKBL 여자 농구 (6팀)
  { id: 501, name: '청주실내체육관', team: '청주 KB 스타즈', sport: 'basketball', league: 'WKBL', lat: 36.6385, lng: 127.4684 },
  { id: 502, name: '부산금정체육관', team: '부산 BNK 썸', sport: 'basketball', league: 'WKBL', lat: 35.2483, lng: 129.0978 },
  { id: 503, name: '용인실내체육관', team: '용인 삼성생명 블루밍스', sport: 'basketball', league: 'WKBL', lat: 37.2410, lng: 127.1772 },
  { id: 504, name: '인천도원체육관', team: '인천 신한은행 에스버드', sport: 'basketball', league: 'WKBL', lat: 37.4690, lng: 126.6363 },
  { id: 505, name: '이순신체육관', team: '아산 우리은행 우리WON', sport: 'basketball', league: 'WKBL', lat: 36.7857, lng: 127.0014 },
  { id: 506, name: '부천실내체육관', team: '부천 하나원큐', sport: 'basketball', league: 'WKBL', lat: 37.4825, lng: 126.7758 },

  // V-리그 남자 (7팀)
  { id: 601, name: '안산 상록수체육관', team: '안산 OK금융그룹 읏맨', sport: 'volleyball', league: 'V-M', lat: 37.3173, lng: 126.8538 },
  { id: 602, name: '인천 계양체육관', team: '인천 대한항공 점보스', sport: 'volleyball', league: 'V-M', lat: 37.5394, lng: 126.7375 },
  { id: 603, name: '천안 유관순체육관', team: '천안 현대캐피탈 스카이워커스', sport: 'volleyball', league: 'V-M', lat: 36.7967, lng: 127.1430 },
  { id: 604, name: '의정부 실내체육관', team: '의정부 KB손해보험 스타즈', sport: 'volleyball', league: 'V-M', lat: 37.7430, lng: 127.0383 },
  { id: 605, name: '수원 실내체육관', team: '수원 한국전력 빅스톰', sport: 'volleyball', league: 'V-M', lat: 37.2885, lng: 127.0287 },
  { id: 606, name: '대전 충무체육관', team: '대전 삼성화재 블루팡스', sport: 'volleyball', league: 'V-M', lat: 36.3358, lng: 127.4188 },
  { id: 607, name: '장충체육관', team: '서울 우리카드 우리원', sport: 'volleyball', league: 'V-M', lat: 37.5598, lng: 127.0058 },

  // V-리그 여자 (7팀)
  { id: 701, name: '화성 실내체육관', team: '화성 IBK기업은행 알토스', sport: 'volleyball', league: 'V-F', lat: 37.2002, lng: 126.8333 },
  { id: 702, name: '인천 삼산월드체육관', team: '인천 흥국생명 핑크스파이더스', sport: 'volleyball', league: 'V-F', lat: 37.5048, lng: 126.7239 },
  { id: 703, name: '수원 실내체육관 (여자)', team: '수원 현대건설 힐스테이트', sport: 'volleyball', league: 'V-F', lat: 37.2885, lng: 127.0287 },
  { id: 704, name: '김천 실내체육관', team: '김천 한국도로공사 하이패스', sport: 'volleyball', league: 'V-F', lat: 36.1330, lng: 128.1109 },
  { id: 705, name: '페퍼스타디움', team: '광주 페퍼저축은행 AI 페퍼스', sport: 'volleyball', league: 'V-F', lat: 35.1383, lng: 126.8030 },
  { id: 706, name: '대전 충무체육관 (여자)', team: '대전 정관장 레드스파크스', sport: 'volleyball', league: 'V-F', lat: 36.3358, lng: 127.4188 },
  { id: 707, name: '장충체육관 (여자)', team: '서울 GS칼텍스 KIXX', sport: 'volleyball', league: 'V-F', lat: 37.5598, lng: 127.0058 },
];
