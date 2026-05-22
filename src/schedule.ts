// 토토/프로토 회차 마감 정적 규칙 로더 + "다음 마감 N시간 후" 계산기.
// schedule-rules.json의 weekly 패턴을 KST 기준으로 해석.

export interface ScheduleRule {
  id: string;
  label: string;
  /** 0=일, 1=월, ..., 6=토. -1이면 매일. */
  weekday: number;
  /** "HH:mm" 형식 (KST). */
  closeTime: string;
  note?: string;
  /** 회차 계산 기준점. baseDate(YYYY-MM-DD KST)의 마감이 baseRound 회차. */
  baseRound?: number;
  baseDate?: string;
}

interface ScheduleFile {
  rules: ScheduleRule[];
}

export interface UpcomingDeadline {
  rule: ScheduleRule;
  /** 다음 마감 시각 (epoch ms, UTC). */
  at: number;
  /** 지금부터 마감까지 남은 ms. */
  remainingMs: number;
  /** baseRound/baseDate 가 있으면 계산된 회차 번호, 없으면 undefined. */
  round?: number;
}

const RULES_URL = '/schedule-rules.json';
// 8시간 캐시 (앱 세션 내)
let cache: { rules: ScheduleRule[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 8 * 60 * 60 * 1000;

export async function loadScheduleRules(): Promise<ScheduleRule[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.rules;
  }
  try {
    const res = await fetch(RULES_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as ScheduleFile;
    const rules = Array.isArray(data?.rules) ? data.rules : [];
    cache = { rules, fetchedAt: Date.now() };
    return rules;
  } catch (err) {
    console.warn('schedule-rules.json 로드 실패:', err);
    return [];
  }
}

// KST(UTC+9) 기준으로 "다음에 (weekday, HH:mm)가 도래하는 시각"을 epoch ms로.
// weekday === -1 이면 매일 → 오늘이 closeTime 이후면 내일 closeTime.
function computeNextOccurrence(rule: ScheduleRule, now: Date): number | null {
  const [hStr, mStr] = rule.closeTime.split(':');
  const hour = Number(hStr);
  const minute = Number(mStr);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;

  // KST 기준 현재 시각의 연/월/일/요일 추출
  const kstNow = new Date(now.getTime() + 9 * 3600 * 1000);
  const todayY = kstNow.getUTCFullYear();
  const todayM = kstNow.getUTCMonth();
  const todayD = kstNow.getUTCDate();
  const todayWeekday = kstNow.getUTCDay();
  const nowH = kstNow.getUTCHours();
  const nowMin = kstNow.getUTCMinutes();

  let daysAhead: number;
  if (rule.weekday < 0) {
    // 매일: 오늘이 closeTime 이전이면 오늘, 아니면 내일
    daysAhead =
      hour > nowH || (hour === nowH && minute > nowMin) ? 0 : 1;
  } else {
    daysAhead = (rule.weekday - todayWeekday + 7) % 7;
    // 오늘이 마감 요일이지만 시각이 이미 지났으면 다음 주
    if (
      daysAhead === 0 &&
      (hour < nowH || (hour === nowH && minute <= nowMin))
    ) {
      daysAhead = 7;
    }
  }

  // KST UTC ms로 환원
  const kstTargetMs = Date.UTC(todayY, todayM, todayD + daysAhead, hour, minute);
  return kstTargetMs - 9 * 3600 * 1000;
}

// 다음 마감 시각과 baseDate(baseRound 발생일)의 마감 시각 차이를 주(또는 일)로 계산해
// 현재 회차 번호를 추정. 주간 규칙은 7일 단위, 매일 규칙은 1일 단위로 증가.
function computeRound(rule: ScheduleRule, nextAtMs: number): number | undefined {
  if (rule.baseRound == null || !rule.baseDate) return undefined;
  // baseDate에 closeTime을 적용해 baseDate의 마감 시각(KST 기준)을 만든다
  const [hStr, mStr] = rule.closeTime.split(':');
  const hour = Number(hStr);
  const minute = Number(mStr);
  const [yStr, monStr, dStr] = rule.baseDate.split('-');
  const y = Number(yStr);
  const mon = Number(monStr) - 1;
  const d = Number(dStr);
  if (
    !Number.isFinite(y) ||
    !Number.isFinite(mon) ||
    !Number.isFinite(d) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    return undefined;
  }
  const baseUtcMs = Date.UTC(y, mon, d, hour, minute) - 9 * 3600 * 1000;
  const diffMs = nextAtMs - baseUtcMs;
  const stepMs = rule.weekday < 0 ? 24 * 3600 * 1000 : 7 * 24 * 3600 * 1000;
  const stepsElapsed = Math.round(diffMs / stepMs);
  return rule.baseRound + stepsElapsed;
}

/** 모든 규칙에서 다음 마감을 계산하고 가까운 순으로 정렬. */
export function computeUpcoming(
  rules: ScheduleRule[],
  now: Date = new Date()
): UpcomingDeadline[] {
  const out: UpcomingDeadline[] = [];
  for (const rule of rules) {
    const at = computeNextOccurrence(rule, now);
    if (at == null) continue;
    out.push({
      rule,
      at,
      remainingMs: at - now.getTime(),
      round: computeRound(rule, at),
    });
  }
  out.sort((a, b) => a.at - b.at);
  return out;
}

const KOREAN_WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

/** "축구토토 23회차 마감 5시간 23분 후" 같은 짧은 한국어 표현. 회차는 있을 때만. */
export function formatDeadline(deadline: UpcomingDeadline, now: Date = new Date()): string {
  const prefix =
    deadline.round != null
      ? `${deadline.rule.label} ${deadline.round}회차`
      : deadline.rule.label;
  const remainingMs = deadline.at - now.getTime();
  const remainingMin = Math.round(remainingMs / 60000);
  if (remainingMin < 60) {
    return `${prefix} 마감 ${Math.max(1, remainingMin)}분 후`;
  }
  if (remainingMin < 24 * 60) {
    const hr = Math.floor(remainingMin / 60);
    const min = remainingMin % 60;
    return min === 0
      ? `${prefix} 마감 ${hr}시간 후`
      : `${prefix} 마감 ${hr}시간 ${min}분 후`;
  }

  // 24시간 이상: 요일 + 시각으로 표시 (KST)
  const kst = new Date(deadline.at + 9 * 3600 * 1000);
  const weekday = KOREAN_WEEKDAY[kst.getUTCDay()];
  const hh = String(kst.getUTCHours()).padStart(2, '0');
  const mm = String(kst.getUTCMinutes()).padStart(2, '0');
  return `${prefix} 마감 ${weekday}요일 ${hh}:${mm}`;
}
