export interface Driver {
  id: string;
  name: string;
  phone: string;
  color: string;
  is_admin: boolean;
  created_at: string;
}

export interface DriverStatus {
  driver_id: string;
  lat: number;
  lng: number;
  speed: number;
  is_moving: boolean;
  has_fix?: boolean;
  distance_m?: number;
  updated_at: string;
}

export interface LiveDriver extends Driver {
  status: DriverStatus | null;
}

export interface LocationPoint {
  id: number;
  driver_id: string;
  lat: number;
  lng: number;
  speed: number | null;
  created_at: string;
}
