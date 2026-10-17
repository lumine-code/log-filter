const { CompositeDisposable } = require("lumine");

let FilterView = null;

const LogFilter = {
  provideBackgroundTips() {
    return {
      packageName: "log-filter",
      tips: [
        "{% if keys['log-filter:toggle'] %}You can fold away every line of a log that does not match your filter with {{ 'log-filter:toggle' | keystroke }}{% else %}You can fold away every line of a log that does not match your filter.{% endif %}",
      ],
    };
  },

  activate(context) {
    this.workspaceState = context.workspaceState;
    this.disposables = new CompositeDisposable();
    this.grammarSubscription = null;
    this.panel = null;
    this.view = null;
    this.records = new Map();

    // Live per-editor state, so the filter query survives switching between
    // editors within a session; `persistedStates` keys the same state by file
    // path so it also survives a restart.
    this.states = new WeakMap();
    this.persistedStates = this.workspaceState.get("filters", {});
    let writeOwner = { pending: new Map() };

    const applyStoredState = (editor, { force = false } = {}) => {
      const filePath = editor.getPath();
      const stored = filePath ? this.persistedStates[filePath] : null;
      if (!force && JSON.stringify(this.states.get(editor)) === JSON.stringify(stored)) return;
      this.states.delete(editor);
      for (const record of this.records.values()) {
        if (record.view?.textEditor === editor) record.view.restoreState(stored ?? {});
      }
    };

    this.store = {
      get: (editor) => {
        const live = this.states.get(editor);
        if (live) return live;
        const filePath = editor.getPath();
        return filePath ? this.persistedStates[filePath] : null;
      },
      set: (editor, value) => {
        this.states.set(editor, value);
        const filePath = editor.getPath();
        if (!filePath) return Promise.resolve();
        const owner = writeOwner;
        owner.pending.set(filePath, (owner.pending.get(filePath) ?? 0) + 1);
        return this.workspaceState
          .mutate("filters", (records) => ({ ...records, [filePath]: value }))
          .catch((error) =>
            lumine.notifications.addError("Unable to save log filters", {
              detail: error.message,
              dismissable: true,
            }),
          )
          .finally(() => {
            const pending = owner.pending.get(filePath) - 1;
            if (pending) owner.pending.set(filePath, pending);
            else owner.pending.delete(filePath);
            if (owner === writeOwner && !pending && !this.disposables.disposed)
              applyStoredState(editor);
          });
      },
    };

    this.disposables.add(
      this.workspaceState.observe("filters", (filters, { scopeChanged }) => {
        const previous = this.persistedStates;
        this.persistedStates = filters ?? {};
        if (scopeChanged) {
          writeOwner = { pending: new Map() };
          this.states = new WeakMap();
        }
        for (const record of this.records.values()) {
          const editor = record.view?.textEditor;
          if (!editor) continue;
          const filePath = editor.getPath();
          if (scopeChanged) applyStoredState(editor, { force: true });
          else if (
            filePath &&
            !writeOwner.pending.has(filePath) &&
            JSON.stringify(previous[filePath]) !== JSON.stringify(this.persistedStates[filePath])
          )
            applyStoredState(editor);
        }
      }),
      lumine.workspace.observeWindows((window) => {
        const record = this.recordFor(window);
        const subscriptions = new CompositeDisposable(
          window
            .getEditorContainer()
            .observeActivePaneItem((item) => this.observeItem(item, window)),
          window.onWillDestroy(() => {
            this.closePanel(window);
            record.grammarSubscription?.dispose();
            this.records.delete(window);
            subscriptions.dispose();
            this.disposables.remove(subscriptions);
          }),
        );
        this.disposables.add(subscriptions);
      }),
      lumine.commands.add("lumine-workspace", {
        "log-filter:toggle": {
          isAvailable: (event) =>
            Boolean(this.records.get(event.context?.window)?.panel || this.editorForEvent(event)),
          didDispatch: (event) => this.toggle(event),
        },
        "log-filter:toggle-focus": {
          isAvailable: (event) =>
            Boolean(this.records.get(event.context?.window)?.panel || this.editorForEvent(event)),
          didDispatch: (event) => this.toggleFocus(event),
        },
      }),
      lumine.config.onDidChange("log-filter.autoShow", () => {
        this.refreshWindows();
      }),
      lumine.config.onDidChange("log-filter.grammarScopes", () => {
        this.refreshWindows();
      }),
    );
  },

  deactivate() {
    this.disposables?.dispose();
    for (const record of this.records?.values() ?? []) {
      record.grammarSubscription?.dispose();
      this.closePanel(record.window);
    }
    this.records?.clear();
    this.grammarSubscription = null;
  },

  isLogEditor(editor) {
    const scopes = lumine.config.get("log-filter.grammarScopes") ?? [];
    return scopes.includes(editor.getGrammar()?.scopeName);
  },

  recordFor(window = lumine.workspace.getMainWindow()) {
    let record = this.records.get(window);
    if (!record) {
      record = { window, view: null, panel: null, grammarSubscription: null };
      this.records.set(window, record);
    }
    return record;
  },

  syncMain(record) {
    if (record.window.isMain()) {
      this.view = record.view;
      this.panel = record.panel;
      this.grammarSubscription = record.grammarSubscription;
    }
  },

  refreshWindows() {
    for (const record of this.records.values())
      this.observeItem(record.window.getEditorContainer().getActivePaneItem(), record.window);
  },

  observeItem(item, window = lumine.workspace.getMainWindow()) {
    const record = this.recordFor(window);
    record.grammarSubscription?.dispose();
    record.grammarSubscription = null;

    if (!lumine.workspace.isTextEditor(item)) {
      this.hidePanel(window);
      this.syncMain(record);
      return;
    }

    record.grammarSubscription = item.observeGrammar(() => {
      if (this.isLogEditor(item) && lumine.config.get("log-filter.autoShow")) {
        this.showPanel(item, window);
      } else {
        this.hidePanel(window);
      }
    });
    this.syncMain(record);
  },

  showPanel(
    editor,
    window = lumine.workspace.getWindowForElement(editor.getElement()) ??
      lumine.workspace.getMainWindow(),
  ) {
    const record = this.recordFor(window);
    if (record.view != null && record.view.textEditor !== editor) {
      this.closePanel(window);
    }

    if (record.view == null) {
      FilterView ??= require("./view");
      record.view = new FilterView(editor, this.store, window);
      record.view.onDidRequestClose(() => this.closePanel(window));
    }

    if (record.panel == null) {
      const addPanel = window.isMain()
        ? lumine.workspace.addBottomPanel.bind(lumine.workspace)
        : window.addFooterPanel.bind(window);
      record.panel = addPanel({
        item: record.view.getElement(),
        className: "log-filter-panel",
      });
    }
    this.syncMain(record);
    lumine.commands.invalidateAvailability();
  },

  // Hides the panel but keeps the view, so returning to the same editor brings
  // its filter back without recomputing it.
  hidePanel(window = lumine.workspace.getMainWindow()) {
    const record = this.records.get(window);
    if (!record) return;
    record.panel?.destroy();
    record.panel = null;
    this.syncMain(record);
    lumine.commands.invalidateAvailability();
  },

  // Closes for good: the view is destroyed and its folds are removed, leaving
  // the buffer as it was before filtering.
  closePanel(window = lumine.workspace.getMainWindow()) {
    const record = this.records.get(window);
    if (!record) return;
    this.hidePanel(window);
    record.view?.destroy();
    record.view = null;
    this.syncMain(record);
  },

  editorForEvent(event) {
    const direct = lumine.workspace.getTextEditorForElement(event?.target, { includeMini: false });
    if (direct) return direct;
    const context = event?.context;
    if (context)
      return (
        context.embeddedEditor ??
        context.editor ??
        context.window?.getEditorContainer?.()?.getActiveEmbeddedTextEditor?.() ??
        null
      );
    return (
      lumine.workspace.getActiveEmbeddedTextEditor() ??
      lumine.workspace.getActiveTextEditor() ??
      null
    );
  },

  toggle(event) {
    const window = event?.context?.window ?? lumine.workspace.getMainWindow();
    if (this.records.get(window)?.panel != null) {
      return this.closePanel(window);
    }

    const editor = this.editorForEvent(event);
    if (editor) this.showPanel(editor);
  },

  toggleFocus(event) {
    const window = event?.context?.window ?? lumine.workspace.getMainWindow();
    const record = this.records.get(window);
    if (record?.panel) return record.view.toggleFocus();
    const editor = this.editorForEvent(event);
    if (!editor) return;

    this.showPanel(editor);
    return this.records.get(window)?.view.toggleFocus();
  },
};

module.exports = LogFilter;
