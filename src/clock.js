/** Milliseconds on a monotonic clock. Injected through SourceProvider. */
export const realClock = () => performance.now();
