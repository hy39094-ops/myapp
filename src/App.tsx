import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchCurrentLocation,
  LocationPermissionDeniedError,
  type LatLng,
} from './location';
import { copyToClipboard } from './clipboard';
import { navigateKakao, navigateNaver, navigateTmap } from './navigation';
import {
  CATEGORY_LABEL,
  sendFeedback,
  type FeedbackCategory,
  type StoreContext,
} from './feedback';
import {
  LEAGUE_CHIP_LABEL,
  LEAGUE_CHIP_ORDER,
  STADIUMS,
  type League,
  type Stadium,
} from './stadiums';
import {
  computeUpcoming,
  formatDeadline,
  loadScheduleRules,
  type ScheduleRule,
} from './schedule';
import { shareMiniApp, shareStore } from './share';
import { haversineMeters, formatDistance } from './distance';
import {
  getFavoriteAddedAt,
  getFavorites,
  removeFavoritesBatch,
  toggleFavorite,
} from './favorites';

interface Store {
  id: number;
  name: string;
  address: string;
  region: string;
  lat: number;
  lng: number;
}

const HEADER_HEIGHT = 96;
const FOOTER_HEIGHT = 52;
type View =
  | 'map'
  | 'feedback'
  | 'nearby'
  | 'favorites'
  | 'search'
  | 'stadiums';
const NEARBY_LIMIT = 100;

const ADMIN_CODE = import.meta.env.VITE_ADMIN_CODE ?? '';
const FORMSPREE_DASHBOARD = 'https://formspree.io/forms';

// URL의 ?admin=값 이 ADMIN_CODE 와 같으면 관리자 모드.
function checkIsAdmin(): boolean {
  if (typeof window === 'undefined') return false;
  if (!ADMIN_CODE) return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('admin') === ADMIN_CODE;
  } catch {
    return false;
  }
}
const CLIENT_ID = import.meta.env.VITE_NAVER_MAP_CLIENT_ID;

const NAVER_MAPS_SRC = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${CLIENT_ID}`;
const MARKER_CLUSTERING_SRC = '/lib/MarkerClustering.js';

// stores.json은 GitHub Actions가 매일 KST 08:00에 갱신해서 main 브랜치에 푸시함.
// 미니앱은 raw URL로 항상 최신을 받아오고, 네트워크 실패 시 빌드에 포함된 로컬 파일로 fallback.
const REMOTE_STORES_URL =
  'https://raw.githubusercontent.com/hy39094-ops/myapp/main/public/stores.json';
const LOCAL_STORES_URL = '/stores.json';

// 단일 <script>를 멱등하게 로드
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${src}"]`
    );
    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () =>
        reject(new Error(`Failed to load ${src}`))
      );
      return;
    }
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = () => {
      el.dataset.loaded = 'true';
      resolve();
    };
    el.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(el);
  });
}

// 네이버 지도 SDK + MarkerClustering을 순차 로드
function useNaverMapSdk() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!CLIENT_ID) {
        setError('네이버 지도 Client ID가 설정되지 않았어요.');
        return;
      }
      try {
        await loadScript(NAVER_MAPS_SRC);
        if (cancelled) return;
        await loadScript(MARKER_CLUSTERING_SRC);
        if (cancelled) return;
        setReady(true);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '지도 SDK 로드 실패');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { ready, error };
}

// 클러스터 단계별 아이콘 (구간마다 다른 크기)
function clusterIconHtml(label: string | number, size: number) {
  const inner = size - 8;
  return `
    <div style="
      cursor:pointer;
      width:${size}px;height:${size}px;
      display:flex;align-items:center;justify-content:center;
      border-radius:50%;
      background:rgba(49,130,246,0.22);
    ">
      <div style="
        width:${inner}px;height:${inner}px;
        border-radius:50%;
        background:#3182f6;
        color:#fff;
        font-weight:700;
        font-size:${size >= 56 ? 14 : 12}px;
        display:flex;align-items:center;justify-content:center;
        box-shadow:0 2px 8px rgba(0,0,0,0.15);
      ">${label}</div>
    </div>
  `;
}

const CLUSTER_SIZES = [40, 48, 56, 64, 72] as const;

function buildClusterIcons() {
  const naver = window.naver!.maps;
  return CLUSTER_SIZES.map((size) => ({
    content: clusterIconHtml('', size),
    size: new naver.Size(size, size),
    anchor: new naver.Point(size / 2, size / 2),
  }));
}

// stylingFunction이 호출될 때 클러스터 마커의 아이콘을 count가 박힌 새 아이콘으로 교체.
// MarkerClustering이 indexGenerator로 단계별 setIcon을 먼저 호출한 뒤 stylingFunction을 호출하므로,
// 여기서 현재 아이콘 크기를 그대로 유지하면서 label만 갱신.
function styleCluster(clusterMarker: NaverMarker, count: number) {
  const naver = window.naver!.maps;
  const icons = (clusterMarker as unknown as { getIcon: () => { size: NaverSize } }).getIcon();
  const size = icons?.size?.width ?? 40;
  (clusterMarker as unknown as { setIcon: (icon: unknown) => void }).setIcon({
    content: clusterIconHtml(count.toLocaleString(), size),
    size: new naver.Size(size, size),
    anchor: new naver.Point(size / 2, size / 2),
  });
}

// 가맹점 핀 아이콘 (작은 빨간 핀)
function storeMarkerIcon() {
  const naver = window.naver!.maps;
  return {
    content: `
      <div style="position:relative;width:28px;height:36px;">
        <svg viewBox="0 0 28 36" width="28" height="36" xmlns="http://www.w3.org/2000/svg">
          <path d="M14 0C6.27 0 0 6.27 0 14c0 9.5 14 22 14 22s14-12.5 14-22C28 6.27 21.73 0 14 0z"
                fill="#ef4444" stroke="#fff" stroke-width="2"/>
          <circle cx="14" cy="14" r="5" fill="#fff"/>
        </svg>
      </div>
    `,
    size: new naver.Size(28, 36),
    anchor: new naver.Point(14, 36),
  };
}

function userMarkerIcon() {
  const naver = window.naver!.maps;
  return {
    content: `
      <div style="
        width:18px;height:18px;
        background:#3182f6;
        border:3px solid #fff;
        border-radius:50%;
        box-shadow:0 0 0 6px rgba(49,130,246,0.22);
      "></div>
    `,
    size: new naver.Size(28, 28),
    anchor: new naver.Point(14, 14),
  };
}

// 주소에서 구/시 토큰(두 번째 공백 분리 토큰) 추출. 예: '서울 강남구 ...' → '강남구'
function extractSubRegion(address: string): string {
  return address.trim().split(/\s+/)[1] ?? '';
}

// 마지막으로 본 지도 중심/줌 (재진입 시 복원)
const SAVED_VIEW_KEY = 'sportstoto:lastView:v1';
interface SavedView {
  lat: number;
  lng: number;
  zoom: number;
}
function loadSavedView(): SavedView | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SAVED_VIEW_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.lat === 'number' &&
      typeof parsed.lng === 'number' &&
      typeof parsed.zoom === 'number'
    ) {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}
function saveLastView(view: SavedView) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SAVED_VIEW_KEY, JSON.stringify(view));
  } catch {
    // ignore
  }
}

