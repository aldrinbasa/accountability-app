/**
 * The service worker's check-in photo cache (Story 3.4): keyed by object path without the token,
 * at most 150 photos. The page deletes it when the session ends, so another account on the device
 * can never read the photos offline.
 */
export const PHOTO_CACHE_NAME = 'proofy-photos'
export const PHOTO_CACHE_MAX_ENTRIES = 150
