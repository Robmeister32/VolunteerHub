export interface GeocodingAddress {
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  region: string;
  postalCode: string;
  countryCode: string;
}

interface GoogleGeocodingResponse {
  status: string;
  error_message?: string;
  results: Array<{
    geometry: {
      location: {
        lat: number;
        lng: number;
      };
    };
  }>;
}

export class GeocodingError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
  }
}

export function formatGeocodingAddress(address: GeocodingAddress) {
  return [
    address.addressLine1,
    address.addressLine2,
    address.city,
    address.region,
    address.postalCode,
    address.countryCode
  ]
    .filter(Boolean)
    .join(", ");
}

export async function geocodeAddress(address: GeocodingAddress) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw new GeocodingError(
      "Latitude and longitude are empty, but GOOGLE_MAPS_API_KEY is not configured on the backend",
      503
    );
  }

  const params = new URLSearchParams({
    address: formatGeocodingAddress(address),
    key: apiKey
  });
  let response: Response;
  try {
    response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`, {
      signal: AbortSignal.timeout(10_000)
    });
  } catch {
    throw new GeocodingError("Google Geocoding API could not be reached", 503);
  }
  if (!response.ok) throw new GeocodingError("Google Geocoding API could not be reached", 503);

  const result = (await response.json()) as GoogleGeocodingResponse;
  if (result.status === "ZERO_RESULTS") {
    throw new GeocodingError("Google could not find coordinates for this campus address", 422);
  }
  if (result.status !== "OK" || !result.results[0]) {
    throw new GeocodingError(result.error_message || `Google Geocoding API returned ${result.status}`, 503);
  }

  return {
    latitude: result.results[0].geometry.location.lat,
    longitude: result.results[0].geometry.location.lng
  };
}