// 즐겨찾기 추가 시각을 yyyy.mm.dd 로 포맷 (로컬 타임존)
function formatAddedDate(epochMs: number): string {
  const d = new Date(epochMs);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}.${m}.${day}`;
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 바텀시트 메뉴 항목
function MenuItem({
  icon,
  label,
  description,
  onClick,
}: {
  icon: string;
  label: string;
  description?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        width: '100%',
        padding: '14px 16px',
        border: 'none',
        background: 'var(--surface)',
        textAlign: 'left',
        borderRadius: 12,
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <span
        style={{
          fontSize: 24,
          width: 36,
          height: 36,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--surface-2)',
          borderRadius: 10,
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)' }}>
          {label}
        </span>
        {description && (
          <span
            style={{
              fontSize: 12,
              color: 'var(--text-3)',
              marginTop: 2,
            }}
          >
            {description}
          </span>
        )}
      </span>
    </button>
  );
}

type ListMode = 'nearby' | 'favorites' | 'stadium';
type SortKey = 'distance' | 'added' | 'name';
interface MapBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}
const RADIUS_OPTIONS_KM = [1, 2, 3, 5, 10] as const;

// 칩(필터/정렬 버튼)
function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flexShrink: 0,
        height: 32,
        padding: '0 12px',
        border: 'none',
        borderRadius: 16,
        background: active ? 'var(--accent)' : 'var(--surface-2)',
        color: active ? '#fff' : 'var(--text-2)',
        fontSize: 13,
        fontWeight: 600,
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  );
}

function FavoritesEmptyState({ onClose }: { onClose: () => void }) {
  return (
    <div style={{ padding: '60px 24px 40px', textAlign: 'center' }}>
      <div style={{ fontSize: 64, marginBottom: 20, lineHeight: 1 }}>⭐</div>
      <div
        style={{
          fontSize: 16,
          fontWeight: 700,
          color: 'var(--text-1)',
          marginBottom: 8,
        }}
      >
        아직 즐겨찾기한 판매점이 없어요
      </div>
      <div
        style={{
          fontSize: 13,
          color: 'var(--text-3)',
          lineHeight: 1.6,
          marginBottom: 24,
          whiteSpace: 'pre-line',
        }}
      >
        지도에서 핀을 누르고 ⭐를 누르면{'\n'}이곳에 모아볼 수 있어요
      </div>
      <button
        type="button"
        onClick={onClose}
        style={{
          height: 44,
          padding: '0 20px',
          border: 'none',
          borderRadius: 12,
          background: 'var(--accent)',
          color: '#fff',
          fontSize: 14,
          fontWeight: 700,
          cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        지도로 돌아가기
      </button>
    </div>
  );
}

// 거리순 판매점 리스트 화면. 즐겨찾기 화면도 같은 컴포넌트로.
function NearbyView({
  stores,
  userPosition,
  onClose,
  onSelect,
  title = '내 주변 판매점',
  emptyMessage = '표시할 판매점이 없어요.',
  showLimit = true,
  getAddedAt,
  mode = 'nearby',
  mapBounds = null,
  initialViewportOnly = false,
  initialRadiusKm = null,
  onRemoveBatch,
  onShowToast,
}: {
  stores: Store[];
  userPosition: LatLng | null;
  onClose: () => void;
  onSelect: (store: Store) => void;
  title?: string;
  emptyMessage?: string;
  showLimit?: boolean;
  // 즐겨찾기 화면 등에서 id별 추가 시각을 표시하고 싶을 때
  getAddedAt?: (storeId: number) => number | undefined;
  mode?: ListMode;
  // '현재 지도 영역만 보기' 토글에 사용
  mapBounds?: MapBounds | null;
  // 진입 시 viewport 필터를 켠 상태로 시작 (예: "이 지역 보기" 버튼)
  initialViewportOnly?: boolean;
  // 진입 시 반경 필터를 켠 상태로 시작 (예: 경기장 주변 2km)
  initialRadiusKm?: number | null;
  // 즐겨찾기 편집 모드의 일괄 삭제 콜백
  onRemoveBatch?: (ids: number[]) => void;
  onShowToast?: (msg: string) => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>(
    mode === 'favorites' ? (userPosition ? 'distance' : 'added') : 'distance'
  );
  const [radiusKm, setRadiusKm] = useState<number | null>(initialRadiusKm);
  const [viewportOnly, setViewportOnly] = useState(initialViewportOnly);
  const [editMode, setEditMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // 편집 모드 끄면 선택 초기화
  useEffect(() => {
    if (!editMode) setSelectedIds(new Set());
  }, [editMode]);

  // 검색어 필터 (이름/주소)
  const afterSearch = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return stores;
    return stores.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.address.toLowerCase().includes(q)
    );
  }, [stores, searchQuery]);

  // 지도 영역 필터
  const afterViewport = useMemo(() => {
    if (!viewportOnly || !mapBounds) return afterSearch;
    const { south, west, north, east } = mapBounds;
    return afterSearch.filter(
      (s) =>
        s.lat >= south && s.lat <= north && s.lng >= west && s.lng <= east
    );
  }, [afterSearch, viewportOnly, mapBounds]);

  // 거리 계산
  const withDistance = useMemo(() => {
    if (!userPosition) {
      return afterViewport.map((s) => ({ store: s, distance: Infinity }));
    }
    const [lat, lng] = userPosition;
    return afterViewport.map((s) => ({
      store: s,
      distance: haversineMeters(lat, lng, s.lat, s.lng),
    }));
  }, [afterViewport, userPosition]);

  // 반경 필터
  const withinRadius = useMemo(() => {
    if (radiusKm == null) return withDistance;
    const maxM = radiusKm * 1000;
    return withDistance.filter((x) => x.distance <= maxM);
  }, [withDistance, radiusKm]);

  // 정렬
  const sorted = useMemo(() => {
    const list = withinRadius.slice();
    if (sortBy === 'distance') {
      list.sort((a, b) => a.distance - b.distance);
    } else if (sortBy === 'added') {
      list.sort((a, b) => {
        const ta = getAddedAt?.(a.store.id) ?? 0;
        const tb = getAddedAt?.(b.store.id) ?? 0;
        return tb - ta;
      });
    } else if (sortBy === 'name') {
      list.sort((a, b) =>
        a.store.name.localeCompare(b.store.name, 'ko')
      );
    }
    return list.slice(0, NEARBY_LIMIT);
  }, [withinRadius, sortBy, getAddedAt]);

  const sortOptions: { key: SortKey; label: string; available: boolean }[] = [
    { key: 'distance', label: '거리순', available: userPosition !== null },
    {
      key: 'added',
      label: '추가순',
      available: mode === 'favorites' && getAddedAt !== undefined,
    },
    { key: 'name', label: '이름순', available: true },
  ];

  const handleBatchRemove = () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    onRemoveBatch?.(ids);
    onShowToast?.(`${ids.length}개를 즐겨찾기에서 뺐어요`);
    setSelectedIds(new Set());
    setEditMode(false);
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isEmpty = sorted.length === 0;
  const isFavoritesEmptyFirstTime =
    mode === 'favorites' && stores.length === 0;
  const hasActiveFilter =
    searchQuery.trim().length > 0 || radiusKm !== null || viewportOnly;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--bg-body)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 100,
      }}
    >
      {/* 헤더 */}
      <div
        style={{
          height: 52,
          padding: '0 12px 0 4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          style={{
            width: 44,
            height: 44,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path
              d="M15 5l-7 7 7 7"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-1)' }}>
          {title}
        </div>
        {mode === 'favorites' && stores.length > 0 ? (
          <button
            type="button"
            onClick={() => setEditMode((v) => !v)}
            style={{
              minWidth: 44,
              height: 44,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 700,
              color: editMode ? 'var(--accent)' : 'var(--text-2)',
              padding: '0 8px',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {editMode ? '완료' : '편집'}
          </button>
        ) : (
          <div style={{ width: 44 }} />
        )}
      </div>

      {/* 툴바: 검색 + 필터 (즐겨찾기 빈 상태일 땐 숨김) */}
      {!isFavoritesEmptyFirstTime && (
        <div
          style={{
            background: 'var(--surface)',
            padding: '10px 16px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            flexShrink: 0,
          }}
        >
          {/* 검색 */}
          <div style={{ position: 'relative' }}>
            <span
              aria-hidden
              style={{
                position: 'absolute',
                left: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                fontSize: 14,
                color: 'var(--text-3)',
                pointerEvents: 'none',
              }}
            >
              🔍
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="판매점명·주소 검색"
              aria-label="판매점 검색"
              style={{
                width: '100%',
                height: 40,
                padding: '0 36px',
                border: 'none',
                borderRadius: 10,
                background: 'var(--surface-2)',
                fontSize: 14,
                color: 'var(--text-1)',
                outline: 'none',
                fontFamily: 'inherit',
              }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="검색어 지우기"
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 24,
                  height: 24,
                  border: 'none',
                  background: 'var(--text-disabled)',
                  borderRadius: 12,
                  color: '#fff',
                  fontSize: 11,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                ✕
              </button>
            )}
          </div>

          {/* 칩 영역 (가로 스크롤) */}
          <div
            style={{
              display: 'flex',
              gap: 6,
              overflowX: 'auto',
              margin: '0 -16px',
              padding: '0 16px',
              WebkitOverflowScrolling: 'touch',
              scrollbarWidth: 'none',
            }}
          >
            {sortOptions
              .filter((o) => o.available)
              .map((opt) => (
                <Chip
                  key={opt.key}
                  active={sortBy === opt.key}
                  onClick={() => setSortBy(opt.key)}
                >
                  {opt.label}
                </Chip>
              ))}
            {userPosition && (
              <>
                <span
                  aria-hidden
                  style={{
                    width: 1,
                    flexShrink: 0,
                    background: 'var(--border-2)',
                    margin: '4px 4px',
                  }}
                />
                <Chip
                  active={radiusKm === null}
                  onClick={() => setRadiusKm(null)}
                >
                  전체
                </Chip>
                {RADIUS_OPTIONS_KM.map((km) => (
                  <Chip
                    key={km}
                    active={radiusKm === km}
                    onClick={() => setRadiusKm(km)}
                  >
                    {km}km
                  </Chip>
                ))}
              </>
            )}
            {mode === 'nearby' && mapBounds && (
              <>
                <span
                  aria-hidden
                  style={{
                    width: 1,
                    flexShrink: 0,
                    background: 'var(--border-2)',
                    margin: '4px 4px',
                  }}
                />
                <Chip
                  active={viewportOnly}
                  onClick={() => setViewportOnly((v) => !v)}
                >
                  📍 지도 영역만
                </Chip>
              </>
            )}
          </div>
        </div>
      )}

      {/* 리스트 영역 */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          paddingBottom: editMode ? 80 : 0,
        }}
      >
        {isEmpty && isFavoritesEmptyFirstTime && (
          <FavoritesEmptyState onClose={onClose} />
        )}
        {isEmpty && !isFavoritesEmptyFirstTime && (
          <div
            style={{
              padding: '60px 24px',
              textAlign: 'center',
              color: 'var(--text-3)',
              fontSize: 14,
              lineHeight: 1.6,
              whiteSpace: 'pre-line',
            }}
          >
            {hasActiveFilter
              ? '조건에 맞는 판매점이 없어요.\n필터를 바꿔보세요.'
              : emptyMessage}
          </div>
        )}
        {!isEmpty && (
          <>
            {showLimit && (
              <div
                style={{
                  padding: '12px 20px 8px',
                  fontSize: 12,
                  color: 'var(--text-3)',
                }}
              >
                {sortBy === 'distance' && userPosition
                  ? `가까운 순으로 최대 ${NEARBY_LIMIT}개 표시`
                  : `총 ${sorted.length}개`}
              </div>
            )}
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {sorted.map(({ store, distance }, idx) => {
                const selected = selectedIds.has(store.id);
                return (
                  <li
                    key={store.id}
                    style={{
                      borderBottom:
                        idx === sorted.length - 1
                          ? 'none'
                          : '1px solid var(--border)',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        editMode ? toggleSelect(store.id) : onSelect(store)
                      }
                      style={{
                        width: '100%',
                        padding: '14px 20px',
                        border: 'none',
                        background: selected
                          ? 'var(--accent-bg)'
                          : 'var(--surface)',
                        textAlign: 'left',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 12,
                        WebkitTapHighlightColor: 'transparent',
                      }}
                    >
                      {editMode ? (
                        <span
                          aria-label={selected ? '선택됨' : '선택 안 됨'}
                          style={{
                            flexShrink: 0,
                            width: 22,
                            height: 22,
                            borderRadius: 11,
                            border: `2px solid ${selected ? 'var(--accent)' : 'var(--text-disabled)'}`,
                            background: selected ? 'var(--accent)' : 'var(--surface)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            marginTop: 3,
                          }}
                        >
                          {selected && (
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 12 12"
                              fill="none"
                            >
                              <path
                                d="M2 6L5 9L10 3"
                                stroke="#fff"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          )}
                        </span>
                      ) : (
                        <span
                          style={{
                            flexShrink: 0,
                            minWidth: 56,
                            height: 28,
                            padding: '0 10px',
                            borderRadius: 14,
                            background:
                              isFinite(distance) &&
                              idx < 3 &&
                              sortBy === 'distance'
                                ? 'var(--accent)'
                                : 'var(--surface-2)',
                            color:
                              isFinite(distance) &&
                              idx < 3 &&
                              sortBy === 'distance'
                                ? '#fff'
                                : 'var(--text-2)',
                            fontSize: 12,
                            fontWeight: 700,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {isFinite(distance) ? formatDistance(distance) : '—'}
                        </span>
                      )}
                      <span
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          minWidth: 0,
                          flex: 1,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 16,
                            fontWeight: 700,
                            color: 'var(--text-1)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {store.name}
                        </span>
                        <span
                          style={{
                            fontSize: 12,
                            color: 'var(--text-3)',
                            marginTop: 4,
                            lineHeight: 1.4,
                          }}
                        >
                          {store.address}
                        </span>
                        {(() => {
                          const ts = getAddedAt?.(store.id);
                          if (!ts) return null;
                          const label = formatAddedDate(ts);
                          if (!label) return null;
                          return (
                            <span
                              style={{
                                fontSize: 11,
                                color: 'var(--text-3)',
                                marginTop: 4,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                              }}
                            >
                              <span aria-hidden>⭐</span>
                              {label} 추가
                            </span>
                          );
                        })()}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div style={{ height: 20 }} />
          </>
        )}
      </div>

      {/* 편집 모드 하단 액션 바 */}
      {editMode && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            padding: '12px 16px 20px',
            background: 'var(--surface)',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span style={{ fontSize: 14, color: 'var(--text-2)', fontWeight: 600 }}>
            {selectedIds.size}개 선택됨
          </span>
          <button
            type="button"
            onClick={handleBatchRemove}
            disabled={selectedIds.size === 0}
            style={{
              marginLeft: 'auto',
              height: 44,
              padding: '0 18px',
              border: 'none',
              borderRadius: 10,
              background:
                selectedIds.size > 0 ? 'var(--danger)' : 'var(--surface-2)',
              color:
                selectedIds.size > 0 ? '#fff' : 'var(--text-disabled)',
              fontSize: 14,
              fontWeight: 700,
              cursor: selectedIds.size > 0 ? 'pointer' : 'not-allowed',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            선택 삭제
          </button>
        </div>
      )}
    </div>
  );
}

const STADIUM_RADIUS_KM = 2;

function StadiumView({
  userPosition,
  stores,
  onClose,
  onSelectStadium,
}: {
  userPosition: LatLng | null;
  stores: Store[];
  onClose: () => void;
  onSelectStadium: (stadium: Stadium) => void;
}) {
  const [league, setLeague] = useState<League>('KBO');

  const stadiums = useMemo(() => {
    const filtered = STADIUMS.filter((s) => s.league === league);
    const ref = userPosition;
    const withDistance = filtered.map((s) => ({
      stadium: s,
      distanceFromUser: ref
        ? haversineMeters(ref[0], ref[1], s.lat, s.lng)
        : Infinity,
      nearbyCount: stores.reduce((acc, store) => {
        const d = haversineMeters(s.lat, s.lng, store.lat, store.lng);
        return d <= STADIUM_RADIUS_KM * 1000 ? acc + 1 : acc;
      }, 0),
    }));
    withDistance.sort((a, b) => a.distanceFromUser - b.distanceFromUser);
    return withDistance;
  }, [league, userPosition, stores]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--bg-body)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 100,
      }}
    >
      {/* 헤더 */}
      <div
        style={{
          height: 52,
          padding: '0 12px 0 4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          style={{
            width: 44,
            height: 44,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path
              d="M15 5l-7 7 7 7"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-1)' }}>
          🏟️ 경기장 주변 판매점
        </div>
        <div style={{ width: 44 }} />
      </div>

      {/* 종목 chip */}
      <div
        style={{
          background: 'var(--surface)',
          padding: '12px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          gap: 6,
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
          flexShrink: 0,
        }}
      >
        {LEAGUE_CHIP_ORDER.map((l) => (
          <Chip key={l} active={league === l} onClick={() => setLeague(l)}>
            {LEAGUE_CHIP_LABEL[l]}
          </Chip>
        ))}
      </div>

      {/* 안내 */}
      <div
        style={{
          padding: '12px 20px 8px',
          fontSize: 12,
          color: 'var(--text-3)',
        }}
      >
        경기장 반경 {STADIUM_RADIUS_KM}km 이내 판매점을 볼 수 있어요.{' '}
        {userPosition
          ? '내 위치에서 가까운 경기장부터 정렬했어요.'
          : '위치 권한이 없어 기본 순서로 표시해요.'}
      </div>

      {/* 경기장 리스트 */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {stadiums.map(({ stadium, distanceFromUser, nearbyCount }, idx) => (
            <li
              key={stadium.id}
              style={{
                borderBottom:
                  idx === stadiums.length - 1 ? 'none' : '1px solid var(--border)',
              }}
            >
              <button
                type="button"
                onClick={() => onSelectStadium(stadium)}
                style={{
                  width: '100%',
                  padding: '14px 20px',
                  border: 'none',
                  background: 'var(--surface)',
                  textAlign: 'left',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                <span style={{ fontSize: 22 }} aria-hidden>
                  🏟️
                </span>
                <span
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    minWidth: 0,
                    flex: 1,
                  }}
                >
                  <span
                    style={{
                      fontSize: 16,
                      fontWeight: 700,
                      color: 'var(--text-1)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {stadium.name}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      color: 'var(--text-3)',
                      marginTop: 4,
                      lineHeight: 1.4,
                    }}
                  >
                    {stadium.team}
                  </span>
                </span>
                <span
                  style={{
                    flexShrink: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-end',
                    gap: 4,
                  }}
                >
                  {isFinite(distanceFromUser) && (
                    <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
                      {formatDistance(distanceFromUser)}
                    </span>
                  )}
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color:
                        nearbyCount > 0 ? 'var(--accent)' : 'var(--text-3)',
                    }}
                  >
                    판매점 {nearbyCount.toLocaleString()}개
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div style={{ height: 20 }} />
      </div>
    </div>
  );
}

const SEARCH_LIMIT = 100;

function SearchView({
  stores,
  onClose,
  onSelect,
}: {
  stores: Store[];
  onClose: () => void;
  onSelect: (store: Store) => void;
}) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return stores
      .filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.address.toLowerCase().includes(q)
      )
      .slice(0, SEARCH_LIMIT);
  }, [stores, query]);

  const trimmed = query.trim();

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--surface)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 100,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          style={{
            width: 40,
            height: 40,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            flexShrink: 0,
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path
              d="M15 5l-7 7 7 7"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <div style={{ flex: 1, position: 'relative' }}>
          <span
            aria-hidden
            style={{
              position: 'absolute',
              left: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              fontSize: 14,
              color: 'var(--text-3)',
              pointerEvents: 'none',
            }}
          >
            🔍
          </span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="판매점명·주소 검색"
            aria-label="판매점 검색"
            style={{
              width: '100%',
              height: 40,
              padding: '0 36px',
              border: 'none',
              borderRadius: 10,
              background: 'var(--surface-2)',
              fontSize: 14,
              color: 'var(--text-1)',
              outline: 'none',
              fontFamily: 'inherit',
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
              aria-label="검색어 지우기"
              style={{
                position: 'absolute',
                right: 8,
                top: '50%',
                transform: 'translateY(-50%)',
                width: 24,
                height: 24,
                border: 'none',
                background: 'var(--text-disabled)',
                borderRadius: 12,
                color: '#fff',
                fontSize: 11,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {trimmed === '' && (
          <div
            style={{
              padding: '60px 24px',
              textAlign: 'center',
              color: 'var(--text-3)',
              fontSize: 14,
              lineHeight: 1.6,
            }}
          >
            판매점 이름이나 주소를 입력해보세요.
            <br />
            <span style={{ fontSize: 12 }}>예: 강남구, 행복마트</span>
          </div>
        )}
        {trimmed !== '' && results.length === 0 && (
          <div
            style={{
              padding: '60px 24px',
              textAlign: 'center',
              color: 'var(--text-3)',
              fontSize: 14,
            }}
          >
            검색 결과가 없어요.
          </div>
        )}
        {results.length > 0 && (
          <>
            <div
              style={{
                padding: '12px 20px 8px',
                fontSize: 12,
                color: 'var(--text-3)',
              }}
            >
              {results.length === SEARCH_LIMIT
                ? `최대 ${SEARCH_LIMIT}개 표시 (더 좁혀 검색해보세요)`
                : `${results.length}개 결과`}
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {results.map((store, idx) => (
                <li
                  key={store.id}
                  style={{
                    borderBottom:
                      idx === results.length - 1
                        ? 'none'
                        : '1px solid var(--border)',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(store)}
                    style={{
                      width: '100%',
                      padding: '14px 20px',
                      border: 'none',
                      background: 'var(--surface)',
                      textAlign: 'left',
                      cursor: 'pointer',
                      WebkitTapHighlightColor: 'transparent',
                    }}
                  >
                    <div
                      style={{
                        fontSize: 16,
                        fontWeight: 700,
                        color: 'var(--text-1)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {store.name}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--text-3)',
                        marginTop: 4,
                        lineHeight: 1.4,
                      }}
                    >
                      {store.address}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            <div style={{ height: 20 }} />
          </>
        )}
      </div>
    </div>
  );
}

const CATEGORY_ORDER: FeedbackCategory[] = [
  'closed',
  'wrong_location',
  'wrong_name',
  'new',
  'etc',
];
const PHOTO_MAX_BYTES = 5 * 1024 * 1024; // 5MB

// 제보 화면. 카테고리 / 제목(선택) / 본문(필수) / 사진(선택) / [취소][완료] 버튼.
function FeedbackView({
  onClose,
  onShowToast,
  storeContext = null,
  userLocation = null,
}: {
  onClose: () => void;
  onShowToast: (msg: string) => void;
  storeContext?: StoreContext | null;
  userLocation?: LatLng | null;
}) {
  // 판매점 컨텍스트가 있으면 위치 오류를 디폴트, 없으면 미선택
  const [category, setCategory] = useState<FeedbackCategory | null>(
    storeContext ? 'wrong_location' : null
  );
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string>('');
  const [includeLocation, setIncludeLocation] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // 사진 선택 시 미리보기 URL 생성/해제
  useEffect(() => {
    if (!photo) {
      setPhotoPreview('');
      return;
    }
    const url = URL.createObjectURL(photo);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const trimmedBody = body.trim();
  const canSubmit =
    category !== null && trimmedBody.length > 0 && !submitting;

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > PHOTO_MAX_BYTES) {
      onShowToast('사진은 5MB 이하만 첨부할 수 있어요');
      e.target.value = '';
      return;
    }
    setPhoto(file);
  };

  const handleSubmit = async () => {
    if (!category) {
      onShowToast('분류를 선택해주세요');
      return;
    }
    if (!trimmedBody) {
      onShowToast('내용을 입력해주세요');
      return;
    }
    setSubmitting(true);
    try {
      await sendFeedback({
        category,
        title,
        body: trimmedBody,
        storeContext: storeContext ?? undefined,
        userLocation:
          category === 'new' && includeLocation && userLocation
            ? { lat: userLocation[0], lng: userLocation[1] }
            : undefined,
        photo: photo ?? undefined,
      });
      onShowToast('제보가 접수됐어요. 감사합니다!');
      onClose();
    } catch (err) {
      console.error(err);
      onShowToast('전송에 실패했어요. 잠시 후 다시 시도해주세요');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--surface)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 100,
      }}
    >
      {/* 헤더 */}
      <div
        style={{
          height: 52,
          padding: '0 12px 0 4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          style={{
            width: 44,
            height: 44,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path
              d="M15 5l-7 7 7 7"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-1)' }}>
          제보하기
        </div>
        <div style={{ width: 44 }} />
      </div>

      {/* 판매점 컨텍스트 배너 */}
      {storeContext && (
        <div
          style={{
            background: 'var(--accent-bg)',
            borderBottom: '1px solid var(--border)',
            padding: '10px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexShrink: 0,
          }}
        >
          <span aria-hidden style={{ fontSize: 16 }}>
            📍
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: 'var(--text-1)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {storeContext.name}
            </div>
            <div
              style={{
                fontSize: 11,
                color: 'var(--text-2)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {storeContext.address}
            </div>
          </div>
        </div>
      )}

      {/* 본문 입력 영역 */}
      <div
        style={{
          flex: 1,
          padding: '20px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {/* 분류 */}
        <div>
          <label
            style={{
              display: 'block',
              fontSize: 13,
              color: 'var(--text-2)',
              fontWeight: 600,
              marginBottom: 8,
            }}
          >
            분류 <span style={{ color: 'var(--danger)', fontWeight: 500 }}>*</span>
          </label>
          <div
            style={{
              display: 'flex',
              gap: 6,
              flexWrap: 'wrap',
            }}
          >
            {CATEGORY_ORDER.map((c) => (
              <Chip
                key={c}
                active={category === c}
                onClick={() => setCategory(c)}
              >
                {CATEGORY_LABEL[c]}
              </Chip>
            ))}
          </div>
        </div>

        {/* '신규 추가' 카테고리: 위치 첨부 토글 */}
        {category === 'new' && (
          <div
            style={{
              background: 'var(--bg-body)',
              borderRadius: 10,
              padding: '12px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}
              >
                📍 현재 위치 좌표 포함
              </div>
              <div
                style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}
              >
                {userLocation
                  ? `${userLocation[0].toFixed(5)}, ${userLocation[1].toFixed(5)}`
                  : '위치 정보가 없어요'}
              </div>
            </div>
            <label
              style={{
                position: 'relative',
                display: 'inline-block',
                width: 44,
                height: 26,
                flexShrink: 0,
                opacity: userLocation ? 1 : 0.4,
                pointerEvents: userLocation ? 'auto' : 'none',
              }}
            >
              <input
                type="checkbox"
                checked={includeLocation}
                onChange={(e) => setIncludeLocation(e.target.checked)}
                style={{
                  position: 'absolute',
                  opacity: 0,
                  width: 0,
                  height: 0,
                }}
              />
              <span
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: includeLocation ? 'var(--accent)' : 'var(--text-disabled)',
                  borderRadius: 13,
                  transition: 'background 0.15s',
                }}
              />
              <span
                style={{
                  position: 'absolute',
                  top: 2,
                  left: includeLocation ? 20 : 2,
                  width: 22,
                  height: 22,
                  background: 'var(--surface)',
                  borderRadius: '50%',
                  transition: 'left 0.15s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }}
              />
            </label>
          </div>
        )}

        <div>
          <label
            htmlFor="feedback-title"
            style={{
              display: 'block',
              fontSize: 13,
              color: 'var(--text-2)',
              fontWeight: 600,
              marginBottom: 6,
            }}
          >
            제목{' '}
            <span style={{ color: 'var(--text-3)', fontWeight: 500 }}>(선택)</span>
          </label>
          <input
            id="feedback-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예: 폐업한 판매점이 보여요"
            maxLength={100}
            style={{
              width: '100%',
              padding: '12px 14px',
              border: '1px solid var(--border-2)',
              borderRadius: 10,
              fontSize: 15,
              outline: 'none',
              fontFamily: 'inherit',
              background: 'var(--surface)',
              color: 'var(--text-1)',
            }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <label
            htmlFor="feedback-body"
            style={{
              display: 'block',
              fontSize: 13,
              color: 'var(--text-2)',
              fontWeight: 600,
              marginBottom: 6,
            }}
          >
            내용 <span style={{ color: 'var(--danger)', fontWeight: 500 }}>*</span>
          </label>
          <textarea
            id="feedback-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="잘못된 정보, 폐업한 판매점, 개선 의견 등 자유롭게 적어주세요."
            maxLength={2000}
            style={{
              minHeight: 160,
              padding: '12px 14px',
              border: '1px solid var(--border-2)',
              borderRadius: 10,
              fontSize: 15,
              lineHeight: 1.5,
              outline: 'none',
              fontFamily: 'inherit',
              background: 'var(--surface)',
              color: 'var(--text-1)',
              resize: 'vertical',
            }}
          />
          <div
            style={{
              alignSelf: 'flex-end',
              marginTop: 6,
              fontSize: 12,
              color: 'var(--text-3)',
            }}
          >
            {body.length} / 2000
          </div>
        </div>

        {/* 사진 첨부 */}
        <div>
          <label
            style={{
              display: 'block',
              fontSize: 13,
              color: 'var(--text-2)',
              fontWeight: 600,
              marginBottom: 6,
            }}
          >
            사진{' '}
            <span style={{ color: 'var(--text-3)', fontWeight: 500 }}>
              (선택, 1장, 5MB 이하)
            </span>
          </label>
          {!photo && (
            <label
              htmlFor="feedback-photo"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                height: 56,
                border: '1px dashed #c6cdd6',
                borderRadius: 10,
                background: 'var(--surface-2)',
                color: 'var(--text-2)',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              📷 사진 첨부
            </label>
          )}
          {photo && (
            <div
              style={{
                position: 'relative',
                display: 'inline-block',
                borderRadius: 10,
                overflow: 'hidden',
                border: '1px solid var(--border-2)',
              }}
            >
              <img
                src={photoPreview}
                alt="첨부된 사진 미리보기"
                style={{
                  display: 'block',
                  maxWidth: 160,
                  maxHeight: 160,
                  objectFit: 'cover',
                }}
              />
              <button
                type="button"
                onClick={() => setPhoto(null)}
                aria-label="사진 제거"
                style={{
                  position: 'absolute',
                  top: 4,
                  right: 4,
                  width: 24,
                  height: 24,
                  border: 'none',
                  borderRadius: 12,
                  background: 'rgba(0,0,0,0.6)',
                  color: '#fff',
                  fontSize: 12,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                ✕
              </button>
            </div>
          )}
          <input
            id="feedback-photo"
            type="file"
            accept="image/*"
            onChange={handlePhotoChange}
            style={{ display: 'none' }}
          />
        </div>
      </div>

      {/* 하단 버튼 */}
      <div
        style={{
          padding: '12px 16px 20px',
          display: 'flex',
          gap: 8,
          borderTop: '1px solid var(--border)',
          background: 'var(--surface)',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          style={{
            flex: 1,
            height: 52,
            border: 'none',
            borderRadius: 12,
            background: 'var(--surface-2)',
            color: 'var(--text-2)',
            fontSize: 16,
            fontWeight: 700,
            cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          취소
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{
            flex: 2,
            height: 52,
            border: 'none',
            borderRadius: 12,
            background: canSubmit ? 'var(--accent)' : 'var(--text-disabled)',
            color: '#fff',
            fontSize: 16,
            fontWeight: 700,
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            transition: 'background 0.15s',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          {submitting ? '전송 중...' : '완료'}
        </button>
      </div>
    </div>
  );
}

// 길찾기 버튼 정의. icon은 public/icons/ 에 저장된 PNG 경로.
// PNG 파일이 없으면 onerror로 회색 박스 fallback.
const MAP_APPS = [
  { key: 'tmap', label: '티맵', iconSrc: '/icons/tmap.png' },
  { key: 'naver', label: '네이버 지도', iconSrc: '/icons/naver-map.png' },
  { key: 'kakao', label: '카카오맵', iconSrc: '/icons/kakao-map.png' },
] as const;
type MapAppKey = (typeof MAP_APPS)[number]['key'];

const APP_ICON_SIZE = 36;

// 가맹점 InfoWindow 콘텐츠를 HTMLElement로 생성.
function createStoreInfoElement(
  store: Store,
  callbacks: {
    onCopied: () => void;
    onNavigate: (app: MapAppKey) => void;
    onToggleFavorite: () => void;
    onShare: () => void;
    onReport: () => void;
    isFavoriteNow: boolean;
    distanceMeters?: number; // 사용자 위치로부터의 거리(m). 있으면 상호명 옆에 표시.
  }
): HTMLDivElement {
  const root = document.createElement('div');
  root.style.cssText = `
    min-width: 240px;
    max-width: 280px;
    padding: 14px 16px 12px;
    background: var(--surface);
    border-radius: 12px;
    box-shadow: 0 6px 20px rgba(0,0,0,0.15);
    font-family: -apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;
  `;

  const navButtonsHtml = MAP_APPS.map(
    (app) => `
      <button type="button"
              class="store-nav-btn"
              data-app="${app.key}"
              aria-label="${app.label}에서 길찾기"
              style="
                position:relative;
                flex:1;
                display:flex;
                flex-direction:column;
                align-items:center;
                gap:6px;
                padding:8px 4px;
                background:var(--surface);
                border:none;
                border-radius:10px;
                cursor:pointer;
                -webkit-tap-highlight-color:transparent;
              ">
        <img src="${app.iconSrc}"
             width="${APP_ICON_SIZE}"
             height="${APP_ICON_SIZE}"
             alt=""
             style="
               border-radius:8px;
               display:block;
               background:var(--surface-2);
               object-fit:cover;
             "
             onerror="this.style.opacity='0'" />
        <span style="font-size:11px;color:var(--text-2);font-weight:600;white-space:nowrap;">
          ${app.label}
        </span>
      </button>
    `
  ).join('');

  const starColor = callbacks.isFavoriteNow ? '#ffc107' : 'var(--text-disabled)';
  const starFill = callbacks.isFavoriteNow ? '#ffc107' : 'none';
  const distanceLabel =
    typeof callbacks.distanceMeters === 'number' &&
    isFinite(callbacks.distanceMeters)
      ? `<span style="font-size:12px;font-weight:500;color:var(--text-3);margin-left:4px;">(${formatDistance(callbacks.distanceMeters)})</span>`
      : '';
  root.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:4px;margin-bottom:8px;">
      <div style="font-size:15px;font-weight:700;color:var(--text-1);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
        ${escapeHtml(store.name)}${distanceLabel}
      </div>
      <button type="button"
              class="store-share-btn"
              aria-label="이 판매점 공유"
              style="
                flex-shrink:0;
                width:30px;height:30px;
                border:none;
                border-radius:8px;
                background:transparent;
                cursor:pointer;
                display:flex;
                align-items:center;
                justify-content:center;
                padding:0;
                -webkit-tap-highlight-color:transparent;
              ">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style="color:var(--text-2)" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 12v7a2 2 0 002 2h12a2 2 0 002-2v-7"
                stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M16 6l-4-4-4 4M12 2v13"
                stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <button type="button"
              class="store-fav-btn"
              aria-label="${callbacks.isFavoriteNow ? '즐겨찾기 해제' : '즐겨찾기 추가'}"
              style="
                flex-shrink:0;
                width:30px;height:30px;
                border:none;
                border-radius:8px;
                background:transparent;
                cursor:pointer;
                display:flex;
                align-items:center;
                justify-content:center;
                padding:0;
                -webkit-tap-highlight-color:transparent;
              ">
        <svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
          <path d="M10 1.5l2.6 5.27 5.82.85-4.21 4.1.99 5.78L10 14.77l-5.2 2.73.99-5.78L1.58 7.62l5.82-.85L10 1.5z"
                fill="${starFill}" stroke="${starColor}" stroke-width="1.4"
                stroke-linejoin="round"/>
        </svg>
      </button>
    </div>
    <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:12px;">
      <div class="store-address"
           role="button"
           aria-label="주소 복사"
           style="
             flex:1;
             font-size:12px;
             color:var(--text-2);
             line-height:1.5;
             cursor:pointer;
             user-select:none;
             -webkit-user-select:none;
           ">${escapeHtml(store.address)}</div>
      <button type="button"
              class="store-copy-btn"
              aria-label="주소 복사"
              style="
                flex-shrink:0;
                width:30px;height:30px;
                border:none;
                border-radius:8px;
                background:var(--surface-2);
                cursor:pointer;
                display:flex;
                align-items:center;
                justify-content:center;
                padding:0;
                -webkit-tap-highlight-color:transparent;
              ">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="color:var(--text-2)" xmlns="http://www.w3.org/2000/svg">
          <rect x="4.5" y="4.5" width="9" height="10" rx="1.5"
                stroke="currentColor" stroke-width="1.4" fill="none"/>
          <path d="M3.5 11V2.5C3.5 1.95 3.95 1.5 4.5 1.5H10.5"
                stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
    <div style="
      display:flex;
      gap:6px;
      padding-top:10px;
      border-top:1px solid var(--border);
    ">
      ${navButtonsHtml}
    </div>
    <button type="button"
            class="store-report-btn"
            style="
              width:100%;
              margin-top:8px;
              padding:8px 0;
              border:none;
              border-radius:8px;
              background:transparent;
              color:var(--text-3);
              font-size:12px;
              font-weight:600;
              cursor:pointer;
              -webkit-tap-highlight-color:transparent;
            ">
      📢 이 판매점 제보하기
    </button>
  `;

  const handleCopy = async (e: Event) => {
    e.stopPropagation();
    try {
      await copyToClipboard(store.address);
      callbacks.onCopied();
    } catch (err) {
      console.error(err);
    }
  };
  root.querySelector('.store-address')?.addEventListener('click', handleCopy);
  root.querySelector('.store-copy-btn')?.addEventListener('click', handleCopy);
  let currentFav = callbacks.isFavoriteNow;
  const favBtn = root.querySelector<HTMLButtonElement>('.store-fav-btn');
  favBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    callbacks.onToggleFavorite();
    currentFav = !currentFav;
    const path = favBtn.querySelector('path');
    if (path) {
      path.setAttribute('fill', currentFav ? '#ffc107' : 'none');
      path.setAttribute('stroke', currentFav ? '#ffc107' : 'var(--text-disabled)');
    }
    favBtn.setAttribute(
      'aria-label',
      currentFav ? '즐겨찾기 해제' : '즐겨찾기 추가'
    );
  });

  root.querySelectorAll<HTMLButtonElement>('.store-nav-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = btn.dataset.app as MapAppKey | undefined;
      if (key) callbacks.onNavigate(key);
    });
  });

  root.querySelector('.store-share-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    callbacks.onShare();
  });

  root.querySelector('.store-report-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    callbacks.onReport();
  });

  return root;
}

