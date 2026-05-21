// 즐겨찾기 저장. localStorage 기반.
// 추후 SDK Storage(@apps-in-toss/web-framework Storage)로 교체할 수 있게
// store(read/write) 부분만 가볍게 추상화.

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

function load(): Set<number> {
  const raw = localStore.read();
  if (!raw) return new Set();
  try {
    const arr = JSON.parse(raw) as number[];
    if (Array.isArray(arr)) return new Set(arr.filter((n) => typeof n === 'number'));
  } catch {
    // ignore
  }
  return new Set();
}

function save(set: Set<number>) {
  localStore.write(JSON.stringify(Array.from(set)));
}

export function getFavorites(): Set<number> {
  return load();
}

export function isFavorite(id: number): boolean {
  return load().has(id);
}

/** id를 토글하고 새 Set 반환 */
export function toggleFavorite(id: number): Set<number> {
  const set = load();
  if (set.has(id)) set.delete(id);
  else set.add(id);
  save(set);
  return set;
}

export function removeFavorite(id: number): Set<number> {
  const set = load();
  set.delete(id);
  save(set);
  return set;
}
