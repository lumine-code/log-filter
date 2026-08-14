# log-filter

Filter log lines by text and severity level.

The panel folds away every line that does not match, so a large log can be narrowed down without editing or copying it.

## Features

- **Filter panel**: adds a bottom panel that hides every line the query does not match.
- **Text filtering**: matches the query literally, or as a regular expression when regex mode is on.
- **Case sensitivity**: toggles case sensitive matching of the text query.
- **Severity filtering**: hides verbose, info, debug, warning, or error lines of a log grammar.
- **Context lines**: keeps a configurable number of lines visible around every match.
- **Timestamps**: shows the first and the last timestamp of the buffer above the query.
- **Tail mode**: keeps the editor scrolled to the bottom when the file changes on disk.
- **Persistent state**: remembers the query, the toggles, and the hidden severities per file across sessions.

## Installation

To install `log-filter` search for it in the Install pane of the Lumine settings, or run the command `lumine --install lumine-code/log-filter`.

## Commands

Commands available in `lumine-workspace`:

- `log-filter:toggle`: toggle the filter panel,
- `log-filter:toggle-focus`: move focus between the filter input and the editor.

## Usage

Text filtering works in any buffer, so the panel can be opened anywhere with `log-filter:toggle`.

The severity buttons need a grammar that marks log levels with the `definition.log.log-*` scopes, as `language-log` does. Such grammars are listed in the "Grammar scopes" setting, which also decides where the panel opens on its own; the buttons are hidden for every other grammar.

## Customization

The style of the panel can be adjusted in the user's `styles.css` file, e.g. tint the timestamp separator:

```css
.log-filter-view {
  --log-item-color: #4a5568;
}
```

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
