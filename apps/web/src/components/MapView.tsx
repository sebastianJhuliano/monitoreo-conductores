import { useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { LiveDriver, LocationPoint } from '../types';
import { waLink, timeAgo, formatPhone } from '../lib/wa';

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const CENTER: [number, number] = [-27.3556, -55.837]; // Cambyretá, Encarnación, Paraguay

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return map[c]!;
  });
}

function markerIcon(d: LiveDriver, now: number): L.DivIcon {
  const offline = d.status ? now - new Date(d.status.updated_at).getTime() > 120_000 : false;
  const cls = ['mc-marker'];
  if (offline) cls.push('mc-marker-offline');
  else if (d.status?.has_fix === false) cls.push('mc-marker-gps');
  else if (d.status?.is_moving) cls.push('mc-marker-moving');
  return L.divIcon({
    className: 'mc-div-icon',
    html: `<div class="${cls.join(' ')}" style="--mc-color:${d.color}">
      <span class="mc-marker-dot"></span>
      <span class="mc-marker-label">${escapeHtml(d.name)}</span>
    </div>`,
    iconSize: [120, 46],
    iconAnchor: [60, 14],
    popupAnchor: [0, -14],
  });
}

// Distancia en metros entre dos coordenadas (haversine).
function distM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(x));
}

// Divide la trayectoria en segmentos y calcula los km reales:
//  - No une con línea los saltos imposibles (> 1.2 km entre puntos
//    consecutivos, errores de GPS viejos).
//  - No une con línea si la velocidad implícita es imposible (> 45 m/s).
//  - Quita picos aislados: un punto lejos de sus DOS vecinos que están
//    cerca entre sí es un error de GPS, no un desvío real.
//  - Simplifica con Douglas-Peucker (epsilon 20 m): el ruido lateral del
//    GPS hace "serpentear" la línea y suma km falsos. Los puntos que se
//    desvían menos de 20 m de la línea recta entre vecinos son ruido y se
//    eliminan (se conservan curvas y esquinas reales).
//    IMPORTANTE: el km se calcula sobre la línea YA simplificada, así el
//    pago coincide exactamente con lo que se ve dibujado.
const MAX_SEGMENT_M = 1200;
const MAX_TRAJ_SPEED_MPS = 45;
const SPIKE_M = 500;
const SIMPLIFY_EPSILON_M = 20;

interface Pt {
  lat: number;
  lng: number;
  ts: number;
}

// Distancia perpendicular de un punto a la recta a-b (metros).
function pointToSegmentM(p: Pt, a: Pt, b: Pt): number {
  const cosLat = Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  const ax = a.lng * cosLat;
  const ay = a.lat;
  const bx = b.lng * cosLat;
  const by = b.lat;
  const px = p.lng * cosLat;
  const py = p.lat;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) * 111_320;
}

// Douglas-Peucker iterativo: elimina puntos que se desvían menos de
// epsilon de la línea recta entre sus vecinos (ruido del GPS).
function simplify(points: Pt[], epsilon: number): Pt[] {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    if (b - a < 2) continue;
    let maxD = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = pointToSegmentM(points[i], points[a], points[b]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > epsilon) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

function cleanTrajectory(points: LocationPoint[]): {
  segments: [number, number][][];
  km: number;
} {
  const pts: Pt[] = points.map((p) => ({
    lat: p.lat,
    lng: p.lng,
    ts: new Date(p.created_at).getTime(),
  }));

  const kept: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    if (i === 0 || i === pts.length - 1) {
      kept.push(pts[i]);
      continue;
    }
    const a = pts[i - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const ab = distM(a.lat, a.lng, b.lat, b.lng);
    const bc = distM(b.lat, b.lng, c.lat, c.lng);
    const ac = distM(a.lat, a.lng, c.lat, c.lng);
    if (ab > SPIKE_M && bc > SPIKE_M && ac < MAX_SEGMENT_M) continue;
    kept.push(b);
  }

  const segments: Pt[][] = [];
  let cur: Pt[] = [];
  let prev: Pt | null = null;
  for (const p of kept) {
    if (cur.length === 0) {
      cur.push(p);
      prev = p;
      continue;
    }
    const d = distM(prev!.lat, prev!.lng, p.lat, p.lng);
    const dt = (p.ts - prev!.ts) / 1000;
    if (d > MAX_SEGMENT_M || (dt > 0 && d / dt > MAX_TRAJ_SPEED_MPS)) {
      if (cur.length > 1) segments.push(cur);
      cur = [p];
    } else {
      cur.push(p);
    }
    prev = p;
  }
  if (cur.length > 1) segments.push(cur);

  let km = 0;
  const simplified: [number, number][][] = [];
  for (const seg of segments) {
    const clean = simplify(seg, SIMPLIFY_EPSILON_M);
    if (clean.length > 1) {
      for (let i = 1; i < clean.length; i++) {
        km += distM(clean[i - 1].lat, clean[i - 1].lng, clean[i].lat, clean[i].lng);
      }
      simplified.push(clean.map((p) => [p.lat, p.lng] as [number, number]));
    }
  }
  return { segments: simplified, km };
}

function fmtKm(km: number): string {
  return km >= 1000 ? `${(km / 1000).toFixed(1)} km` : `${Math.round(km)} m`;
}

// km total del conductor: lo acumula el SERVIDOR (distance_m) sin límite
// de puntos (viaja un mes y el total sigue completo). Solo si el servidor
// aún no tiene total (0), se usa el km de la ventana dibujada.
function totalKm(s: { distance_m?: number } | null | undefined, drawnKm: number): number {
  if (s && typeof s.distance_m === 'number' && s.distance_m > 0) return s.distance_m;
  return drawnKm;
}

function FitDrivers({ drivers }: { drivers: LiveDriver[] }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current) return;
    const pts = drivers
      .filter((d) => d.status && !d.is_admin)
      .map((d) => [d.status!.lat, d.status!.lng] as [number, number]);
    if (pts.length === 0) return;
    map.fitBounds(L.latLngBounds(pts), { padding: [40, 40] });
    fitted.current = true;
  }, [drivers, map]);
  return null;
}

