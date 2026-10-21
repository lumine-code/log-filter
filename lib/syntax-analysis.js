exports.levels = async function (context, { scopes }, { signal, emit }) {
  const selected = new Set(scopes);
  let previous = -1,
    count = 0,
    visited = 0;
  const packet = [];
  for (const { range, scopes: names } of context.scopeRanges([
    [0, 0],
    [Infinity, Infinity],
  ])) {
    signal.throwIfAborted();
    if (names.some((scope) => selected.has(scope))) {
      for (let row = Math.max(range.start.row, previous + 1); row <= range.end.row; row++) {
        const length = context.buffer.lineLengthForRow(row);
        const start = row === range.start.row ? range.start.column : 0;
        const end = row === range.end.row ? Math.min(length, range.end.column) : length;
        if (end <= start) continue;
        packet.push(row);
        previous = row;
        count++;
        if (packet.length === 256) {
          const rows = Uint32Array.from(packet);
          await emit(rows, [rows.buffer]);
          packet.length = 0;
        }
      }
    }
    if (++visited % 256 === 0) await new Promise((resolve) => setImmediate(resolve));
  }
  if (packet.length) {
    const rows = Uint32Array.from(packet);
    await emit(rows, [rows.buffer]);
  }
  return { count };
};

exports.timestamps = function (context, { rows }) {
  return rows.map((row) => {
    if (row < 0) return [];
    const candidates = [];
    for (let column = 0; column <= 30; column += 10) {
      const range = context.bufferRangeForScopeAtPosition(
        "timestamp",
        new context.Point(row, column),
      );
      if (range) candidates.push(context.getTextInBufferRange(range));
    }
    const candidate = context
      .lineTextForBufferRow(row)
      ?.match(
        /(?:\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}|\b\d{6}[-\s]\d{6}(?:\.\d+)?)/i,
      );
    if (candidate) candidates.push(candidate[0]);
    return candidates;
  });
};
