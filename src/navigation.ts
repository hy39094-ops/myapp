// 티맵/네이버/카카오맵 길찾기 딥링크 모듈.
// 앱인토스 SDK openURL을 우선 시도하고, 실패하면 web URL로 fallback.
//
// 각 지도 앱 scheme
// - 티맵:     tmap://route?goalname=...&goalx={lng}&goaly={lat}&goaltype=0
//             (goaltype 0 = 좌표 직접 지정)
// - 네이버:    nmap://route/public?dlat=...&dlng=...&dname=...&appname=...
// - 카카오맵:  kakaomap://route?ep={lat},{lng}&by=CAR

import { openURL } from '@apps-in-toss/web-framework';

const APP_NAME = 'im.toss.sportstoto-finder';

async function openMapApp(scheme: string, webFallback?: string): Promise<void> {
  try {
    await openURL(scheme);
    return;
  } catch {
    // SDK가 scheme을 못 열면 web으로
  }
  if (webFallback) {
    try {
      await openURL(webFallback);
      return;
    } catch {
      // SDK 자체 동작 불가 (일반 웹)
    }
    if (typeof window !== 'undefined') {
      window.open(webFallback, '_blank', 'noopener');
    }
  }
}

export interface Destination {
  lat: number;
  lng: number;
  name: string;
  address: string;
}

export function navigateTmap({ lat, lng, name }: Destination) {
  const enc = encodeURIComponent(name);
  // 티맵은 별도 web 길찾기 URL이 없음 — scheme만 시도
  return openMapApp(
    `tmap://route?goalname=${enc}&goalx=${lng}&goaly=${lat}&goaltype=0`
  );
}

export function navigateNaver({ lat, lng, name }: Destination) {
  const dname = encodeURIComponent(name);
  const query = encodeURIComponent(name);
  return openMapApp(
    `nmap://route/public?dlat=${lat}&dlng=${lng}&dname=${dname}&appname=${APP_NAME}`,
    `https://map.naver.com/p/search/${query}`
  );
}

export function navigateKakao({ lat, lng, name }: Destination) {
  const ename = encodeURIComponent(name);
  return openMapApp(
    `kakaomap://route?ep=${lat},${lng}&by=CAR`,
    `https://map.kakao.com/link/to/${ename},${lat},${lng}`
  );
}
