// 네이버/카카오/구글맵 길찾기 딥링크 모듈.
// 앱인토스 SDK openURL을 우선 시도하고, 실패하면 web URL로 fallback.
//
// 각 지도 앱 scheme 참고
// - 네이버:    nmap://route/public?dlat=...&dlng=...&dname=...&appname=...
//              by 옵션: public(대중교통) / car / walk
// - 카카오맵:  kakaomap://route?ep={lat},{lng}&by=CAR
//              by: CAR | PUBLICTRANSIT | FOOT | BICYCLE
// - 구글맵:    comgooglemaps://?daddr={lat},{lng}&directionsmode=driving
//              web: maps/dir/?api=1&destination=...

import { openURL } from '@apps-in-toss/web-framework';

const APP_NAME = 'im.toss.sportstoto-finder';

async function openMapApp(scheme: string, webFallback: string): Promise<void> {
  // 1) 앱인토스 SDK 시도 (외부 scheme도 시도해보고 안 되면 web)
  try {
    await openURL(scheme);
    return;
  } catch {
    // SDK가 scheme을 못 열면 web으로
  }
  try {
    await openURL(webFallback);
    return;
  } catch {
    // SDK 자체가 동작하지 않는 환경(일반 웹) → window 직접 사용
  }

  // 2) 일반 웹: 새 탭에서 web URL 열기 (모바일은 카카오/구글이 자동으로 앱 redirect)
  if (typeof window !== 'undefined') {
    window.open(webFallback, '_blank', 'noopener');
  }
}

export interface Destination {
  lat: number;
  lng: number;
  name: string;
  address: string;
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

export function navigateGoogle({ lat, lng }: Destination) {
  return openMapApp(
    `comgooglemaps://?daddr=${lat},${lng}&directionsmode=driving`,
    `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
  );
}
