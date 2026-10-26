exports.levels = async function (context, { scopes }, { signal, emit }) {
  const RowRanges = require("./row-ranges");
  const rows = new RowRanges(),
    selected = new Set(scopes);
  let previous = -1,
    visited = 0;
  for (const { range, scopes: names } of context.scopeRanges([
    [0, 0],
    [Infinity, Infinity],
  ])) {
    signal.throwIfAborted();
    if (names.some((scope) => selected.has(scope))) {
      for (let row = Math.max(range.start.row, previous + 1); row <= range.end.row; row++) {
        signal.throwIfAborted();
        const length = context.buffer.lineLengthForRow(row);
        const start = row === range.start.row ? range.start.column : 0;
        const end = row === range.end.row ? Math.min(length, range.end.column) : length;
        if (end > start) {
          rows.add(row);
          previous = row;
        }
        if (++visited % 256 === 0) await new Promise((resolve) => setImmediate(resolve));
      }
    }
    if (++visited % 256 === 0) await new Promise((resolve) => setImmediate(resolve));
  }
  for (let offset = 0; offset < rows.ranges.length; offset += 256) {
    signal.throwIfAborted();
    await emit(rows.ranges.slice(offset, offset + 256));
  }
  return { count: rows.length };
};
exports.timestamps = (context, { rows }, { signal }) =>
  require("./timestamp-candidates")(context, rows, { signal });
