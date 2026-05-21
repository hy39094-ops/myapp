// 앱인토스 SDK와 브라우저 navigator.geolocation을 모두 활용한 위치 모듈.
//
// PC 브라우저에서는 미니앱 SDK 브릿지가 없어서:
//  - SDK 호출이 PermissionError를 던지거나, hang하거나, mock 응답을 줄 수 있다.
// 따라서 SDK 호출에 timeout을 걸고, SDK가 실패하면 권한 에러 여부와 무관하게
// 무조건 브라우저 API로 fallback해서 시도한다.

import { Accuracy, getCurrentLocation } from '@apps-in-toss/web-framework';

export class LocationPermissionDeniedError extends Error {
  constructor() {
    super('위치 권한이 거부되었어요.');
    this.name = 'LocationPermissionDeniedError';
  }
}

export class LocationUnavailableError extends Error {
  constructor(message = '위치 정보를 가져올 수 없어요.') {
    super(message);
    this.name = 'LocationUnavailableError';
  }
}

export type LatLng = [number, number];

const SDK_TIMEOUT_MS = 3500;

function isPermissionError(err: unknown) {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: string; constructor?: { name?: string } }).name ?? '';
  const ctorName = (err as { constructor?: { name?: string } }).constructor?.name ?? '';
  return /Permission/i.test(name) || /Permission/i.test(ctorName);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timeout`));
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

async function fetchViaSdk(): Promise<LatLng> {
  const res = await withTimeout(
    getCurrentLocation({ accuracy: Accuracy.Balanced }),
    SDK_TIMEOUT_MS,
    'SDK getCurrentLocation'
  );
  const lat = res?.coords?.latitude;
  const lng = res?.coords?.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    throw new LocationUnavailableError();
  }
  return [lat, lng];
}

async function fetchViaBrowser(): Promise<LatLng> {
  if (!('geolocation' in navigator)) {
    throw new LocationUnavailableError('이 기기에서는 위치 서비스를 사용할 수 없어요.');
  }
  return new Promise<LatLng>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve([pos.coords.latitude, pos.coords.longitude]),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          reject(new LocationPermissionDeniedError());
        } else {
          reject(new LocationUnavailableError(err.message));
        }
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 30_000 }
    );
  });
}

/**
 * 현재 위치를 받아온다.
 *
 * 1) 앱인토스 SDK getCurrentLocation 시도 (3.5초 timeout)
 *    - 실패 사유와 관계없이 무조건 2)로 fallback
 *    - 권한 에러일 때 askPermission=true면 SDK 권한 다이얼로그 띄우고 재시도
 * 2) 브라우저 navigator.geolocation 시도
 *
 * 둘 다 권한 거부면 LocationPermissionDeniedError.
 */
export async function fetchCurrentLocation(options?: {
  askPermission?: boolean;
}): Promise<LatLng> {
  const askPermission = options?.askPermission ?? false;
  let sdkDeniedPermission = false;

  // 1) SDK
  try {
    return await fetchViaSdk();
  } catch (err) {
    if (isPermissionError(err)) {
      sdkDeniedPermission = true;
      if (askPermission) {
        try {
          const openDialog = (
            getCurrentLocation as unknown as {
              openPermissionDialog?: () => Promise<unknown>;
            }
          ).openPermissionDialog;
          if (typeof openDialog === 'function') {
            await openDialog();
            return await fetchViaSdk();
          }
        } catch {
          // 권한 다이얼로그 자체가 실패해도 브라우저 fallback 시도
        }
      }
    }
    // 어떤 에러든 브라우저 시도
  }

  // 2) 브라우저
  try {
    return await fetchViaBrowser();
  } catch (err) {
    if (err instanceof LocationPermissionDeniedError) {
      // SDK도 거부, 브라우저도 거부 → 진짜 거부
      throw err;
    }
    // 브라우저가 다른 이유로 실패했고 SDK도 권한 거부였다면 권한 에러로 통일
    if (sdkDeniedPermission) {
      throw new LocationPermissionDeniedError();
    }
    throw err;
  }
}

export function canRequestPermission(): boolean {
  return (
    typeof (
      getCurrentLocation as unknown as {
        openPermissionDialog?: () => Promise<unknown>;
      }
    ).openPermissionDialog === 'function'
  );
}
