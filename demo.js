// Authentic package usage. Run with lumine/script/demo.js; fixtures stay in demo/.
module.exports = {
  version: 1,
  dependencies: ["language-log"],
  viewport: { width: 1100, height: 480 },
  async before() {},
  async prepare(context) {
    const { lumine, state, fixture, open } = context;
    state.editor = await open("logs/processing.log");
    await lumine.project.setPaths([fixture("logs")]);
  },
  scenes: [
    {
      id: "scene-1",
      file: "demo.png",
      caption: "Filter a log to keep only warnings and errors visible.",
      timeout: 60000,
      async run(context) {
        const { lumine, state } = context;
        {
          lumine.commands.dispatch(lumine.views.getView(state.editor), "log-filter:toggle-focus");
          const v = lumine.packages.getActivePackage("log-filter").mainModule.view;
          v.filterBuffer.setText("WARNING|ERROR");
          v.regexEnabled = true;
          v.filter.setRegexEnabled(true);
          v.confirm();
        }
      },
      ready() {
        return Boolean(
          document.querySelector(".log-filter-view")?.innerText.includes("Showing 2 of 8"),
        );
      },
    },
  ],
  async cleanup() {},
};