function FlyTo({ target }: { target: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo(target, Math.max(map.getZoom(), 15), { duration: 0.9 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.[0], target?.[1]]);
  return null;
}

interface MapViewProps {
  drivers: LiveDriver[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  trajectory: LocationPoint[];
  now: number;
  onClearTrajectory?: (id: string, name: string) => void;
}

export default function MapView({
  drivers,
  selectedId,
  onSelect,
  trajectory,
  now,
  onClearTrajectory,
}: MapViewProps) {
  const visible = useMemo(() => drivers.filter((d) => !d.is_admin), [drivers]);
  const icons = useMemo(
    () => new Map(visible.map((d) => [d.id, markerIcon(d, now)])),
    [visible, now],
  );
  const selected = visible.find((d) => d.id === selectedId) ?? null;
  const flyTarget: [number, number] | null = selected?.status
    ? [selected.status.lat, selected.status.lng]
    : null;
  const { segments, km } = useMemo(() => cleanTrajectory(trajectory), [trajectory]);

  return (
    <MapContainer center={CENTER} zoom={13} className="mc-map">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url={TILE_URL}
      />
      <FitDrivers drivers={visible} />
      <FlyTo target={flyTarget} />
      {segments.map((seg, i) => (
        <Polyline
          key={i}
          positions={seg}
          pathOptions={{ color: selected?.color ?? '#3b82f6', weight: 4, opacity: 0.85 }}
        />
      ))}
      {visible.map((d) => {
        if (!d.status) return null;
        const s = d.status;
        return (
          <Marker
            key={d.id}
            position={[s.lat, s.lng]}
            icon={icons.get(d.id)}
            eventHandlers={{ click: () => onSelect(d.id) }}
          >
            <Popup>
              <div className="mc-popup">
                <div className="mc-popup-name">{d.name}</div>
                <div className="mc-popup-meta">
                  {s.has_fix === false ? (
                    <>
                      <span className="mc-dot-sm mc-dot-gps" />
                      Sin señal GPS
                    </>
                  ) : (
                    <>
                      <span className={`mc-dot-sm ${s.is_moving ? 'mc-dot-moving' : 'mc-dot-stopped'}`} />
                      {s.is_moving ? 'En movimiento' : 'Detenido'}
                    </>
                  )}
                </div>
                <div className="mc-popup-meta">Tel: {formatPhone(d.phone) || '—'}</div>
                <div className="mc-popup-meta">Actualizado {timeAgo(s.updated_at)}</div>
                {totalKm(s, selectedId === d.id ? km : 0) > 0 && (
                  <div className="mc-popup-meta">
                    Recorrido total: {fmtKm(totalKm(s, selectedId === d.id ? km : 0))}
                  </div>
                )}
                <div className="mc-popup-actions">
                  <a
                    className="mc-btn mc-btn-wa"
                    href={waLink(d.phone, `Hola ${d.name}, te escribe el Centro de Monitoreo.`)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    WhatsApp
                  </a>
                  <button className="mc-btn" onClick={() => onSelect(d.id)}>
                    Trayectoria
                  </button>
                  {onClearTrajectory && (
                    <button className="mc-btn" onClick={() => onClearTrajectory(d.id, d.name)}>
                      Limpiar
                    </button>
                  )}
                </div>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
