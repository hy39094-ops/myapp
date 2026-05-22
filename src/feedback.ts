// 제보 폼 → Formspree 백엔드로 전송.
// .env의 VITE_FORMSPREE_ENDPOINT가 설정돼 있어야 동작.
// 사진 첨부가 있으면 multipart/form-data, 없으면 JSON.

const ENDPOINT = import.meta.env.VITE_FORMSPREE_ENDPOINT ?? '';

export type FeedbackCategory =
  | 'closed'
  | 'wrong_location'
  | 'wrong_name'
  | 'new'
  | 'etc';

export const CATEGORY_LABEL: Record<FeedbackCategory, string> = {
  closed: '폐업',
  wrong_location: '위치 오류',
  wrong_name: '상호명 오류',
  new: '신규 추가',
  etc: '기타',
};

export interface StoreContext {
  id: number;
  name: string;
  address: string;
  lat: number;
  lng: number;
}

export interface UserLocationInput {
  lat: number;
  lng: number;
}

export interface FeedbackInput {
  category: FeedbackCategory;
  title?: string;
  body: string;
  storeContext?: StoreContext;
  userLocation?: UserLocationInput;
  photo?: File | null;
}

export class FeedbackConfigError extends Error {
  constructor() {
    super('제보 전송 설정이 안 되어 있어요. (VITE_FORMSPREE_ENDPOINT)');
    this.name = 'FeedbackConfigError';
  }
}

async function buildErrorFromResponse(res: Response): Promise<Error> {
  let detail = '';
  try {
    const data = (await res.json()) as { error?: string };
    detail = data?.error ?? '';
  } catch {
    // ignore
  }
  return new Error(
    `제보 전송 실패 (HTTP ${res.status})${detail ? `: ${detail}` : ''}`
  );
}

export async function sendFeedback(input: FeedbackInput): Promise<void> {
  if (!ENDPOINT) throw new FeedbackConfigError();

  const submittedAt = new Date().toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
  });
  const categoryLabel = CATEGORY_LABEL[input.category];
  const trimmedTitle = input.title?.trim() ?? '';
  const subject = trimmedTitle
    ? `[스포츠토토 제보·${categoryLabel}] ${trimmedTitle}`
    : `[스포츠토토 제보·${categoryLabel}]`;

  // 사진이 있으면 multipart
  if (input.photo) {
    const fd = new FormData();
    fd.append('category', categoryLabel);
    fd.append('title', trimmedTitle || '(제목 없음)');
    fd.append('message', input.body.trim());
    fd.append('submittedAt', submittedAt);
    fd.append(
      'userAgent',
      typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'
    );
    if (input.storeContext) {
      fd.append('storeId', String(input.storeContext.id));
      fd.append('storeName', input.storeContext.name);
      fd.append('storeAddress', input.storeContext.address);
      fd.append(
        'storeCoords',
        `${input.storeContext.lat},${input.storeContext.lng}`
      );
    }
    if (input.userLocation) {
      fd.append(
        'userLocation',
        `${input.userLocation.lat},${input.userLocation.lng}`
      );
    }
    fd.append('photo', input.photo);
    fd.append('_subject', subject);

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: fd,
    });
    if (!res.ok) throw await buildErrorFromResponse(res);
    return;
  }

  // 사진 없으면 JSON
  const payload: Record<string, unknown> = {
    category: categoryLabel,
    title: trimmedTitle || '(제목 없음)',
    message: input.body.trim(),
    submittedAt,
    userAgent:
      typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    _subject: subject,
  };
  if (input.storeContext) {
    payload.storeId = input.storeContext.id;
    payload.storeName = input.storeContext.name;
    payload.storeAddress = input.storeContext.address;
    payload.storeCoords = `${input.storeContext.lat},${input.storeContext.lng}`;
  }
  if (input.userLocation) {
    payload.userLocation = `${input.userLocation.lat},${input.userLocation.lng}`;
  }

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildErrorFromResponse(res);
}