export default function App() {
  const { ready: sdkReady, error: sdkError } = useNaverMapSdk();

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const [mapInstance, setMapInstance] = useState<NaverMap | null>(null);
  const [infoWindow, setInfoWindow] = useState<NaverInfoWindow | null>(null);
  const userMarkerRef = useRef<NaverMarker | null>(null);

  const [userPosition, setUserPosition] = useState<LatLng | null>(null);
  const [locationError, setLocationError] = useState('');
  const [isLocating, setIsLocating] = useState(true);
  const [isFindingMe, setIsFindingMe] = useState(false);
  const [permissionDialogOpen, setPermissionDialogOpen] = useState(false);

  const [stores, setStores] = useState<Store[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [storesError, setStoresError] = useState('');
  const [regionFilter, setRegionFilter] = useState<string>('전체');
  const [subRegionFilter, setSubRegionFilter] = useState<string>('전체');

  const [view, setView] = useState<View>('map');
  const [menuOpen, setMenuOpen] = useState(false);
  const [mapBounds, setMapBounds] = useState<MapBounds | null>(null);
  const [feedbackStoreContext, setFeedbackStoreContext] =
    useState<StoreContext | null>(null);
  const [nearbyInitialViewport, setNearbyInitialViewport] = useState(false);
  const [stadiumContext, setStadiumContext] = useState<Stadium | null>(null);
  const isAdmin = useMemo(() => checkIsAdmin(), []);

  // 스플래시: SDK + stores가 준비될 때까지 풀스크린 로딩 표시
  const [splashEnded, setSplashEnded] = useState(false);
  const [splashVisible, setSplashVisible] = useState(true);
  const mountedAtRef = useRef(Date.now());

  const [favorites, setFavorites] = useState<Set<number>>(() => getFavorites());
  // 마커 click 핸들러에서 항상 최신 favorites를 참조할 수 있도록 ref
  const favoritesRef = useRef(favorites);
  useEffect(() => {
    favoritesRef.current = favorites;
  }, [favorites]);

  // 마커 click 등 effect closure에서 항상 최신 userPosition 참조하기 위한 ref
  const userPositionRef = useRef(userPosition);
  useEffect(() => {
    userPositionRef.current = userPosition;
  }, [userPosition]);

  const distanceFromUser = useCallback(
    (lat: number, lng: number): number | undefined => {
      const u = userPositionRef.current;
      if (!u) return undefined;
      return haversineMeters(u[0], u[1], lat, lng);
    },
    []
  );

  const handleToggleFavorite = useCallback(
    (storeId: number, storeName: string) => {
      const next = toggleFavorite(storeId);
      setFavorites(new Set(next));
      showToastRef.current(
        next.has(storeId)
          ? `'${storeName}'을(를) 즐겨찾기에 추가했어요`
          : `'${storeName}'을(를) 즐겨찾기에서 뺐어요`
      );
    },
    []
  );

  const handleShareStore = useCallback(
    async (store: { name: string; address: string }) => {
      try {
        const r = await shareStore(store);
        if (r === 'copied') {
          showToastRef.current('판매점 정보가 복사됐어요');
        }
      } catch (err) {
        const name = (err as { name?: string })?.name;
        if (name !== 'AbortError') {
          console.error(err);
          showToastRef.current('공유에 실패했어요');
        }
      }
    },
    []
  );

  const handleReportStore = useCallback((store: Store) => {
    setFeedbackStoreContext({
      id: store.id,
      name: store.name,
      address: store.address,
      lat: store.lat,
      lng: store.lng,
    });
    setView('feedback');
  }, []);

  // NearbyView/SearchView에서 항목 선택 시 지도로 포커스 + InfoWindow 열기
  const focusOnStore = useCallback(
    (store: Store) => {
      if (!mapInstance || !infoWindow || !window.naver) return;
      const naver = window.naver.maps;
      const latlng = new naver.LatLng(store.lat, store.lng);
      setView('map');
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          mapInstance.setZoom(16);
          mapInstance.setCenter(latlng);
          const content = createStoreInfoElement(store, {
            onCopied: () => showToastRef.current('주소가 복사되었어요'),
            onNavigate: (app) => {
              const dest = {
                lat: store.lat,
                lng: store.lng,
                name: store.name,
                address: store.address,
              };
              if (app === 'tmap') void navigateTmap(dest);
              else if (app === 'naver') void navigateNaver(dest);
              else if (app === 'kakao') void navigateKakao(dest);
            },
            onToggleFavorite: () =>
              handleToggleFavorite(store.id, store.name),
            onShare: () =>
              void handleShareStore({
                name: store.name,
                address: store.address,
              }),
            onReport: () => {
              infoWindow.close();
              handleReportStore(store);
            },
            isFavoriteNow: favoritesRef.current.has(store.id),
            distanceMeters: distanceFromUser(store.lat, store.lng),
          });
          infoWindow.setContent(content);
          infoWindow.setPosition(latlng);
          infoWindow.open(mapInstance);
        });
      });
    },
    [
      mapInstance,
      infoWindow,
      handleToggleFavorite,
      handleShareStore,
      handleReportStore,
      distanceFromUser,
    ]
  );

  // 스플래시 종료 조건: SDK + stores 둘 다 준비 + 최소 노출 시간 800ms
  useEffect(() => {
    if (splashEnded) return;
    if (!sdkReady || stores.length === 0) return;
    const MIN_SPLASH_MS = 800;
    const elapsed = Date.now() - mountedAtRef.current;
    const remaining = Math.max(0, MIN_SPLASH_MS - elapsed);
    const t = setTimeout(() => setSplashEnded(true), remaining);
    return () => clearTimeout(t);
  }, [sdkReady, stores.length, splashEnded]);

  // 안전장치: 5초 후엔 무조건 스플래시 종료 (네트워크 실패 등 대비)
  useEffect(() => {
    const t = setTimeout(() => setSplashEnded(true), 5000);
    return () => clearTimeout(t);
  }, []);

  // splashEnded 후 fade-out 시간(350ms) 지나면 DOM에서 제거
  useEffect(() => {
    if (!splashEnded) return;
    const t = setTimeout(() => setSplashVisible(false), 350);
    return () => clearTimeout(t);
  }, [splashEnded]);

  const [toastMessage, setToastMessage] = useState('');
  const toastTimerRef = useRef<number | null>(null);
  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage('');
      toastTimerRef.current = null;
    }, 2000);
  }, []);

  // 마커 click 핸들러가 항상 최신 showToast를 호출하도록 ref에 보관
  const showToastRef = useRef(showToast);
  useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  // 초기 위치: SDK → 브라우저 순. 권한이 없어도 일단 서울 중심으로 표시 (강제 요청 X)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pos = await fetchCurrentLocation({ askPermission: false });
        if (!cancelled) {
          setUserPosition(pos);
          setIsLocating(false);
        }
      } catch (err) {
        if (cancelled) return;
        setUserPosition([37.5665, 126.978]);
        setIsLocating(false);
        if (err instanceof LocationPermissionDeniedError) {
          // 초기에는 조용히 - 사용자가 [현재 위치] 버튼 누르면 그때 권한 요청
        } else {
          setLocationError('위치 정보를 가져올 수 없어 서울 중심으로 표시해요.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 가맹점 데이터: 원격(raw URL) 우선 → 실패 시 빌드 포함 로컬 파일
  useEffect(() => {
    let cancelled = false;
    type StoresPayload =
      | Store[]
      | { lastUpdated?: string; count?: number; stores: Store[] };

    async function fetchStoresFrom(url: string) {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status} (${url})`);
      return (await res.json()) as StoresPayload;
    }

    (async () => {
      let data: StoresPayload | null = null;
      try {
        data = await fetchStoresFrom(`${REMOTE_STORES_URL}?t=${Date.now()}`);
      } catch (err) {
        console.warn('원격 stores.json 실패, 로컬로 fallback:', err);
        try {
          data = await fetchStoresFrom(LOCAL_STORES_URL);
        } catch (err2) {
          console.error(err2);
          if (!cancelled) setStoresError('판매점 데이터를 불러올 수 없어요.');
          return;
        }
      }
      if (cancelled || !data) return;
      if (Array.isArray(data)) {
        setStores(data);
      } else {
        setStores(data.stores ?? []);
        if (data.lastUpdated) setLastUpdated(data.lastUpdated);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // "YYYY-MM-DD HH:MM" 형식으로 포맷
  const lastUpdatedLabel = useMemo(() => {
    if (!lastUpdated) return '';
    const d = new Date(lastUpdated);
    if (Number.isNaN(d.getTime())) return '';
    // KST 기준으로 표시
    const fmt = new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
  }, [lastUpdated]);

  // 지도 생성 (sdk 로드 + 위치 + container 준비되면 한 번만)
  useEffect(() => {
    if (!sdkReady || !userPosition || !mapContainerRef.current || mapInstance) {
      return;
    }
    const naver = window.naver!.maps;
    // 저장된 마지막 위치가 있으면 그걸로 시작, 없으면 현재 위치 기준
    const savedView = loadSavedView();
    const initialCenter = savedView
      ? new naver.LatLng(savedView.lat, savedView.lng)
      : new naver.LatLng(userPosition[0], userPosition[1]);
    const initialZoom = savedView?.zoom ?? 12;
    const map = new naver.Map(mapContainerRef.current, {
      center: initialCenter,
      zoom: initialZoom,
      minZoom: 6,
      maxZoom: 18,
      scaleControl: false,
      mapDataControl: false,
      logoControl: false,
      zoomControl: false,
    });
    const iw = new naver.InfoWindow({
      borderWidth: 0,
      anchorSize: new naver.Size(0, 0),
      pixelOffset: new naver.Point(0, -10),
      backgroundColor: 'transparent',
      disableAnchor: true,
    });
    userMarkerRef.current = new naver.Marker({
      position: new naver.LatLng(userPosition[0], userPosition[1]),
      map,
      icon: userMarkerIcon(),
      zIndex: 1000,
    });

    // 지도 빈 곳 클릭 → InfoWindow 닫기
    naver.Event.addListener(map, 'click', () => {
      iw.close();
    });

    // bounds 캡처 + 마지막 위치 저장 (지도가 멈출 때마다)
    const handleIdle = () => {
      const b = (map as unknown as {
        getBounds: () => {
          getSW: () => NaverLatLng;
          getNE: () => NaverLatLng;
        };
        getCenter: () => NaverLatLng;
        getZoom: () => number;
      }).getBounds();
      const sw = b.getSW();
      const ne = b.getNE();
      setMapBounds({
        south: sw.lat(),
        west: sw.lng(),
        north: ne.lat(),
        east: ne.lng(),
      });
      const center = (
        map as unknown as {
          getCenter: () => NaverLatLng;
          getZoom: () => number;
        }
      ).getCenter();
      const zoom = (
        map as unknown as { getZoom: () => number }
      ).getZoom();
      saveLastView({ lat: center.lat(), lng: center.lng(), zoom });
    };
    naver.Event.addListener(map, 'idle', handleIdle);
    // 최초 1회는 지도 그려진 직후 한 번 더 호출
    setTimeout(handleIdle, 0);

    setMapInstance(map);
    setInfoWindow(iw);
  }, [sdkReady, userPosition, mapInstance]);

  // 가맹점 마커 + 클러스터링 (region filter 바뀔 때마다 재구성)
  const visibleStores = useMemo(() => {
    let filtered =
      regionFilter === '전체'
        ? stores
        : stores.filter((s) => s.region === regionFilter);
    if (regionFilter !== '전체' && subRegionFilter !== '전체') {
      filtered = filtered.filter(
        (s) => extractSubRegion(s.address) === subRegionFilter
      );
    }
    return filtered;
  }, [stores, regionFilter, subRegionFilter]);

  // 현재 지도 영역에 들어있는 판매점 수 (지도 위 '이 지역' 버튼에 표시)
  const storesInViewport = useMemo(() => {
    if (!mapBounds) return 0;
    const { south, west, north, east } = mapBounds;
    return visibleStores.filter(
      (s) => s.lat >= south && s.lat <= north && s.lng >= west && s.lng <= east
    ).length;
  }, [visibleStores, mapBounds]);

  useEffect(() => {
    if (!sdkReady || !mapInstance || !infoWindow) return;
    if (visibleStores.length === 0) return;
    if (!window.MarkerClustering) return;

    const naver = window.naver!.maps;

    const markers = visibleStores.map((store) => {
      const marker = new naver.Marker({
        position: new naver.LatLng(store.lat, store.lng),
        icon: storeMarkerIcon(),
      });
      naver.Event.addListener(marker, 'click', () => {
        const content = createStoreInfoElement(store, {
          onCopied: () => {
            showToastRef.current('주소가 복사되었어요');
          },
          onNavigate: (app) => {
            const dest = {
              lat: store.lat,
              lng: store.lng,
              name: store.name,
              address: store.address,
            };
            if (app === 'tmap') void navigateTmap(dest);
            else if (app === 'naver') void navigateNaver(dest);
            else if (app === 'kakao') void navigateKakao(dest);
          },
          onToggleFavorite: () => handleToggleFavorite(store.id, store.name),
          onShare: () =>
            void handleShareStore({ name: store.name, address: store.address }),
          onReport: () => {
            infoWindow.close();
            handleReportStore(store);
          },
          isFavoriteNow: favoritesRef.current.has(store.id),
          distanceMeters: distanceFromUser(store.lat, store.lng),
        });
        infoWindow.setContent(content);
        infoWindow.open(mapInstance, marker);
      });
      return marker;
    });

    const clustering = new window.MarkerClustering({
      minClusterSize: 2,
      maxZoom: 15,
      map: mapInstance,
      markers,
      disableClickZoom: false,
      gridSize: 120,
      icons: buildClusterIcons(),
      indexGenerator: [10, 50, 200, 500],
      stylingFunction: styleCluster,
    });

    return () => {
      clustering.setMap(null);
      markers.forEach((m) => m.setMap(null));
    };
  }, [sdkReady, mapInstance, infoWindow, visibleStores]);

  // region 변경 시 지도 중심 이동 + InfoWindow 닫기
  useEffect(() => {
    if (!mapInstance || !window.naver) return;
    infoWindow?.close();
    if (regionFilter === '전체') return;
    const first = visibleStores[0];
    if (!first) return;
    const naver = window.naver.maps;
    mapInstance.panTo(new naver.LatLng(first.lat, first.lng));
  }, [regionFilter, visibleStores, mapInstance, infoWindow]);

  // [현재 위치] FAB 클릭 핸들러
  const handleLocateMe = useCallback(
    async (askPermission = false) => {
      if (!mapInstance || !window.naver) return;
      infoWindow?.close();
      setIsFindingMe(true);
      try {
        const pos = await fetchCurrentLocation({ askPermission });
        const naver = window.naver.maps;
        const latlng = new naver.LatLng(pos[0], pos[1]);
        setUserPosition(pos);
        // 내 위치 마커 이동
        if (userMarkerRef.current) {
          (
            userMarkerRef.current as unknown as {
              setPosition: (p: NaverLatLng) => void;
            }
          ).setPosition(latlng);
        } else {
          userMarkerRef.current = new naver.Marker({
            position: latlng,
            map: mapInstance,
            icon: userMarkerIcon(),
            zIndex: 1000,
          });
        }
        mapInstance.panTo(latlng);
        mapInstance.setZoom(15);
      } catch (err) {
        if (err instanceof LocationPermissionDeniedError) {
          setPermissionDialogOpen(true);
        } else {
          setLocationError('현재 위치를 가져올 수 없어요.');
          setTimeout(() => setLocationError(''), 2500);
        }
      } finally {
        setIsFindingMe(false);
      }
    },
    [mapInstance, infoWindow]
  );

  // 토토/프로토 회차 마감 규칙 (정적 JSON)
  const [scheduleRules, setScheduleRules] = useState<ScheduleRule[]>([]);
  useEffect(() => {
    let cancelled = false;
    loadScheduleRules().then((rules) => {
      if (!cancelled) setScheduleRules(rules);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 1분 단위로 "다음 마감"을 재계산하기 위한 tick
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // 푸터 롤링 메시지: 3초마다 다음으로
  const footerMessages = useMemo(() => {
    const countLabel =
      regionFilter === '전체'
        ? `전국 ${visibleStores.length.toLocaleString()}개 표시 중`
        : subRegionFilter === '전체'
          ? `${regionFilter} ${visibleStores.length.toLocaleString()}개 표시 중`
          : `${regionFilter} ${subRegionFilter} ${visibleStores.length.toLocaleString()}개 표시 중`;

    // 가까운 마감 2개를 롤링에 끼워넣음
    const upcoming = computeUpcoming(scheduleRules, new Date(now)).slice(0, 2);
    const deadlineMsgs = upcoming.map((d) => `⏰ ${formatDeadline(d, new Date(now))}`);

    return [
      countLabel,
      ...deadlineMsgs,
      '매일 오전 새로운 정보로 업데이트됩니다.',
      '국민체육진흥공단에 등록된 정식 업체만 노출됩니다.',
      '즐거운 스포츠, 즐거운 토토, 소액으로 건전하게 즐기세요.',
      '회차당 1인 10만원까지 구매하실 수 있습니다.',
    ];
  }, [regionFilter, subRegionFilter, visibleStores.length, scheduleRules, now]);

  const [footerMsgIndex, setFooterMsgIndex] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => {
      setFooterMsgIndex((i) => (i + 1) % footerMessages.length);
    }, 3000);
    return () => window.clearInterval(id);
  }, [footerMessages.length]);

  const regions = useMemo(() => {
    const set = new Set<string>();
    stores.forEach((s) => set.add(s.region));
    return ['전체', ...Array.from(set).sort()];
  }, [stores]);

  // region별 sub-region (구/시) 후보. 광역시는 구, 도는 시.
  const subRegionsByRegion = useMemo(() => {
    const map = new Map<string, Set<string>>();
    stores.forEach((s) => {
      const sub = extractSubRegion(s.address);
      if (!sub) return;
      if (!map.has(s.region)) map.set(s.region, new Set());
      map.get(s.region)!.add(sub);
    });
    const result = new Map<string, string[]>();
    for (const [region, subs] of map) {
      result.set(region, ['전체', ...Array.from(subs).sort()]);
    }
    return result;
  }, [stores]);

  const subRegionOptions = useMemo(() => {
    if (regionFilter === '전체') return [];
    return subRegionsByRegion.get(regionFilter) ?? ['전체'];
  }, [regionFilter, subRegionsByRegion]);

  // 광역시·도가 아니라 자체 단일행정구역(세종 등)이면 sub-region 드롭다운 숨김
  const showSubRegion =
    regionFilter !== '전체' && subRegionOptions.length > 2;

  const mapHeight = `calc(100vh - ${HEADER_HEIGHT + FOOTER_HEIGHT}px)`;
  const showLoading = isLocating || !sdkReady;
  const errorText = sdkError || storesError || locationError;

  return (
    <>
      <style>{`
        :root {
          --surface: #fff;
          --surface-2: #f2f4f6;
          --bg-body: #f7f8fa;
          --text-1: #191f28;
          --text-2: #4e5968;
          --text-3: #8b95a1;
          --text-disabled: #c6cdd6;
          --border: #f0f0f3;
          --border-2: #e5e8ec;
          --accent: #3182f6;
          --accent-bg: #eaf2ff;
          --warning-bg: #fff3cd;
          --warning-text: #856404;
          --warning-border: #ffeeba;
          --danger: #f04438;
          --shadow-card: 0 4px 16px rgba(0,0,0,0.15);
          --shadow-pill: 0 4px 12px rgba(0,0,0,0.12);
        }
        @media (prefers-color-scheme: dark) {
          :root {
            --surface: #1f1f23;
            --surface-2: #2c2c30;
            --bg-body: #131316;
            --text-1: #f5f6f7;
            --text-2: #c9ced4;
            --text-3: #8b95a1;
            --text-disabled: #5a5f66;
            --border: #2c2c30;
            --border-2: #3a3a3f;
            --accent: #4d9eff;
            --accent-bg: #1f2a3d;
            --warning-bg: #3a2f10;
            --warning-text: #ffd966;
            --warning-border: #5c4514;
            --danger: #ff6b6b;
            --shadow-card: 0 4px 16px rgba(0,0,0,0.5);
            --shadow-pill: 0 4px 12px rgba(0,0,0,0.4);
          }
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo',
            'Noto Sans KR', sans-serif;
          overflow: hidden;
          background: var(--bg-body);
          color: var(--text-1);
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes toastIn {
          from { opacity: 0; transform: translate(-50%, 8px); }
          to   { opacity: 1; transform: translate(-50%, 0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes sheetUp {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
        @keyframes footerRoll {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .store-copy-btn:active { background: #e5e8ec !important; }
        .store-address:active  { color: #3182f6 !important; }
        .store-nav-btn:active  { background: #f2f4f6 !important; transform: scale(0.95); }
        .store-nav-btn         { transition: transform 0.1s ease-out; }
        /* 버튼 사이 세로 격자 (마지막 버튼 제외) */
        .store-nav-btn:not(:last-child)::after {
          content: '';
          position: absolute;
          top: 12px;
          bottom: 12px;
          right: -3px;
          width: 1px;
          background: #e5e8ec;
        }
        .region-select {
          appearance: none;
          -webkit-appearance: none;
          background-color: var(--surface-2);
          border: none;
          border-radius: 8px;
          padding: 8px 28px 8px 12px;
          font-size: 13px;
          font-weight: 600;
          color: var(--text-1);
          background-image: url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1.5L6 6L11 1.5' stroke='%238b95a1' stroke-width='1.6' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 10px center;
          outline: none;
        }
        button > svg { color: var(--text-1); }
        /* NAVER 지도 SDK가 강제로 렌더링하는 attribution/legal 링크 숨김 */
        a[href*="pstatic.net/static/maps/mantle/notice/legal.html"],
        a[href*="ssl.pstatic.net/static/maps/mantle/notice"] {
          display: none !important;
        }
        .store-copy-btn { background: var(--surface-2) !important; }
        .store-copy-btn:active { background: var(--border-2) !important; }
        .store-nav-btn:active { background: var(--surface-2) !important; }
      `}</style>

      {view === 'feedback' && (
        <FeedbackView
          onClose={() => {
            setFeedbackStoreContext(null);
            setView('map');
          }}
          onShowToast={showToast}
          storeContext={feedbackStoreContext}
          userLocation={userPosition}
        />
      )}

      {(view === 'nearby' || view === 'favorites') && (
        <NearbyView
          mode={
            stadiumContext
              ? 'stadium'
              : view === 'favorites'
                ? 'favorites'
                : 'nearby'
          }
          stores={
            view === 'favorites'
              ? stores.filter((s) => favorites.has(s.id))
              : visibleStores
          }
          userPosition={
            stadiumContext
              ? [stadiumContext.lat, stadiumContext.lng]
              : userPosition
          }
          title={
            stadiumContext
              ? `🏟️ ${stadiumContext.name} 주변`
              : view === 'favorites'
                ? '⭐ 즐겨찾기'
                : '내 주변 판매점'
          }
          emptyMessage={
            stadiumContext
              ? `${stadiumContext.name} 반경 2km 내\n판매점이 없어요.`
              : view === 'favorites'
                ? '아직 즐겨찾기한 판매점이 없어요.\n핀을 누르고 별을 눌러보세요.'
                : '표시할 판매점이 없어요.'
          }
          getAddedAt={
            view === 'favorites' ? (id) => getFavoriteAddedAt(id) : undefined
          }
          mapBounds={view === 'nearby' && !stadiumContext ? mapBounds : null}
          initialViewportOnly={
            view === 'nearby' && !stadiumContext ? nearbyInitialViewport : false
          }
          initialRadiusKm={stadiumContext ? STADIUM_RADIUS_KM : null}
          onRemoveBatch={
            view === 'favorites'
              ? (ids) => {
                  const next = removeFavoritesBatch(ids);
                  setFavorites(new Set(next));
                }
              : undefined
          }
          onShowToast={showToast}
          onClose={() => {
            setNearbyInitialViewport(false);
            if (stadiumContext) {
              setStadiumContext(null);
              setView('stadiums');
            } else {
              setView('map');
            }
          }}
          onSelect={focusOnStore}
        />
      )}

      {view === 'stadiums' && (
        <StadiumView
          userPosition={userPosition}
          stores={stores}
          onClose={() => setView('map')}
          onSelectStadium={(stadium) => {
            setStadiumContext(stadium);
            setView('nearby');
          }}
        />
      )}

      {view === 'search' && (
        <SearchView
          stores={stores}
          onClose={() => setView('map')}
          onSelect={focusOnStore}
        />
      )}

      {/* 지도 영역(헤더/지도/푸터)은 항상 렌더링.
          - 다른 view(피드백/리스트)는 position:fixed로 덮어씌워짐
          - view 전환 시 지도 div가 unmount되지 않아 네이버 인스턴스가 살아있음 */}
      <>

      {/* 헤더 */}
      <div
        style={{
          height: HEADER_HEIGHT,
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          padding: '12px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        {/* 첫 줄: 타이틀 + 제보하기 버튼 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div
            style={{
              fontSize: 17,
              fontWeight: 700,
              color: 'var(--text-1)',
              letterSpacing: '-0.3px',
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            🏪 전국 스포츠토토 판매점 찾기
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
            {isAdmin && (
              <a
                href={FORMSPREE_DASHBOARD}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="제보 목록 보기 (관리자)"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  background: 'var(--warning-bg)',
                  color: 'var(--warning-text)',
                  padding: '6px 10px',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 700,
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                  border: '1px solid var(--warning-border)',
                }}
              >
                👑 제보 보기
              </a>
            )}
            <button
              type="button"
              aria-label="판매점 검색"
              onClick={() => setView('search')}
              style={{
                width: 40,
                height: 40,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
                borderRadius: 8,
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <circle
                  cx="10"
                  cy="10"
                  r="6.5"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <path
                  d="M15 15l4 4"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <button
              type="button"
              aria-label="메뉴 열기"
              onClick={() => setMenuOpen(true)}
              style={{
                width: 40,
                height: 40,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
                borderRadius: 8,
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <path d="M3 6h16M3 11h16M3 16h16"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* 두 번째 줄: 업데이트 정보 + 바로 우측에 지역 셀렉트 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            minHeight: 28,
          }}
        >
          <div
            style={{
              fontSize: 12,
              color: 'var(--text-3)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
              flex: '0 1 auto',
            }}
          >
            전국 {stores.length.toLocaleString()}개
            {lastUpdatedLabel && (
              <>
                <span style={{ margin: '0 6px', color: '#d1d6db' }}>·</span>
                <span>최근 업데이트: {lastUpdatedLabel}</span>
              </>
            )}
          </div>
          <select
            className="region-select"
            value={regionFilter}
            onChange={(e) => {
              setRegionFilter(e.target.value);
              setSubRegionFilter('전체');
            }}
            style={{ flexShrink: 0 }}
          >
            {regions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          {showSubRegion && (
            <select
              className="region-select"
              value={subRegionFilter}
              onChange={(e) => setSubRegionFilter(e.target.value)}
              style={{ flexShrink: 0 }}
              aria-label="시/구 선택"
            >
              {subRegionOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* 지도 */}
      <div style={{ height: mapHeight, position: 'relative', background: 'var(--bg-body)' }}>
        {showLoading && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 1000,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(255,255,255,0.9)',
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                border: '3px solid #e5e8ec',
                borderTop: '3px solid #3182f6',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
                marginBottom: 12,
              }}
            />
            <div style={{ fontSize: 14, color: 'var(--text-3)' }}>
              {!sdkReady ? '네이버 지도 불러오는 중...' : '위치를 확인하고 있어요...'}
            </div>
          </div>
        )}

        {errorText && (
          <div
            style={{
              position: 'absolute',
              top: 12,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 1000,
              background: 'var(--warning-bg)',
              border: '1px solid var(--warning-border)',
              borderRadius: 8,
              padding: '8px 14px',
              fontSize: 12,
              color: '#856404',
              whiteSpace: 'nowrap',
              maxWidth: 'calc(100% - 24px)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            ⚠️ {errorText}
          </div>
        )}

        <div
          ref={mapContainerRef}
          style={{ width: '100%', height: '100%' }}
        />

        {/* "이 지역 판매점 보기" 버튼 (지도 상단 중앙) */}
        {view === 'map' && storesInViewport > 0 && (
          <button
            type="button"
            onClick={() => {
              setNearbyInitialViewport(true);
              setView('nearby');
            }}
            style={{
              position: 'absolute',
              top: 12,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 500,
              height: 36,
              padding: '0 14px',
              border: 'none',
              borderRadius: 18,
              background: 'var(--surface)',
              color: 'var(--text-1)',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              WebkitTapHighlightColor: 'transparent',
              whiteSpace: 'nowrap',
            }}
          >
            <span aria-hidden>📋</span>
            이 지역 판매점 {storesInViewport.toLocaleString()}개 보기
          </button>
        )}

        {/* 현재 위치 FAB (지도 화면일 때만) */}
        {view === 'map' && (
        <button
          type="button"
          aria-label="현재 위치로 이동"
          onClick={() => handleLocateMe(true)}
          disabled={!mapInstance || isFindingMe}
          style={{
            position: 'absolute',
            right: 16,
            bottom: 16,
            zIndex: 500,
            width: 52,
            height: 52,
            borderRadius: '50%',
            border: 'none',
            background: 'var(--surface)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            opacity: !mapInstance || isFindingMe ? 0.6 : 1,
            transition: 'transform 0.15s, opacity 0.15s',
          }}
          onTouchStart={(e) => {
            e.currentTarget.style.transform = 'scale(0.94)';
          }}
          onTouchEnd={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          {isFindingMe ? (
            <div
              style={{
                width: 22,
                height: 22,
                border: '2.5px solid #e5e8ec',
                borderTop: '2.5px solid #3182f6',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }}
            />
          ) : (
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle cx="12" cy="12" r="3" fill="#3182f6" />
              <path
                d="M12 2v3M12 19v3M2 12h3M19 12h3"
                stroke="#3182f6"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <circle
                cx="12"
                cy="12"
                r="8"
                stroke="#3182f6"
                strokeWidth="1.5"
                fill="none"
                opacity="0.3"
              />
            </svg>
          )}
        </button>
        )}
      </div>

      {/* 푸터 */}
      <div
        style={{
          height: FOOTER_HEIGHT,
          background: 'var(--surface)',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
        }}
      >
        <div
          aria-hidden
          style={{
            width: footerMsgIndex === 0 ? 8 : 0,
            height: 8,
            background: 'var(--accent)',
            borderRadius: '50%',
            flexShrink: 0,
            opacity: footerMsgIndex === 0 ? 1 : 0,
            marginRight: footerMsgIndex === 0 ? 0 : -6,
            transition: 'opacity 0.3s ease, width 0.3s ease, margin-right 0.3s ease',
          }}
        />
        <div
          style={{
            position: 'relative',
            flex: '0 1 auto',
            minWidth: 0,
            maxWidth: 'calc(100% - 32px)',
            height: 18,
            overflow: 'hidden',
          }}
        >
          <span
            key={footerMsgIndex}
            aria-live="polite"
            style={{
              display: 'block',
              fontSize: 12,
              color: 'var(--text-3)',
              lineHeight: '18px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              animation: 'footerRoll 0.4s ease',
            }}
          >
            {footerMessages[footerMsgIndex]}
          </span>
        </div>
      </div>

      </>

      {/* 메뉴 바텀시트 */}
      {menuOpen && (
        <div
          onClick={() => setMenuOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 8000,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            animation: 'fadeIn 0.18s ease-out',
          }}
        >
          <div
            role="menu"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--surface)',
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              paddingBottom: 'env(safe-area-inset-bottom, 12px)',
              animation: 'sheetUp 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)',
            }}
          >
            {/* 핸들 */}
            <div
              style={{
                width: 36,
                height: 4,
                borderRadius: 2,
                background: '#e5e8ec',
                margin: '10px auto 6px',
              }}
            />
            <div style={{ padding: '8px 8px 20px' }}>
              <MenuItem
                icon="📍"
                label="내 주변 판매점"
                description="가까운 순서로 한눈에 보기"
                onClick={() => {
                  setMenuOpen(false);
                  setView('nearby');
                }}
              />
              <MenuItem
                icon="🏟️"
                label="경기장 주변 판매점 보기"
                description="프로 스포츠 홈구장 반경 2km 이내"
                onClick={() => {
                  setMenuOpen(false);
                  setView('stadiums');
                }}
              />
              <MenuItem
                icon="⭐"
                label={
                  favorites.size > 0
                    ? `즐겨찾기 (${favorites.size})`
                    : '즐겨찾기'
                }
                description="자주 가는 판매점만 모아보기"
                onClick={() => {
                  setMenuOpen(false);
                  setView('favorites');
                }}
              />
              <MenuItem
                icon="📤"
                label="이 미니앱 공유하기"
                description="친구에게 토스 미니앱 링크를 보내요"
                onClick={async () => {
                  setMenuOpen(false);
                  try {
                    const r = await shareMiniApp();
                    if (r === 'copied') {
                      showToast('공유 링크가 복사됐어요');
                    }
                  } catch (err) {
                    const name = (err as { name?: string })?.name;
                    if (name !== 'AbortError') {
                      console.error(err);
                      showToast('공유에 실패했어요');
                    }
                  }
                }}
              />
              <MenuItem
                icon="📢"
                label="제보하기"
                description="잘못된 정보·폐업 판매점·개선 의견"
                onClick={() => {
                  setMenuOpen(false);
                  setView('feedback');
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* 토스트 */}
      {toastMessage && (
        <div
          aria-live="polite"
          style={{
            position: 'fixed',
            left: '50%',
            bottom: FOOTER_HEIGHT + 24,
            transform: 'translateX(-50%)',
            zIndex: 9000,
            background: 'rgba(25, 31, 40, 0.92)',
            color: '#fff',
            padding: '12px 20px',
            borderRadius: 12,
            fontSize: 14,
            fontWeight: 600,
            boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            maxWidth: 'calc(100% - 32px)',
            whiteSpace: 'nowrap',
            animation: 'toastIn 0.2s ease-out',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="9" cy="9" r="9" fill="#3182f6" />
            <path
              d="M5 9.5L7.5 12L13 6.5"
              stroke="#fff"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {toastMessage}
        </div>
      )}

      {/* 스플래시 화면 (가장 위에 표시) */}
      {splashVisible && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99999,
            background: 'var(--surface)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: splashEnded ? 0 : 1,
            transition: 'opacity 0.3s ease',
            pointerEvents: splashEnded ? 'none' : 'auto',
            padding: '0 24px',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontSize: 72,
              marginBottom: 18,
              lineHeight: 1,
            }}
          >
            🏪
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: 'var(--text-1)',
              marginBottom: 8,
              letterSpacing: '-0.5px',
            }}
          >
            전국 오프라인 스포츠토토 판매점 찾기
          </div>
          <div
            style={{
              fontSize: 14,
              color: 'var(--text-3)',
              marginBottom: 44,
            }}
          >
            전국 6,000여 판매점을 한눈에
          </div>
          <div
            style={{
              width: 28,
              height: 28,
              border: '3px solid #e5e8ec',
              borderTop: '3px solid #3182f6',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }}
          />
        </div>
      )}

      {/* 위치 권한 거부 안내 다이얼로그 */}
      {permissionDialogOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
          onClick={() => setPermissionDialogOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--surface)',
              borderRadius: 16,
              padding: '24px 20px 16px',
              width: '100%',
              maxWidth: 320,
              boxShadow: '0 12px 32px rgba(0,0,0,0.2)',
            }}
          >
            <div
              style={{
                fontSize: 17,
                fontWeight: 700,
                color: 'var(--text-1)',
                textAlign: 'center',
                marginBottom: 8,
              }}
            >
              위치 권한이 필요해요
            </div>
            <div
              style={{
                fontSize: 14,
                color: 'var(--text-2)',
                textAlign: 'center',
                lineHeight: 1.5,
                marginBottom: 20,
              }}
            >
              현재 위치를 표시하려면 위치 권한을 허용해주세요.
              <br />
              기기 설정에서 권한을 켤 수 있어요.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => setPermissionDialogOpen(false)}
                style={{
                  flex: 1,
                  height: 48,
                  border: 'none',
                  borderRadius: 10,
                  background: 'var(--surface-2)',
                  color: 'var(--text-2)',
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                닫기
              </button>
              <button
                type="button"
                onClick={() => {
                  setPermissionDialogOpen(false);
                  void handleLocateMe(true);
                }}
                style={{
                  flex: 1,
                  height: 48,
                  border: 'none',
                  borderRadius: 10,
                  background: 'var(--accent)',
                  color: '#fff',
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                다시 시도
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
