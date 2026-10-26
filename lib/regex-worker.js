const port = (typeof require === "function" ? require("node:worker_threads").parentPort : null) || {
  on: (_name, callback) => {
    globalThis.onmessage = ({ data }) => callback(data);
  },
  postMessage: (message) => globalThis.postMessage(message),
};
let expression, previousSource, previousFlags;
port.on("message", ({ source, flags, rows }) => {
  try {
    if (source !== previousSource || flags !== previousFlags) {
      expression = new RegExp(source, flags);
      previousSource = source;
      previousFlags = flags;
    }
    const matches = new Uint8Array(rows.length);
    for (let index = 0; index < rows.length; index++) {
      expression.lastIndex = 0;
      matches[index] = expression.test(rows[index]) ? 1 : 0;
    }
    port.postMessage({ matches });
  } catch (error) {
    port.postMessage({ error: error.message });
  }
});
port.postMessage({ ready: true });
