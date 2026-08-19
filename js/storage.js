const USER_LISTINGS_KEY = 'matcha_location_finder_user_listings';

export function loadUserListings() {
  try {
    const listings = JSON.parse(localStorage.getItem(USER_LISTINGS_KEY) || '[]');
    return Array.isArray(listings) ? listings : [];
  } catch {
    return [];
  }
}

export function saveUserListings(listings) {
  localStorage.setItem(USER_LISTINGS_KEY, JSON.stringify(listings));
}

export function addUserListing(listing) {
  const listings = loadUserListings();
  listings.unshift(listing);
  saveUserListings(listings);
  return listings;
}
