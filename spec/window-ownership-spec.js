describe("Log Filter window ownership", () => {
  // Processing fixtures use a real grammar; None deliberately disables this package.
  beforeEach(async () => {
    await lumine.packages.activatePackage("language-text");
  });

  let main, first, second, extra;
  beforeEach(async () => {
    jasmine.useRealClock();
    jasmine.attachToDOM(lumine.workspace.getElement());
    main = (await lumine.packages.activatePackage("log-filter")).mainModule;
    first = await lumine.workspace.open();
    extra = await lumine.workspace.openEditorWindow({ show: false });
    second = lumine.workspace.buildTextEditor();
    extra.getEditorContainer().getActivePane().activateItem(second);
  });
  afterEach(async () => {
    await lumine.packages.deactivatePackage("log-filter");
    await lumine.workspace.discardEditorWindows();
    first.destroy();
    second.destroy();
  });
  it("opens independent controls in the document that received the command", async () => {
    await lumine.commands.dispatch(first.element, "log-filter:toggle");
    const mainPanel = main.panel;
    await lumine.commands.dispatch(second.element, "log-filter:toggle");
    const record = main.records.get(extra);
    expect(record.view.textEditor).toBe(second);
    expect(record.view.getElement().ownerDocument).toBe(extra.getDocument());
    expect(record.view.filterEditorElement.ownerDocument).toBe(extra.getDocument());
    expect(main.panel).toBe(mainPanel);
    expect(main.view.textEditor).toBe(first);
    await lumine.commands.dispatch(second.element, "log-filter:toggle");
    expect(record.panel).toBeNull();
    expect(main.panel).toBe(mainPanel);
  });
});
