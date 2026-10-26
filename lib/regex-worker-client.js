const { Worker } = require("node:worker_threads");

module.exports = class RegexWorker {
  constructor(signal) {
    this.signal = signal;
    this.ready = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    // Readiness can be cancelled before request() reaches its await.
    this.ready.catch(() => {});
    this.abort = () =>
      this.fail(Object.assign(new Error("Log filtering cancelled"), { name: "AbortError" }));
    signal?.addEventListener("abort", this.abort, { once: true });
    if (signal?.aborted) {
      this.abort();
      return;
    }
    try {
      // eslint-disable-next-line n/no-unsupported-features/node-builtins -- Chromium Worker in Electron.
      if (process.type === "renderer" && typeof globalThis.Worker === "function") {
        const source = require("node:fs").readFileSync(require.resolve("./regex-worker"), "utf8");
        this.url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
        // eslint-disable-next-line n/no-unsupported-features/node-builtins -- Chromium Worker in Electron.
        this.worker = new globalThis.Worker(this.url);
        this.worker.onmessage = ({ data }) => this.receive(data);
        this.worker.onerror = (event) => {
          event.preventDefault();
          this.fail(new Error(event.message));
        };
      } else {
        this.worker = new Worker(require.resolve("./regex-worker"));
        this.worker.on("message", (data) => this.receive(data));
        this.worker.on("error", (error) => this.fail(error));
        this.worker.on("exit", () => {
          if (!this.disposed) this.fail(new Error("Log regex worker exited"));
        });
        this.worker.unref();
      }
      this.startupTimer = setTimeout(
        () => this.fail(new Error("Log regex worker did not become ready")),
        10000,
      );
    } catch (error) {
      this.fail(error);
    }
  }
  receive(data) {
    if (this.disposed) return;
    if (data.ready) {
      clearTimeout(this.startupTimer);
      this.readyResolve?.();
      this.readyResolve = this.readyReject = null;
      return;
    }
    if (!this.pending) return;
    const { resolve, reject, timer } = this.pending;
    this.pending = null;
    clearTimeout(timer);
    if (data.error) reject(new Error(data.error));
    else resolve(data.matches);
  }
  async request(data) {
    await this.ready;
    this.signal?.throwIfAborted();
    if (this.disposed) throw new Error("Log regex worker was disposed");
    if (this.pending) throw new Error("Log regex worker already has a request");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          this.fail(
            new Error(
              "The filter expression exceeded its one-second execution budget. Simplify it.",
            ),
          ),
        1000,
      );
      this.pending = { resolve, reject, timer };
      try {
        this.worker.postMessage(data);
      } catch (error) {
        this.fail(error);
      }
    });
  }
  fail(error) {
    this.readyReject?.(error);
    this.readyResolve = this.readyReject = null;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(error);
      this.pending = null;
    }
    this.dispose();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const cancelled = Object.assign(new Error("Log filtering cancelled"), { name: "AbortError" });
    this.readyReject?.(cancelled);
    this.readyResolve = this.readyReject = null;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(cancelled);
      this.pending = null;
    }
    clearTimeout(this.startupTimer);
    this.signal?.removeEventListener("abort", this.abort);
    this.worker?.terminate();
    if (this.url) URL.revokeObjectURL(this.url);
  }
};
