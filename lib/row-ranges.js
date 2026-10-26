const MAX_RANGES = 10000;

class RowRanges {
  constructor() {
    this.ranges = [];
    this.length = 0;
  }
  add(start, end = start) {
    if (end < start) return;
    const last = this.ranges.at(-1);
    if (last && start <= last[1] + 1) {
      if (end > last[1]) {
        this.length += end - last[1];
        last[1] = end;
      }
    } else {
      if (this.ranges.length === MAX_RANGES)
        throw Object.assign(
          new Error(
            "The filter needs more than 10000 separate fold regions. Narrow the filter or increase adjacent visible lines.",
          ),
          { code: "ERR_LOG_FILTER_REGIONS" },
        );
      this.ranges.push([start, end]);
      this.length += end - start + 1;
    }
  }
  union(other) {
    const result = new RowRanges();
    let left = 0,
      right = 0;
    while (left < this.ranges.length || right < other.ranges.length) {
      const a = this.ranges[left],
        b = other.ranges[right];
      const range = !b || (a && a[0] <= b[0]) ? this.ranges[left++] : other.ranges[right++];
      result.add(...range);
    }
    return result;
  }
  complement(lineCount) {
    const result = new RowRanges();
    let start = 0;
    for (const [left, right] of this.ranges) {
      result.add(start, left - 1);
      start = right + 1;
    }
    result.add(start, lineCount - 1);
    return result;
  }
  toArray(limit = 100000) {
    if (this.length > limit)
      throw new RangeError(
        "Hidden rows exceed the materialization budget. Use getHiddenRowRanges() or getHiddenCount().",
      );
    const result = [];
    for (const [start, end] of this.ranges)
      for (let row = start; row <= end; row++) result.push(row);
    return result;
  }
}

module.exports = RowRanges;
