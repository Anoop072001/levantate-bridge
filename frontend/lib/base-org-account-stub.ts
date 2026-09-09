export function createBaseAccountSDK(_config?: Record<string, unknown>) {
  return {
    getProvider() {
      return {
        request: async () => {
          throw new Error("Base Account is not supported on Arc testnet");
        },
        on() {},
        removeListener() {},
        disconnect() {},
      };
    },
  };
}
