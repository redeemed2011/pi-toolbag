Run `bash scripts/shelf-harvest-live.sh`.

The script opens `pi-unsafe` with a throwaway `CTX_HOME`, sends `shelf-harvest-prompt.txt`, answers the bind prompts, and prints the receipt plus PASS/FAIL lines. It does not touch `~/.pi/ctx`.
