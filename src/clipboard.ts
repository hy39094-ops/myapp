// 클립보드 복사 유틸.
// 앱인토스 SDK → navigator.clipboard → execCommand 순서로 fallback.

import { setClipboardText } from '@apps-in-toss/web-framework';

export async function copyToClipboard(text: string): Promise<void> {
  // 1) 앱인토스 SDK
  try {
    await setClipboardText(text);
    return;
  } catch {
    // SDK 사용 불가 또는 권한 거부 → 다음 방법으로
  }

  // 2) Async Clipboard API
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === 'function'
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // 다음 방법으로
    }
  }

  // 3) Legacy fallback
  if (typeof document !== 'undefined') {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      const ok = document.execCommand('copy');
      if (!ok) throw new Error('execCommand 실패');
    } finally {
      document.body.removeChild(textarea);
    }
    return;
  }

  throw new Error('클립보드 복사를 지원하지 않는 환경이에요.');
}
