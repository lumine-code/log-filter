const { CompositeDisposable } = require("atom");

let FilterView = null;

const LogFilter = {
  activate(state) {
    this.disposables = new CompositeDisposable();
    this.grammarSubscription = null;
    this.panel = null;
    this.view = null;

    // Live per-editor state, so the filter query survives switching between
    // editors within a session; `persistedStates` keys the same state by file
    // path so it also survives a restart.
    this.states = new WeakMap();
    this.persistedStates = state?.persistedStates ?? {};

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
        if (filePath) this.persistedStates[filePath] = value;
      },
    };

    this.disposables.add(
      atom.workspace.observeActivePaneItem((item) => this.observeItem(item)),
      atom.commands.add("atom-workspace", {
        "log-filter:toggle": () => this.toggle(),
        "log-filter:toggle-focus": () => this.toggleFocus(),
      }),
      atom.config.onDidChange("log-filter.autoShow", () => {
        this.observeItem(atom.workspace.getActivePaneItem());
      }),
      atom.config.onDidChange("log-filter.grammarScopes", () => {
        this.observeItem(atom.workspace.getActivePaneItem());
      }),
    );
  },

  deactivate() {
    this.disposables.dispose();
    this.grammarSubscription?.dispose();
    this.grammarSubscription = null;
    this.closePanel();
  },

  serialize() {
    return { persistedStates: this.persistedStates };
  },

  isLogEditor(editor) {
    const scopes = atom.config.get("log-filter.grammarScopes");
    return scopes.includes(editor.getGrammar().scopeName);
  },

  observeItem(item) {
    this.grammarSubscription?.dispose();
    this.grammarSubscription = null;

    if (!atom.workspace.isTextEditor(item)) {
      this.hidePanel();
      return;
    }

    this.grammarSubscription = item.observeGrammar(() => {
      if (this.isLogEditor(item) && atom.config.get("log-filter.autoShow")) {
        this.showPanel(item);
      } else {
        this.hidePanel();
      }
    });
  },

  showPanel(editor) {
    if (this.view != null && this.view.textEditor !== editor) {
      this.closePanel();
    }

    if (this.view == null) {
      FilterView ??= require("./view");
      this.view = new FilterView(editor, this.store);
      this.view.onDidRequestClose(() => this.closePanel());
    }

    if (this.panel == null) {
      this.panel = atom.workspace.addBottomPanel({
        item: this.view.getElement(),
        className: "log-filter-panel",
      });
    }
  },

  // Hides the panel but keeps the view, so returning to the same editor brings
  // its filter back without recomputing it.
  hidePanel() {
    this.panel?.destroy();
    this.panel = null;
  },

  // Closes for good: the view is destroyed and its folds are removed, leaving
  // the buffer as it was before filtering.
  closePanel() {
    this.hidePanel();
    this.view?.destroy();
    this.view = null;
  },

  toggle() {
    if (this.panel != null) {
      return this.closePanel();
    }

    const editor = atom.workspace.getActiveTextEditor();
    if (editor) this.showPanel(editor);
  },

  toggleFocus() {
    const editor = atom.workspace.getActiveTextEditor();
    if (!editor) return;

    if (this.panel == null) this.showPanel(editor);
    return this.view.toggleFocus();
  },
};

module.exports = LogFilter;
