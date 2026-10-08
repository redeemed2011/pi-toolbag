# pi-tool-groups

Collapses a finished run of tool calls into one row, using pi-droid's marker: a green `●` when the call finishes, a red `✗` when it fails, and the spinning marker while it is still running.

Reads, searches, and directory listings that sit next to each other become one counted line, in the order each kind first appeared. A shell command is its own `Ran` row. Consecutive edits of one file become `Edited <file> +N/-M`. A thought, and any other tool, is its own row. Click a row to open the original output.

Working rows stay with pi-droid-styling. This extension only replaces them once the call has finished.
