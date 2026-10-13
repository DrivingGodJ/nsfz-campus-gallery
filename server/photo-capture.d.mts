type Capture = { captureType?: string; metadata?: { aerial?: unknown }; locationId?: unknown; buildingId?: unknown };
export function isAerialPhoto(photo: Capture): boolean;
export function withoutAerialLocation<T extends Capture>(photo: T): T;
