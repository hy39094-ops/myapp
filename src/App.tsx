import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchCurrentLocation,
  LocationPermissionDeniedError,
  type LatLng,
} from './location';
import { copyToClipboard } from './clipboard';
import { navigateKakao, navigateNaver, navigateTmap } from './navigation';
import { sendFeedback } from './feedback';

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
type View = 'map' | 'feedback';

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

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 제보 화면. 제목(선택) + 본문(필수) + [취소][완료] 버튼.
function FeedbackView({
  onClose,
  onShowToast,
}: {
  onClose: () => void;
  onShowToast: (msg: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const trimmedBody = body.trim();
  const canSubmit = trimmedBody.length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!trimmedBody) {
      onShowToast('내용을 입력해주세요');
      return;
    }
    setSubmitting(true);
    try {
      await sendFeedback({ title, body: trimmedBody });
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
        background: '#fff',
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
          borderBottom: '1px solid #f0f0f3',
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
              stroke="#191f28"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#191f28' }}>
          제보하기
        </div>
        <div style={{ width: 44 }} />
      </div>

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
        <div>
          <label
            htmlFor="feedback-title"
            style={{
              display: 'block',
              fontSize: 13,
              color: '#4e5968',
              fontWeight: 600,
              marginBottom: 6,
            }}
          >
            제목{' '}
            <span style={{ color: '#8b95a1', fontWeight: 500 }}>(선택)</span>
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
              border: '1px solid #e5e8ec',
              borderRadius: 10,
              fontSize: 15,
              outline: 'none',
              fontFamily: 'inherit',
              background: '#fff',
              color: '#191f28',
            }}
          />
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <label
            htmlFor="feedback-body"
            style={{
              display: 'block',
              fontSize: 13,
              color: '#4e5968',
              fontWeight: 600,
              marginBottom: 6,
            }}
          >
            내용 <span style={{ color: '#f04438', fontWeight: 500 }}>*</span>
          </label>
          <textarea
            id="feedback-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="잘못된 정보, 폐업한 판매점, 개선 의견 등 자유롭게 적어주세요."
            maxLength={2000}
            style={{
              flex: 1,
              minHeight: 200,
              padding: '12px 14px',
              border: '1px solid #e5e8ec',
              borderRadius: 10,
              fontSize: 15,
              lineHeight: 1.5,
              outline: 'none',
              fontFamily: 'inherit',
              background: '#fff',
              color: '#191f28',
              resize: 'none',
            }}
          />
          <div
            style={{
              alignSelf: 'flex-end',
              marginTop: 6,
              fontSize: 12,
              color: '#8b95a1',
            }}
          >
            {body.length} / 2000
          </div>
        </div>
      </div>

      {/* 하단 버튼 */}
      <div
        style={{
          padding: '12px 16px 20px',
          display: 'flex',
          gap: 8,
          borderTop: '1px solid #f0f0f3',
          background: '#fff',
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
            background: '#f2f4f6',
            color: '#4e5968',
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
            background: canSubmit ? '#3182f6' : '#c6d3e1',
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
  }
): HTMLDivElement {
  const root = document.createElement('div');
  root.style.cssText = `
    min-width: 240px;
    max-width: 280px;
    padding: 14px 16px 12px;
    background: #fff;
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
                background:#fff;
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
               background:#f2f4f6;
               object-fit:cover;
             "
             onerror="this.style.opacity='0'" />
        <span style="font-size:11px;color:#4e5968;font-weight:600;white-space:nowrap;">
          ${app.label}
        </span>
      </button>
    `
  ).join('');

  root.innerHTML = `
    <div style="font-size:14px;font-weight:700;color:#191f28;margin-bottom:8px;">
      ${escapeHtml(store.name)}
    </div>
    <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:12px;">
      <div class="store-address"
           role="button"
           aria-label="주소 복사"
           style="
             flex:1;
             font-size:12px;
             color:#4e5968;
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
                background:#f2f4f6;
                cursor:pointer;
                display:flex;
                align-items:center;
                justify-content:center;
                padding:0;
                -webkit-tap-highlight-color:transparent;
              ">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="4.5" y="4.5" width="9" height="10" rx="1.5"
                stroke="#4e5968" stroke-width="1.4" fill="none"/>
          <path d="M3.5 11V2.5C3.5 1.95 3.95 1.5 4.5 1.5H10.5"
                stroke="#4e5968" stroke-width="1.4" fill="none" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
    <div style="
      display:flex;
      gap:6px;
      padding-top:10px;
      border-top:1px solid #f0f0f3;
    ">
      ${navButtonsHtml}
    </div>
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

  root.querySelectorAll<HTMLButtonElement>('.store-nav-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = btn.dataset.app as MapAppKey | undefined;
      if (key) callbacks.onNavigate(key);
    });
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

  const [view, setView] = useState<View>('map');
  const isAdmin = useMemo(() => checkIsAdmin(), []);

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
    const map = new naver.Map(mapContainerRef.current, {
      center: new naver.LatLng(userPosition[0], userPosition[1]),
      zoom: 12,
      minZoom: 6,
      maxZoom: 18,
      scaleControl: false,
      mapDataControl: false,
      logoControlOptions: {
        position: naver.Position.BOTTOM_RIGHT,
      },
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

    setMapInstance(map);
    setInfoWindow(iw);
  }, [sdkReady, userPosition, mapInstance]);

  // 가맹점 마커 + 클러스터링 (region filter 바뀔 때마다 재구성)
  const visibleStores = useMemo(
    () =>
      regionFilter === '전체'
        ? stores
        : stores.filter((s) => s.region === regionFilter),
    [stores, regionFilter]
  );

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
        });
        (
          infoWindow as unknown as { setContent: (c: HTMLElement | string) => void }
        ).setContent(content);
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

  const regions = useMemo(() => {
    const set = new Set<string>();
    stores.forEach((s) => set.add(s.region));
    return ['전체', ...Array.from(set).sort()];
  }, [stores]);

  const mapHeight = `calc(100vh - ${HEADER_HEIGHT + FOOTER_HEIGHT}px)`;
  const showLoading = isLocating || !sdkReady;
  const errorText = sdkError || storesError || locationError;

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo',
            'Noto Sans KR', sans-serif;
          overflow: hidden;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes toastIn {
          from { opacity: 0; transform: translate(-50%, 8px); }
          to   { opacity: 1; transform: translate(-50%, 0); }
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
          background: #f2f4f6;
          border: none;
          border-radius: 8px;
          padding: 8px 28px 8px 12px;
          font-size: 13px;
          font-weight: 600;
          color: #191f28;
          background-image: url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1.5L6 6L11 1.5' stroke='%238b95a1' stroke-width='1.6' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 10px center;
          outline: none;
        }
      `}</style>

      {view === 'feedback' && (
        <FeedbackView
          onClose={() => setView('map')}
          onShowToast={showToast}
        />
      )}

      {view === 'map' && (<>

      {/* 헤더 */}
      <div
        style={{
          height: HEADER_HEIGHT,
          background: '#fff',
          borderBottom: '1px solid #f0f0f3',
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
              fontSize: 18,
              fontWeight: 700,
              color: '#191f28',
              letterSpacing: '-0.3px',
            }}
          >
            🏪 스포츠토토 판매점
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
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
                  background: '#fff3cd',
                  color: '#856404',
                  padding: '6px 10px',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 700,
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                  border: '1px solid #ffeeba',
                }}
              >
                👑 제보 보기
              </a>
            )}
            <button
              type="button"
              onClick={() => setView('feedback')}
              style={{
                border: 'none',
                background: '#eef2ff',
                color: '#3b5bdb',
                padding: '6px 12px',
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              제보하기
            </button>
          </div>
        </div>

        {/* 두 번째 줄: 업데이트 정보 + 지역 셀렉트 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            minHeight: 28,
          }}
        >
          <div
            style={{
              fontSize: 12,
              color: '#8b95a1',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              minWidth: 0,
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
            onChange={(e) => setRegionFilter(e.target.value)}
          >
            {regions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 지도 */}
      <div style={{ height: mapHeight, position: 'relative', background: '#e8eaed' }}>
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
            <div style={{ fontSize: 14, color: '#8b95a1' }}>
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
              background: '#fff3cd',
              border: '1px solid #ffc107',
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

        {/* 현재 위치 FAB */}
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
            background: '#fff',
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
      </div>

      {/* 푸터 */}
      <div
        style={{
          height: FOOTER_HEIGHT,
          background: '#fff',
          borderTop: '1px solid #f0f0f3',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
        }}
      >
        <div style={{ width: 8, height: 8, background: '#3182f6', borderRadius: '50%' }} />
        <span style={{ fontSize: 12, color: '#8b95a1' }}>
          {regionFilter === '전체'
            ? `전국 ${visibleStores.length.toLocaleString()}개 표시 중`
            : `${regionFilter} ${visibleStores.length.toLocaleString()}개 표시 중`}
        </span>
      </div>

      </>)}

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
              background: '#fff',
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
                color: '#191f28',
                textAlign: 'center',
                marginBottom: 8,
              }}
            >
              위치 권한이 필요해요
            </div>
            <div
              style={{
                fontSize: 14,
                color: '#4e5968',
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
                  background: '#f2f4f6',
                  color: '#4e5968',
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
                  background: '#3182f6',
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
