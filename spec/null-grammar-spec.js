const path = require("node:path");

describe("log-filter with no grammar", () => {
  let editor, main, execution;
  beforeEach(async () => {
    execution = lumine.grammars.syntaxExecution;
    lumine.grammars.syntaxExecution = "worker";
    const language = await lumine.packages.activatePackage("language-log");
    await language.resourceLoadPromise;
    lumine.config.set("log-filter.autoShow", false);
    jasmine.attachToDOM(lumine.workspace.getElement());
    main = (await lumine.packages.activatePackage(path.join(__dirname, ".."))).mainModule;
    editor = await lumine.workspace.open("null-grammar.log");
    editor.setText("INFO first\nERROR second\nINFO third");
  });
  afterEach(async () => {
    editor?.destroy();
    await lumine.packages.deactivatePackage("log-filter");
    lumine.grammars.syntaxExecution = execution;
  });

  it("removes folds and the view, then permits the log grammar to resume", () => {
    const grammar = editor.getGrammar();
    main.showPanel(editor);
    const view = main.view;
    view.filter.filterText("second");
    expect(view.filter.getHiddenCount()).toBeGreaterThan(0);
    editor.setGrammar(lumine.grammars.nullGrammar);
    expect(main.view).toBeNull();
    expect(view.filter.destroyed).toBe(true);
    expect(view.filter.foldIds?.length ?? 0).toBe(0);
    main.showPanel(editor);
    expect(main.view).toBeNull();
    editor.setGrammar(grammar);
    expect(main.view).not.toBe(view);
    expect(main.view.textEditor).toBe(editor);
  });

  it("restores the manual query while obsolete severity work remains unresolved", async () => {
    const grammar = editor.getGrammar();
    await editor.whenGrammarSettled();
    main.showPanel(editor);
    const view = main.view;
    view.filterBuffer.setText("second");
    view.confirm();
    const analyze = editor.analyzeSyntax.bind(editor);
    let release, oldOptions;
    spyOn(editor, "analyzeSyntax").and.callFake((processor, method, args, options) => {
      if (method !== "levels" || release) return analyze(processor, method, args, options);
      oldOptions = options;
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const pending = view.toggleLevel("info");
    editor.setGrammar(lumine.grammars.nullGrammar);
    expect(oldOptions.signal.aborted).toBe(true);
    expect(view.filter.destroyed).toBe(true);
    expect(main.view).toBeNull();
    expect(editor.getScreenLineCount()).toBe(3);
    editor.getBuffer().append("\nINFO late");
    expect(() => main.toggleFocus({ target: editor.element })).not.toThrow();
    editor.setGrammar(grammar);
    const resumed = main.view;
    expect(resumed).toBeTruthy();
    expect(resumed).not.toBe(view);
    expect(resumed.filterBuffer.getText()).toBe("second");
    await conditionPromise(() => resumed.filter.hiddenRows.levels.length === 3);
    expect(resumed.filter.hiddenRows.text.toArray()).toEqual([0, 2, 3]);
    oldOptions.onChunk([[1, 1]]);
    release({ count: 1 });
    await pending;
    expect(main.view).toBe(resumed);
    expect(resumed.filter.hiddenRows.levels.toArray()).toEqual([0, 2, 3]);
    main.closePanel();
    editor.setGrammar(lumine.grammars.nullGrammar);
    editor.setGrammar(grammar);
    expect(main.view).toBeNull();
  });

  it("releases paused-editor intent when that editor closes", () => {
    main.showPanel(editor);
    const record = main.recordFor();
    editor.setGrammar(lumine.grammars.nullGrammar);
    expect(record.resumeEditor).toBe(editor);
    const subscription = record.resumeSubscription;
    editor.destroy();
    expect(record.resumeEditor).toBeNull();
    expect(record.resumeSubscription).toBeNull();
    expect(subscription.disposed).toBe(true);
  });
});
