// 제보 폼 → Formspree 백엔드로 전송.
// .env의 VITE_FORMSPREE_ENDPOINT가 설정돼 있어야 동작.

const ENDPOINT = import.meta.env.VITE_FORMSPREE_ENDPOINT ?? '';

export interface FeedbackInput {
  title?: string;
  body: string;
}

export class FeedbackConfigError extends Error {
  constructor() {
    super('제보 전송 설정이 안 되어 있어요. (VITE_FORMSPREE_ENDPOINT)');
    this.name = 'FeedbackConfigError';
  }
}

export async function sendFeedback({ title, body }: FeedbackInput): Promise<void> {
  if (!ENDPOINT) {
    throw new FeedbackConfigError();
  }

  const submittedAt = new Date().toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
  });

  const payload = {
    title: title?.trim() || '(제목 없음)',
    message: body.trim(),
    submittedAt,
    userAgent:
      typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    // Formspree subject 자동 설정
    _subject: title?.trim()
      ? `[스포츠토토 제보] ${title.trim()}`
      : '[스포츠토토 제보]',
  };

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let detail = '';
    try {
      const data = (await res.json()) as { error?: string };
      detail = data?.error ?? '';
    } catch {
      // ignore
    }
    throw new Error(`제보 전송 실패 (HTTP ${res.status})${detail ? `: ${detail}` : ''}`);
  }
}
