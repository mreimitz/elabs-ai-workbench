import { useMemo, useState } from "react";
import {
  HUB_ICON_MAX_LENGTH,
  hubLucideIconValue,
  parseHubIcon,
} from "@mcp-token-footprint/shared";
import {
  Button,
  type UploadFile,
  FileUpload,
  FileUploadDropzone,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Text,
  cn,
} from "@elabs-ai/components-ui";
import { SearchInput } from "@elabs-ai/components-data";
import { ImagePlus, Trash2 } from "lucide-react";
import { IconButton } from "../../../components/IconButton";
import { HUB_ICON_GROUPS } from "./hub-icon-library";
import { RoleAvatar } from "./RoleAvatar";
import { notifyError } from "../../../lib/notify";

/**
 * Assistant Hub — the agent/crew avatar icon picker (owner request: "real icons for my agents").
 * Three ways to set the shared `icon` field, in the owner's stated priority:
 *   1. pick a curated {@link HUB_ICON_GROUPS} glyph (stored as `lucide:<name>`),
 *   2. upload an image (client-downscaled to a square PNG data-URI, capped by `HUB_ICON_MAX_LENGTH`),
 *   3. clear it → the avatar falls back to the model provider logo, then the `Persona` glyph.
 *
 * Value in/out is the encoded `icon` string ({@link parseHubIcon}); the picker owns no persistence.
 * Composed entirely from `@elabs-ai/components-*` parts (Tabs / FileUpload / Button / SearchInput) + the shared
 * {@link RoleAvatar} for a live preview that exactly matches the rendered avatar.
 */

const UPLOAD_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";
const UPLOAD_MAX_SOURCE_BYTES = 6 * 1024 * 1024; // 6 MB source; downscaled far below the field cap.
const ICON_PX = 128;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Couldn’t read the file."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That file could not be decoded as an image."));
    img.src = src;
  });
}

/** Capture leaves the image full-bleed in the square (no inset) — the geometric inscribing that keeps
 *  a square logo's CORNERS inside the circular avatar is done at RENDER (`RoleAvatar`'s image branch
 *  pads the circle to the inscribed square). Doing it there — not here — means the fix also rescues
 *  images uploaded before this change, with no re-upload, and avoids double-insetting. */
const ICON_INSET = 0;

/** CONTAIN-fit the whole source image into a centered square and rasterize to a small PNG data-URI
 *  (imperative canvas — not markup — so no `@elabs-ai/components-*` component applies). Unlike a cover-crop this keeps
 *  the ENTIRE image (a logo isn't cut off); the canvas stays transparent (no baked background — the
 *  avatar supplies a theme-token backing, so it reads correctly in both themes). Throws on a
 *  canvas-unavailable / decode failure. */
