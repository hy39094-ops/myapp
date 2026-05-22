// 미니앱 공유. 3단계 fallback.
// 1) 앱인토스 SDK getTossShareLink + share (네이티브 공유 시트)
// 2) navigator.share (모바일 웹)
// 3) 클립보드 복사 (마지막 수단)

import { getTossShareLink, share } from '@apps-in-toss/web-framework';
import { copyToClipboard } from './clipboard';

const APP_NAME = 'sports-toto';
const SHARE_MESSAGE =
  '🏪 전국 스포츠토토 판매점 6,000여 곳을 지도에서 한 번에! 내 주변 판매점 빠르게 찾아보세요.';

export type ShareResult = 'shared' | 'copied';

export async function shareMiniApp(): Promise<ShareResult> {
  // 1) 앱인토스 SDK
  try {
    const tossLink = await getTossShareLink(`intoss://${APP_NAME}`);
    await share({ message: `${SHARE_MESSAGE}\n${tossLink}` });
    return 'shared';
  } catch {
    // 환경 아니거나 사용자가 닫음 → 다음 fallback
  }

  // 2) Web Share API
  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function'
  ) {
    try {
      await navigator.share({
        title: '스포츠토토 판매점',
        text: SHARE_MESSAGE,
        url: typeof window !== 'undefined' ? window.location.href : undefined,
      });
      return 'shared';
    } catch (err) {
      // AbortError (사용자 취소)는 throw하지 말고 다음으로 안 넘어가게
      if ((err as { name?: string })?.name === 'AbortError') {
        throw err;
      }
    }
  }

  // 3) 클립보드 복사
  const fallbackText =
    typeof window !== 'undefined'
      ? `${SHARE_MESSAGE}\n${window.location.href}`
      : SHARE_MESSAGE;
  await copyToClipboard(fallbackText);
  return 'copied';
}

interface ShareStoreInput {
  name: string;
  address: string;
}

/** 특정 판매점 정보 공유. shareMiniApp과 같은 3단계 fallback. */
export async function shareStore(store: ShareStoreInput): Promise<ShareResult> {
  const message = `🏪 ${store.name}\n📍 ${store.address}\n\n전국 스포츠토토 판매점 찾기`;

  // 1) 앱인토스 SDK
  try {
    const tossLink = await getTossShareLink(`intoss://${APP_NAME}`);
    await share({ message: `${message}\n${tossLink}` });
    return 'shared';
  } catch {
    // 다음 fallback
  }

  // 2) Web Share API
  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function'
  ) {
    try {
      await navigator.share({
        title: store.name,
        text: message,
        url: typeof window !== 'undefined' ? window.location.href : undefined,
      });
      return 'shared';
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') {
        throw err;
      }
    }
  }

  // 3) 클립보드 복사
  const fallbackText =
    typeof window !== 'undefined'
      ? `${message}\n${window.location.href}`
      : message;
  await copyToClipboard(fallbackText);
  return 'copied';
}
