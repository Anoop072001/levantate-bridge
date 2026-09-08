type Job<T> = () => Promise<T>;

export class WalletQueue {
  private tail: Promise<void> = Promise.resolve();

  enqueue<T>(job: Job<T>): Promise<T> {
    const run = this.tail.then(job);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

const queues = new Map<string, WalletQueue>();

export function getWalletQueue(walletId: string): WalletQueue {
  let queue = queues.get(walletId);
  if (!queue) {
    queue = new WalletQueue();
    queues.set(walletId, queue);
  }
  return queue;
}
