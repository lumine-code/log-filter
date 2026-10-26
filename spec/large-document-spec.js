const { TextBuffer } = require("lumine");

describe("Log Filter compressed source operations", () => {
  let editor, filter;
  beforeEach(async () => {
    jasmine.useRealClock();
    await lumine.packages.activatePackage("log-filter");
    editor = lumine.workspace.buildTextEditor();
    filter = new (require("../lib/filter"))(editor);
  });
  afterEach(async () => {
    filter?.destroy();
    editor?.destroy();
    await lumine.packages.deactivatePackage("log-filter");
  });

  it("represents a million hidden rows with one interval and one fold", async () => {
    editor.setText("line\n".repeat(1000000));
    await filter.filterText("missing");
    expect(filter.getHiddenCount()).toBe(1000001);
    expect(filter.getHiddenRowRanges()).toEqual([[0, 1000000]]);
    expect(editor.displayLayer.foldsMarkerLayer.getMarkerCount()).toBe(1);
    expect(() => filter.getHiddenRows()).toThrowError(/materialization budget/);
    filter.filterText("");
    expect(filter.getHiddenCount()).toBe(0);
  });

  it("skips the remainder of a giant row after its first literal match", async () => {
    const source = TextBuffer.createTextSnapshot("word".repeat(1024 * 1024));
    let reads = 0;
    const wrapped = {
      length: source.length,
      lineCount: source.lineCount,
      lineStart: source.lineStart.bind(source),
      positionAt: source.positionAt.bind(source),
      charCodeAt: source.charCodeAt.bind(source),
      slice(start, end) {
        reads++;
        expect(end - start).toBeLessThan(65536);
        return source.slice(start, end);
      },
    };
    const visible = await require("../lib/text-matches").literalRows(
      wrapped,
      /word/i,
      "word",
      0,
      () => {},
    );
    expect(visible.ranges).toEqual([[0, 0]]);
    expect(reads).toBe(1);
  });

  it("preserves native literal matching across CRLF, lone CR, Unicode and window boundaries", async () => {
    const lines = ["K I İ i Σ σ ς", "😀[literal]", "a\rb", "last\r"];
    const text = lines.slice(0, -1).join("\r\n") + "\r\n" + lines.at(-1);
    editor.setText(text);
    for (const query of ["k", "i", "σ", "😀", "[", "\r", "\n", "a\rb"]) {
      await filter.filterText(query);
      const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      expect(filter.getHiddenRows())
        .withContext(query)
        .toEqual(lines.flatMap((line, row) => (expression.test(line) ? [] : [row])));
    }
    editor.setText("x".repeat(32767) + "MATCH\nother");
    await filter.filterText("MATCH");
    expect(filter.getHiddenRows()).toEqual([1]);
  });

  it("tests regexes against complete individual rows with native anchors and lookaround", async () => {
    const lines = ["a", "ab", "ba", "", "a\r", "a\u2028", "b"];
    editor.setText(lines.join("\n"));
    const actualLines = [...editor.getBuffer().getTextSnapshot().lines()];
    filter.setRegexEnabled(true);
    for (const pattern of ["^a$", "(?<=a)b", "a(?=$)", "^$", "a\\nb", "\\r", ".", "\\s"]) {
      await filter.filterText(pattern);
      const expression = new RegExp(pattern, "i");
      expect(filter.getHiddenRows())
        .withContext(pattern)
        .toEqual(actualLines.flatMap((line, row) => (expression.test(line) ? [] : [row])));
    }
  });

  it("rejects giant regex rows before reading them while literal filtering remains available", async () => {
    editor.setText("x".repeat(1024 * 1024 + 1));
    filter.setRegexEnabled(true);
    expect(await filter.filterText("x")).toBeFalse();
    expect(filter.status).toContain("regular-expression input budget");
    expect(filter.getHiddenCount()).toBe(0);
    filter.setRegexEnabled(false);
    await filter.filterText("x");
    expect(filter.status).toBeNull();
    expect(filter.getHiddenCount()).toBe(0);
  });

  it("bounds excessive fold fragmentation without applying a partial filter", async () => {
    editor.setText("show\nhide\n".repeat(10001));
    expect(await filter.filterText("show")).toBeFalse();
    expect(filter.status).toContain("10000");
    expect(filter.getHiddenCount()).toBe(0);
    expect(editor.displayLayer.foldsMarkerLayer.getMarkerCount()).toBe(0);
  });

  it("terminates catastrophic regex work without blocking the UI or retaining stale rows", async () => {
    editor.setText("a".repeat(500) + "!");
    filter.setRegexEnabled(true);
    let responsive = false;
    const timer = setTimeout(() => (responsive = true), 25);
    try {
      expect(await filter.filterText("^(a+)+$")).toBeFalse();
      expect(responsive).toBeTrue();
      expect(filter.status).toContain("one-second");
      expect(filter.getHiddenCount()).toBe(0);
      await filter.filterText("!");
      expect(filter.status).toBeNull();
      expect(filter.work.size).toBe(0);
    } finally {
      clearTimeout(timer);
    }
  });

  it("cancels sparse work when a newer query or revision takes ownership", async () => {
    editor.setText("x".repeat(4 * 1024 * 1024));
    const older = filter.filterText("missing");
    const newer = filter.filterText("x");
    await Promise.all([older, newer]);
    expect(filter.getHiddenCount()).toBe(0);
    const pending = filter.filterText("missing");
    editor.getBuffer().append("changed");
    await pending;
    expect(filter.getHiddenCount()).toBe(0);
    expect(filter.work.size).toBe(0);
  });

  it("retires a regex worker before readiness without publishing late results", async () => {
    editor.setText("one\ntwo");
    await jasmine.spyOnGlobalErrorsAsync(async (errors) => {
      filter.setRegexEnabled(true);
      const pending = filter.filterText("one");
      filter.setRegexEnabled(false);
      await filter.filterText("two");
      await pending;
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(filter.getHiddenRows()).toEqual([0]);
      expect(filter.work.size).toBe(0);
      expect(errors).not.toHaveBeenCalled();
    });
  });

  it("cleans worker startup resources when the platform rejects construction", async () => {
    const RegexWorker = require("../lib/regex-worker-client");
    const controller = new AbortController();
    const remove = spyOn(controller.signal, "removeEventListener").and.callThrough();
    const revoke = spyOn(URL, "revokeObjectURL").and.callThrough();
    spyOn(globalThis, "Worker").and.throwError("worker unavailable");
    const worker = new RegexWorker(controller.signal);
    await expectAsync(worker.request({ rows: ["x"] })).toBeRejectedWithError("worker unavailable");
    expect(remove).toHaveBeenCalledWith("abort", worker.abort);
    expect(revoke).toHaveBeenCalledWith(worker.url);
    expect(worker.disposed).toBeTrue();
  });

  it("finds distant bounded timestamp tokens without whole-row reads", async () => {
    editor.setText("x".repeat(1024 * 1024) + " 2026-01-02T03:04:05Z");
    spyOn(editor, "lineTextForBufferRow").and.throwError("whole row");
    spyOn(editor, "getTextInBufferRange").and.throwError("scope source read");
    spyOn(editor, "bufferRangeForScopeAtPosition").and.returnValue(editor.getBuffer().getRange());
    const rows = await require("../lib/timestamp-candidates")(editor, [0]);
    expect(rows).toEqual([["2026-01-02T03:04:05Z"]]);
  });

  it("guards oversized query metadata before reading or saving a draft", async () => {
    const View = require("../lib/view");
    const view = Object.create(View.prototype);
    view.filterBuffer = {
      getLength: () => 600000000,
      getText: jasmine.createSpy("read query").and.throwError("giant query"),
    };
    view.filter = { filterText: jasmine.createSpy("clear old query") };
    view.store = { set: jasmine.createSpy("save query") };
    await view.saveState();
    expect(view.filterBuffer.getText).not.toHaveBeenCalled();
    expect(view.store.set).not.toHaveBeenCalled();
    expect(view.filter.filterText).toHaveBeenCalledWith("");
  });
});
