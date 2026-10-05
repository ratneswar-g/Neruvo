/**
 * Provider-neutral location model.
 * Ready for future Google Maps geocoding / coordinates integration.
 * Does not contain Google-specific implementation details.
 */
export interface Location {
  latitude: number;
  longitude: number;
  address: string;
  landmark?: string;
  accessInstructions?: string;
}
