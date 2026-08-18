import type { Driver, DriverStatus, LiveDriver, LocationPoint } from '../types';

const NAMES = [
  ['Carlos', '541123456701'],
  ['María', '541123456702'],
  ['Jorge', '541123456703'],
  ['Lucía', '541123456704'],
  ['Ramón', '541123456705'],
  ['Sofía', '541123456706'],
  ['Pablo', '541123456707'],
  ['Ana', '541123456708'],
  ['Luis', '541123456709'],
  ['Valentina', '541123456710'],
] as const;

const COLORS = [
  '#2563eb',
  '#dc2626',
  '#16a34a',
  '#d97706',
  '#7c3aed',
  '#db2777',
  '#0891b2',
  '#4f46e5',
  '#65a30d',
  '#ea580c',
];

interface DemoUnit {
  driver: Driver;
  status: DriverStatus;
  lat: number;
  lng: number;
  heading: number;
  history: LocationPoint[];
}

const CENTER = { lat: -27.3556, lng: -55.837 }; // Cambyretá, Encarnación, Paraguay
const HOME = [1, 2, 5, 8]; // indices que arrancan "parados"

function startUnits(): DemoUnit[] {
  return NAMES.map(([name, phone], i) => {
    const angle = (i / NAMES.length) * Math.PI * 2;
    const radius = 0.035 + (i % 3) * 0.02;
    const lat = CENTER.lat + Math.cos(angle) * radius;
    const lng = CENTER.lng + Math.sin(angle) * radius;
    const moving = !HOME.includes(i);
    return {
      driver: {
        id: `demo-${i + 1}`,
        name,
        phone,
        color: COLORS[i],
        is_admin: false,
        created_at: new Date().toISOString(),
      },
      status: {
        driver_id: `demo-${i + 1}`,
        lat,
        lng,
        speed: moving ? 6 + (i % 4) * 2 : 0,
        is_moving: moving,
        distance_m: 0,
        updated_at: new Date().toISOString(),
      },
      lat,
      lng,
      heading: angle,
      history: [],
    };
  });
}

let units: DemoUnit[] | null = null;

function all(): DemoUnit[] {
  if (!units) units = startUnits();
  return units;
}

export function demoSnapshot(): LiveDriver[] {
  return all().map((u) => ({
    ...u.driver,
    status: { ...u.status },
  }));
}

export function demoTick(): LiveDriver[] {
  const now = Date.now();
  for (const u of all()) {
    let step = 0;
    if (u.status.is_moving) {
      u.heading += (Math.random() - 0.5) * 0.12;
      const speed = 5 + Math.random() * 7; // m/s aprox
      step = speed * 2.5; // 2.5s de tick
      u.lat += (Math.cos(u.heading) * step) / 111_320;
      u.lng += (Math.sin(u.heading) * step) / (111_320 * Math.cos((u.lat * Math.PI) / 180));
    }
    u.status = {
      driver_id: u.driver.id,
      lat: u.lat,
      lng: u.lng,
      speed: u.status.is_moving ? 5 + Math.random() * 7 : 0,
      is_moving: u.status.is_moving,
      distance_m: (u.status.distance_m ?? 0) + step,
      updated_at: new Date(now).toISOString(),
    };
    u.history.push({
      id: now + u.history.length,
      driver_id: u.driver.id,
      lat: u.lat,
      lng: u.lng,
      speed: u.status.speed,
      created_at: u.status.updated_at,
    });
    if (u.history.length > 400) u.history.splice(0, 200);
  }
  return demoSnapshot();
}

export function demoTrajectory(driverId: string): LocationPoint[] {
  return all()
    .find((u) => u.driver.id === driverId)
    ?.history.slice(-200) ?? [];
}
