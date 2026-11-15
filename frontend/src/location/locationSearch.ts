import type { Coordinates } from './dapperLocation';

export type LocationSearchResult = {
  id: string;
  title: string;
  subtitle: string;
  label: string;
  coordinates: Coordinates;
};

type NominatimAddress = {
  house_number?: string;
  road?: string;
  neighbourhood?: string;
  suburb?: string;
  city?: string;
  town?: string;
  village?: string;
  state?: string;
  country?: string;
};

type NominatimPlace = {
  place_id?: number | string;
  display_name?: string;
  name?: string;
  lat?: string;
  lon?: string;
  address?: NominatimAddress;
};

const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org';

function parsePlaceCoordinates(place: NominatimPlace): Coordinates | null {
  const latitude = Number(place.lat);
  const longitude = Number(place.lon);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  return { latitude, longitude };
}

function formatPlaceLabels(place: NominatimPlace): {
  title: string;
  subtitle: string;
  label: string;
} {
  const displayName = (place.display_name ?? '').trim();
  const parts = displayName
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  const title = (place.name ?? '').trim() || parts[0] || 'Selected location';
  const remainingParts =
    parts[0]?.toLowerCase() === title.toLowerCase() ? parts.slice(1) : parts;
  const subtitle = remainingParts.slice(0, 3).join(', ');
  const label = subtitle ? `${title}, ${remainingParts[0]}` : title;

  return { title, subtitle, label };
}

export async function searchLocations(
  query: string,
  signal?: AbortSignal,
): Promise<LocationSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return [];
  }

  const url = `${NOMINATIM_BASE_URL}/search?format=jsonv2&q=${encodeURIComponent(
    trimmed,
  )}&limit=5&addressdetails=1`;

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal,
  });

  if (!response.ok) {
    throw new Error('Unable to search locations right now.');
  }

  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) {
    return [];
  }

  const results: LocationSearchResult[] = [];
  for (let index = 0; index < payload.length; index += 1) {
    const item = payload[index] as NominatimPlace;
    const coordinates = parsePlaceCoordinates(item);
    if (!coordinates) {
      continue;
    }

    const { title, subtitle, label } = formatPlaceLabels(item);
    results.push({
      id: String(item.place_id ?? `${coordinates.latitude},${coordinates.longitude},${index}`),
      title,
      subtitle,
      label,
      coordinates,
    });
  }

  return results;
}

export async function reverseGeocodeLocation(
  coordinates: Coordinates,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const url = `${NOMINATIM_BASE_URL}/reverse?format=jsonv2&lat=${encodeURIComponent(
      String(coordinates.latitude),
    )}&lon=${encodeURIComponent(String(coordinates.longitude))}`;

    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal,
    });
    if (!response.ok) {
      return null;
    }

    const place = (await response.json()) as NominatimPlace;
    const address = place.address;
    if (address) {
      const street = [address.house_number, address.road]
        .filter(Boolean)
        .join(' ')
        .trim();
      const locality =
        address.neighbourhood ||
        address.suburb ||
        address.city ||
        address.town ||
        address.village;
      const parts = [street || place.name, locality].filter(Boolean);
      if (parts.length > 0) {
        return parts.join(', ');
      }
    }

    if (place.display_name) {
      return place.display_name
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .slice(0, 2)
        .join(', ');
    }

    return null;
  } catch {
    return null;
  }
}
