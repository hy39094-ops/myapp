/// <reference types="vite/client" />

declare module "*.css" {
  const content: Record<string, string>;
  export default content;
}

interface ImportMetaEnv {
  readonly VITE_NAVER_MAP_CLIENT_ID: string;
  readonly VITE_FORMSPREE_ENDPOINT?: string;
  readonly VITE_ADMIN_CODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// 네이버 지도 SDK 전역 타입 (최소한만)
interface NaverPoint {
  x: number;
  y: number;
}
interface NaverSize {
  width: number;
  height: number;
}
interface NaverLatLng {
  lat: () => number;
  lng: () => number;
}
interface NaverMap {
  setCenter: (latlng: NaverLatLng) => void;
  panTo: (latlng: NaverLatLng) => void;
  setZoom: (zoom: number) => void;
}
interface NaverMarker {
  setMap: (map: NaverMap | null) => void;
  getPosition: () => NaverLatLng;
}
interface NaverInfoWindow {
  open: (map: NaverMap, anchor?: NaverMarker | NaverLatLng) => void;
  close: () => void;
  setContent: (html: string | HTMLElement) => void;
  setPosition: (latlng: NaverLatLng) => void;
}

interface Window {
  naver?: {
    maps: {
      Map: new (
        el: HTMLElement | string,
        options?: Record<string, unknown>
      ) => NaverMap;
      LatLng: new (lat: number, lng: number) => NaverLatLng;
      Marker: new (options: Record<string, unknown>) => NaverMarker;
      InfoWindow: new (options: Record<string, unknown>) => NaverInfoWindow;
      Point: new (x: number, y: number) => NaverPoint;
      Size: new (w: number, h: number) => NaverSize;
      Event: {
        addListener: (
          target: unknown,
          event: string,
          handler: (...args: unknown[]) => void
        ) => unknown;
      };
      Position: {
        BOTTOM_RIGHT: number;
        TOP_RIGHT: number;
      };
    };
  };
  MarkerClustering?: new (options: Record<string, unknown>) => {
    setMap: (map: NaverMap | null) => void;
  };
}
