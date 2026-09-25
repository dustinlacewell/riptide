/** True for the rejection an aborted request produces. */
export function isAbort(err) {
  return err?.name === "AbortError";
}
