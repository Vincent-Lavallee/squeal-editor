# Squeal Editor

[![Coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/Vincent-Lavallee/08a69b0d2852c5e0398ca05ed3af7f50/raw/squeal-editor-coverage.json)](https://github.com/Vincent-Lavallee/squeal-editor/actions/workflows/ci.yml)

A multi-database SQL editor for PostgreSQL, MySQL, and SQLite.

Browse databases and tables in a sidebar, click a table to preview it, or write
SQL by hand and run it.

|                                     |                                 |
| ----------------------------------- | ------------------------------- |
| ![Browsing a table](docs/images/browse-table.png) | ![Running a query](docs/images/run-query.png) |

<img src="docs/images/connect-screen.png" alt="The connect screen" width="480">


## Install

| OS      | Get it                                                                                                                                                                                                                    |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows | (recommended)<br> <pre>irm https://raw.githubusercontent.com/Vincent-Lavallee/squeal-editor/dev/scripts/install-windows.ps1 \| iex</pre> or download `squeal-editor-*.exe` from the [Releases page][releases] — see [SmartScreen on Windows](#smartscreen-on-windows) |
| macOS   | (recommended)<br> <pre>curl -fsSL https://raw.githubusercontent.com/Vincent-Lavallee/squeal-editor/dev/scripts/install-macos.sh \| bash</pre> or download `squeal-editor-macos-*.dmg` from the [Releases page][releases] — see [Gatekeeper on macOS](#gatekeeper-on-macos) |
| Linux   | not shipped yet — build from source                                                                                                                                                                                     |

[releases]: https://github.com/Vincent-Lavallee/squeal-editor/releases/latest

### SmartScreen on Windows

A manually downloaded `.exe` is flagged on first run: "Windows protected your
PC — Microsoft Defender SmartScreen prevented an unrecognized app from
starting."

1. Run the installer from wherever it downloaded — it will be blocked.
2. Click **More info**.
3. Click **Run anyway**.

This is a one-time step; every launch after that works normally.

### Gatekeeper on macOS

A manually downloaded `.dmg` is blocked on first launch: "Squeal Editor can't
be opened because Apple cannot check it for malicious software." To allow it:

1. Try to open Squeal Editor from `/Applications` — it will be blocked.
2. Open **System Settings > Privacy & Security**.
3. Scroll to the **Security** section at the bottom; it names the blocked app.
4. Click **Open Anyway**, and confirm with your password or Touch ID.
5. Open Squeal Editor again and click **Open** on the final confirmation
   dialog.

This is a one-time step; every launch after that works normally.


## Features

- Connect to PostgreSQL, MySQL, or SQLite databases.
- Save connections and organize them by workspace, so you can keep, say, work
  and personal databases separate.
- Connect to AWS RDS with IAM authentication instead of a stored password.
- Browse a database's schemas, tables, and columns in a searchable sidebar
  tree.
- Click a table to preview its rows, or write and run SQL by hand with
  autocomplete for keywords, tables, and columns.