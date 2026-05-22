// 즐겨찾기 저장. localStorage 기반.
// 저장 포맷: { [storeId]: epochMs } — 추가한 시각을 함께 보관.
// 구버전(배열 형식 `[1, 5, 23]`)도 자동 마이그레이션.

const KEY = 'sportstoto:favorites:v1';

interface Store {
  read(): string | null;
  write(value: string): void;
}

const localStore: Store = {
  read() {
    if (typeof localStorage === 'undefined') return null;
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  write(value) {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(KEY, value);
    } catch {
      // QuotaExceeded 등 무시 (즐겨찾기는 작아서 거의 안 일어남)
    }
  },
};

function load(): Map<number, number> {
  const raw = localStore.read();
  if (!raw) return new Map();
  try {
    const parsed = JSON.parse(raw);
    // 구버전: number[] → 마이그레이션 (날짜 정보 없으므로 마이그레이션 시점으로 기록)
    if (Array.isArray(parsed)) {
      const now = Date.now();
      const map = new Map<number, number>();
      for (const v of parsed) {
        if (typeof v === 'number') map.set(v, now);
      }
      save(map);
      return map;
    }
    if (parsed && typeof parsed === 'object') {
      const map = new Map<number, number>();
      for (const [k, v] of Object.entries(parsed)) {
        const id = Number(k);
        if (!Number.isFinite(id)) continue;
        if (typeof v === 'number' && Number.isFinite(v)) map.set(id, v);
      }
      return map;
    }
  } catch {
    // ignore
  }
  return new Map();
}

function save(map: Map<number, number>) {
  const obj: Record<string, number> = {};
  for (const [id, ts] of map) obj[String(id)] = ts;
  localStore.write(JSON.stringify(obj));
}

/** id만 담긴 Set. has() 같은 기존 호출부를 위해 유지. */
export function getFavorites(): Set<number> {
  return new Set(load().keys());
}

/** id → 추가 시각(epoch ms) 맵 전체. */
export function getFavoritesMap(): Map<number, number> {
  return load();
}

/** 특정 가맹점의 추가 시각. 즐겨찾기 아니면 undefined. */
export function getFavoriteAddedAt(id: number): number | undefined {
  return load().get(id);
}

export function isFavorite(id: number): boolean {
  return load().has(id);
}

/** id를 토글하고 새 id Set 반환. 추가 시엔 현재 시각을 기록. */
export function toggleFavorite(id: number): Set<number> {
  const map = load();
  if (map.has(id)) map.delete(id);
  else map.set(id, Date.now());
  save(map);
  return new Set(map.keys());
}

export function removeFavorite(id: number): Set<number> {
  const map = load();
  map.delete(id);
  save(map);
  return new Set(map.keys());
}

/** 여러 id 한 번에 제거. 일괄 삭제용. */
export function removeFavoritesBatch(ids: Iterable<number>): Set<number> {
  const map = load();
  for (const id of ids) map.delete(id);
  save(map);
  return new Set(map.keys());
}
