// Alias of /sitemap.xml under a fresh filename. Search Console can leave a
// sitemap entry stuck on "Sitemap could not be read" (it once saw a 404 here);
// submitting the same content under a new URL is the known way to reset it.
// /sitemap.xml stays canonical in robots.txt and the <link rel="sitemap">.
export { GET } from "./sitemap.xml";

export const prerender = true;
