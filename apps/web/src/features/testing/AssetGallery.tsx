import { Gallery, ToolResultCard, type GalleryImage } from "@brand/ai";

/**
 * Render the managed image assets a tool returned (UI §D2) as a `@brand/ai` `ToolResultCard` whose
 * produced artifact (its `children`) is the `@brand/ai` `Gallery`: a responsive grid for multiple
 * assets (with a "+N more" overflow tile) or a standalone tile for one, each expandable into a
 * Dialog lightbox (a swipeable Carousel) with a metadata panel. Gallery reserves each tile's box
 * with `AspectRatio` and shows a `Skeleton` until the image loads (no layout shift).
 *
 * The image bytes live behind the MCP server's base URL + auth, so the browser loads them through
 * the API proxy: `/api/servers/:serverId/assets/file?path=<encoded>`. A non-proxiable asset (no
 * `serverId`, or the proxy 404s) degrades to Gallery's built-in token-styled fallback box rather
 * than a broken-image glyph — the path stays visible in the lightbox metadata panel.
 *
 * Download is disabled (`hideDownload`): these are remote, auth'd MCP-server assets and the app has
 * no client-side download path (report/asset export is server-driven; see CLAUDE.md §6).
 *
 * The Gallery is the `ToolResultCard` `children` (per the component contract: "The produced
 * artifact IS the headline; pass it as children"), not its `details` slot — `details` is reserved
 * for the collapsed technical JSON, which stays on the sibling `ToolCallCard`/`ToolDetails`.
 */
export function AssetGallery({ serverId, paths }: { serverId?: string; paths: string[] }) {
  if (paths.length === 0) return null;

  const images: GalleryImage[] = paths.map((path) => {
    const name = basename(path);
    return {
      // `serverId || "_"` keeps a non-empty src (an empty src would hang on the Skeleton); a missing
      // server yields a 404 URL that trips Gallery's onError → token-styled fallback box.
      src: assetSrc(serverId || "_", path),
      alt: name,
      title: name,
      meta: [{ label: "Path", value: path }],
    };
  });

  return (
    <ToolResultCard
      title={`Found ${paths.length} asset${paths.length === 1 ? "" : "s"}`}
      summary="Returned by the asset tools"
      status="complete"
    >
      <Gallery
        images={images}
        aspectRatio={1}
        hideDownload
        // Gallery's root Card is block-level and would otherwise fill the full chat-card width
        // (a single image → a huge full-width square). Cap it so it reads as a normal response-card
        // thumbnail: ~12rem for one asset, a contained grid for many (mirrors the old tile sizing).
        className={paths.length === 1 ? "max-w-[12rem]" : "max-w-md"}
      />
    </ToolResultCard>
  );
}

/** The API proxy URL the browser loads the asset bytes from. */
function assetSrc(serverId: string, path: string): string {
  return `/api/servers/${encodeURIComponent(serverId)}/assets/file?path=${encodeURIComponent(path)}`;
}

/** Basename of a `/`-separated asset path (the label shown on the tile + lightbox). */
function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}
