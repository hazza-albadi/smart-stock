export interface ZoneIn { capacity: number; fixed: number; stockUsed: number; reserved: number; rentAllowed: boolean; allocatedNow: number }

/** used = fixed + stock; rentable = capacity - used - reserved (only where renting is allowed); tenants are subtracted. */
export function zoneFigures(z: ZoneIn) {
  const used = z.fixed + z.stockUsed;
  const free = z.capacity - used - z.reserved;
  const gross = z.rentAllowed ? Math.max(0, Math.round(free)) : 0;
  const net = Math.max(0, gross - z.allocatedNow);
  return {
    used, free: Math.max(0, free), rentableGross: gross, allocated: z.allocatedNow, rentableNet: net,
    overCapacity: Math.max(0, used - z.capacity),
    notRentable: z.rentAllowed ? 0 : Math.max(0, z.capacity - used - z.reserved),
  };
}

/** Physical room left for goods: capacity - fixed - stock - area promised to tenants whose lease is active. */
export const physicalRoom = (z: { capacity: number; fixed: number; stockUsed: number; tenantsActive: number }) =>
  z.capacity - z.fixed - z.stockUsed - z.tenantsActive;

export interface LeaseLite { start_date: string; end_date: string; area: number }
/** A lease covers [start, end): active on `date` when start <= date < end. */
export const leaseActive = (l: LeaseLite, date: string) => l.start_date <= date && date < l.end_date;
export const leaseOverlaps = (l: LeaseLite, from: string, to: string) => l.start_date < to && from < l.end_date;
