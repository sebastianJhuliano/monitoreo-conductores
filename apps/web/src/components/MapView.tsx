import { useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { LiveDriver, LocationPoint } from '../types';
import { waLink, timeAgo } from '../lib/wa';

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const CENTER: [number, number] = [-34.6037, -58.3816];

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
}

export default function MapView({ drivers, selectedId, onSelect, trajectory, now }: MapViewProps) {
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

  return (
    <MapContainer center={CENTER} zoom={13} className="mc-map">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url={TILE_URL}
      />
      <FitDrivers drivers={visible} />
      <FlyTo target={flyTarget} />
      {trajectory.length > 1 && selected && (
        <Polyline
          positions={positions}
          pathOptions={{ color: selected.color, weight: 4, opacity: 0.85 }}
        />
      )}
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
                  <span className={`mc-dot-sm ${s.is_moving ? 'mc-dot-moving' : 'mc-dot-stopped'}`} />
                  {s.is_moving ? 'En movimiento' : 'Detenido'}
                </div>
                <div className="mc-popup-meta">Tel: {d.phone || '—'}</div>
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
                </div>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
