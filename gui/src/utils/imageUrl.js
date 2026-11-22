// Provider image URLs must go through the app's own /api/image proxy:
// the renderer is a different origin than the provider CDN and many CDNs
// answer direct renderer requests with 403, while the backend fetch (which
// carries the extension's Referer/UA headers) succeeds.
export const getProxiedImageUrl = (url, item) => {
  if (!url) return "/images/image-404.png";
  if (
    url.startsWith("/api/image") ||
    url.startsWith("data:") ||
    url.startsWith("file://") ||
    url.startsWith("/images/")
  ) {
    return url;
  }
  let query = `url=${encodeURIComponent(url)}`;
  const malid = item?.malid || item?.MalID || item?.id;
  if (malid && !isNaN(parseInt(malid, 10))) {
    query += `&malid=${malid}`;
  }
  if (item?.title) {
    query += `&title=${encodeURIComponent(item.title)}`;
  }
  return `/api/image?${query}`;
};