async function fileToContainedIcon(file: File): Promise<string> {
  const source = await readFileAsDataUrl(file);
  const img = await loadImage(source);
  const sw = img.naturalWidth || img.width;
  const sh = img.naturalHeight || img.height;
  if (!sw || !sh) throw new Error("That image has no dimensions.");
  const canvas = document.createElement("canvas");
  canvas.width = ICON_PX;
  canvas.height = ICON_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Image processing is unavailable in this browser.");
  // Scale so the LONGER edge fits the inset box; center the result (letterboxed on the shorter axis).
  const box = ICON_PX * (1 - ICON_INSET * 2);
  const scale = Math.min(box / sw, box / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  const dx = (ICON_PX - dw) / 2;
  const dy = (ICON_PX - dh) / 2;
  ctx.drawImage(img, 0, 0, sw, sh, dx, dy, dw, dh);
  return canvas.toDataURL("image/png");
}

export function IconPicker({
  id,
  value,
  onChange,
  model,
  previewId,
  disabled,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  /** The entity's default model — drives the live "model image" fallback preview. */
  model?: string;
  /** The entity id — seeds the `Persona` fallback so the preview matches the eventual card avatar. */
  previewId: string;
  disabled?: boolean;
}) {
  const parsed = parseHubIcon(value);
  const [tab, setTab] = useState<"library" | "upload">(
    parsed.kind === "image" ? "upload" : "library",
  );
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const needle = query.trim().toLowerCase();
  const filteredGroups = useMemo(() => {
    if (!needle) return HUB_ICON_GROUPS;
    return HUB_ICON_GROUPS.map((group) => ({
      ...group,
      icons: group.icons.filter((entry) => entry.name.includes(needle)),
    })).filter((group) => group.icons.length > 0);
  }, [needle]);

  const activeName = parsed.kind === "lucide" ? parsed.name : undefined;

  const sourceLabel =
    parsed.kind === "image"
      ? "Custom image"
      : parsed.kind === "lucide"
        ? `Icon · ${parsed.name}`
        : "Model image (default)";

  async function handleFiles(files: UploadFile[]): Promise<void> {
    const first = files[0]?.file;
    if (!first) return;
    setBusy(true);
    try {
      const dataUri = await fileToContainedIcon(first);
      if (dataUri.length > HUB_ICON_MAX_LENGTH) {
        notifyError("That image is too detailed to store as an icon — try a simpler one.");
        return;
      }
      onChange(dataUri);
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "Couldn’t process that image.", {
        description: "Try a different file.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 rounded-md border border-border bg-muted/40 px-3 py-2">
        <RoleAvatar id={previewId} icon={value} model={model} className="size-11 shrink-0" />
        <div className="min-w-0 flex-1">
          <Text className="truncate font-medium">{sourceLabel}</Text>
          <Text variant="caption" tone="muted">
            Pick an icon, upload an image, or clear it to use the model image.
          </Text>
        </div>
        {parsed.kind !== "none" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange("")}
            disabled={disabled}
          >
            Use model image
          </Button>
        ) : null}
      </div>

      <Tabs value={tab} onValueChange={(next) => setTab(next as "library" | "upload")}>
        <TabsList>
          <TabsTrigger value="library">Icons</TabsTrigger>
          <TabsTrigger value="upload">Upload</TabsTrigger>
        </TabsList>

        <TabsContent value="library" className="flex flex-col gap-3 pt-2">
          <SearchInput
            id={id}
            value={query}
            onValueChange={setQuery}
            label="Search icons"
            placeholder="Search icons…"
          />
          {filteredGroups.length === 0 ? (
            <Text variant="caption" tone="muted">
              No icons match “{query.trim()}”.
            </Text>
          ) : (
            <div className="flex max-h-72 flex-col gap-3 overflow-y-auto pr-1">
              {filteredGroups.map((group) => (
                <div key={group.label} className="flex flex-col gap-1.5">
                  <Text variant="caption" tone="muted">
                    {group.label}
                  </Text>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))] gap-1.5">
                    {group.icons.map(({ name, Icon }) => {
                      const active = name === activeName;
                      return (
                        <IconButton
                          key={name}
                          type="button"
                          variant={active ? "default" : "outline"}
                          size="icon"
                          aria-pressed={active}
                          label={name}
                          disabled={disabled}
                          onClick={() => onChange(hubLucideIconValue(name))}
                        >
                          <Icon aria-hidden className="size-4" />
                        </IconButton>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="upload" className="flex flex-col gap-3 pt-2">
          <FileUpload
            accept={UPLOAD_ACCEPT}
            multiple={false}
            maxFiles={1}
            maxSize={UPLOAD_MAX_SOURCE_BYTES}
            disabled={disabled || busy}
            onFilesChange={handleFiles}
          >
            <FileUploadDropzone browseLabel="Browse for an image">
              <div className="flex flex-col items-center gap-2 py-2 text-center">
                <ImagePlus aria-hidden className="size-6 text-muted-foreground" />
                <Text className="font-medium">
                  {busy ? "Processing…" : "Drop a PNG, JPG, or SVG here"}
                </Text>
                <Text variant="meta" tone="muted">
                  or use the browse link — it's cropped to a square and stored with the agent.
                </Text>
              </div>
            </FileUploadDropzone>
          </FileUpload>

          {parsed.kind === "image" ? (
            <div className="flex items-center gap-3">
              <RoleAvatar id={previewId} icon={value} className="size-11 shrink-0" />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onChange("")}
                disabled={disabled}
                className="gap-1.5"
              >
                <Trash2 aria-hidden className="size-4" />
                Remove image
              </Button>
            </div>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}
