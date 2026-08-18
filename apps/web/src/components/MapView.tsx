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

// Divide la trayectoria en segmentos: no une con una línea los saltos
// imposibles (> 1.2 km entre puntos consecutivos, errores de GPS viejos).
const MAX_SEGMENT_M = 1200;
function splitSegments(positions: [number, number][]): [number, number][][] {
  const segments: [number, number][][] = [];
  let cur: [number, number][] = [];
  for (let i = 0; i < positions.length; i++) {
    if (
      cur.length > 0 &&
      distM(cur[cur.length - 1][0], cur[cur.length - 1][1], positions[i][0], positions[i][1]) >
        MAX_SEGMENT_M
    ) {
      if (cur.length > 1) segments.push(cur);
      cur = [positions[i]];
    } else {
      cur.push(positions[i]);
    }
  }
  if (cur.length > 1) segments.push(cur);
  return segments;
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
  const positions = useMemo(
    () => trajectory.map((p) => [p.lat, p.lng] as [number, number]),
    [trajectory],
  );
  const segments = useMemo(() => splitSegments(positions), [positions]);

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
