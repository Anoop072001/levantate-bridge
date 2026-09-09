/** Serialize Arc RPC reads so list pages do not burst N parallel eth_calls. */
let chain: Promise<unknown> = Promise.resolve();

export function withRpcQueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(() => fn());
  chain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}
