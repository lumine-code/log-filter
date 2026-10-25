const path = require("node:path");

describe("log-filter with no grammar", () => {
  let editor, main;
  beforeEach(async () => {
    await lumine.packages.activatePackage("language-log");
    jasmine.attachToDOM(lumine.workspace.getElement());
    main = (await lumine.packages.activatePackage(path.join(__dirname, ".."))).mainModule;
    editor = await lumine.workspace.open("null-grammar.log");
    editor.setText("INFO first\nERROR second\nINFO third");
  });
  afterEach(async () => {
    editor?.destroy();
    await lumine.packages.deactivatePackage("log-filter");
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
    main.showPanel(editor);
    expect(main.view).not.toBe(view);
  });
});
