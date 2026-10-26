/** Recover an image load/error event that finished before React attached handlers. */
export function recoverSettledImage(
  image: Pick<HTMLImageElement, "complete" | "naturalWidth"> | null,
  loaded: () => void,
  failed: () => void,
): void {
  if (!image?.complete) return;
  if (image.naturalWidth > 0) loaded();
  else failed();
}
