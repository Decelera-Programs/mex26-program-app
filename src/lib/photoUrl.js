// Some `photo_url` values come in as Google Drive "share" links
// (drive.google.com/file/d/<id>/view or /open?id=<id>), which render an HTML
// page, not the image bytes — so an <img> pointing at them fails. Rewrite those
// to the hotlink-friendly thumbnail endpoint. Anything else passes through.
export function resolvePhotoUrl(url) {
  if (!url || typeof url !== "string") return null;
  const fileMatch = url.match(/drive\.google\.com\/file\/d\/([\w-]+)/);
  if (fileMatch) return `https://drive.google.com/thumbnail?id=${fileMatch[1]}&sz=w400`;
  const openMatch = url.match(/[?&]id=([\w-]+)/);
  if (openMatch && url.includes("drive.google.com")) {
    return `https://drive.google.com/thumbnail?id=${openMatch[1]}&sz=w400`;
  }
  return url;
}
