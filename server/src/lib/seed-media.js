// The seed images named in server/seed/shows.json (imageFile) and server/seed/media.json
// (artworkFile). They are third-party artwork, so they are NOT in the repository: `npm run
// fetch-media` downloads them from their original sources (imageSourceUrl / artworkUrl) into
// server/media/shows/ and server/media/art/. The import stores their /media/… paths whether or
// not the files are there yet (the website falls back to a gradient when an image 404s).

/** A plain file name with an image extension — no folders, no dot files. */
export const SEED_IMAGE_NAME_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*\.(jpe?g|png|webp|gif)$/i;

/** @param {unknown} name */
export const isSeedImageName = (name) => typeof name === 'string' && name.length <= 200 && SEED_IMAGE_NAME_RE.test(name);

/**
 * The image type a seed file name promises ('jpg' | 'png' | 'webp' | 'gif'), as sniffImage() names it.
 * @param {string} name
 */
export function seedImageKind(name) {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return ext === 'jpeg' ? 'jpg' : ext;
}

export const MISSING_IMAGES_HINT = 'run `npm run fetch-media` to download them (the website shows gradient placeholders until then)';
