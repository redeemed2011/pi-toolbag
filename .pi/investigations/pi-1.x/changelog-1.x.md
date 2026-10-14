# Changelog

## [1.2.0] - 2026-10-12

### New Features

- **Per-key OpenRouter model lists**: with an OpenRouter key, Pi lists only the models that key may use, with the key's context size, max output, and prices, including regional endpoints set in `models.json`. See [OpenRouter](docs/providers.md#openrouter).
- **Published configuration schemas**: add `$schema` to `settings.json`, `models.json`, keybindings, and themes for editor validation and completion. See [Settings](docs/settings.md), [Models](docs/models.md), [Keybindings](docs/keybindings.md), and [Themes](docs/themes.md).
- **Clipboard copies over remote sessions**: `PI_CLIPBOARD_OSC52=1` sends copied text to a remote client's clipboard when Pi cannot detect the remote session, such as a multiplexer attached from another machine. See [Pi Process Configuration](docs/environment-variables.md#pi-process-configuration).
- **Codemode improvements**: tool declarations show input constraints such as integer, minimum/maximum, and default, and codemode rows show elapsed and total time. See [Codemode](docs/codemode.md).
- **`before_agent_start` for extension-triggered runs**: runs started by `pi.sendMessage(..., { triggerTurn: true })` go through the same setup as prompts. See [Events and concurrency](docs/extensions.md#events-and-concurrency).

### Breaking Changes

- Published generated configuration schemas for models, settings, keybindings, and themes at `https://pi.dev/schemas/*.schema.json`. The theme schema moved to `https://pi.dev/schemas/theme.schema.json`; themes loaded during startup now receive the same schema validation as later reloads. Update theme `$schema` references, define reusable colors under `vars`, and remove unsupported metadata ([#9880](https://github.com/earendil-works/pi/pull/9880), [#10751](https://github.com/earendil-works/pi/pull/10751) by [@christianklotz](https://github.com/christianklotz))
- Changed `before_agent_start` to also fire for runs started by `pi.sendMessage(..., { triggerTurn: true })` while idle. `BeforeAgentStartEvent` is now a union on `messageType`: `"user"` events carry `prompt` and `images`, and `"custom"` events carry the starting `message` and no `prompt`. Messages returned by handlers are added to both kinds of run, and pending `deliverAs: "nextTurn"` messages are delivered with the custom-message run. Handlers that should act only on user prompts must check `event.messageType === "user"` ([#10267](https://github.com/earendil-works/pi/issues/10267), [#5581](https://github.com/earendil-works/pi/issues/5581), [#10739](https://github.com/earendil-works/pi/pull/10739) by [@davidbrai](https://github.com/davidbrai))
- Changed the session to count as busy while a run starts, including during `before_agent_start` handlers: `ctx.isIdle()` is false, `pi.sendMessage()` queues into the starting run instead of starting a second run that failed with "Agent is already processing", `pi.sendUserMessage()` requires `deliverAs`, and an abort requested meanwhile aborts the run once it starts ([#10739](https://github.com/earendil-works/pi/pull/10739) by [@davidbrai](https://github.com/davidbrai))
- Changed `pi mcp list --json` to report `resources: true` for servers that offer resources instead of `resources` and `resourceTemplates` counts; Pi no longer lists resources when connecting ([#10526](https://github.com/earendil-works/pi/issues/10526))

### Added

- Added `reachesTools` to tool definitions, so tools that reach other tools (such as `codemode` and `tool_search`) declare which tools a call may reach; the MCP extension uses it to wait for the servers a call needs and to decide whether a replacement `codemode` or `tool_search` tool can reach MCP tools
- Added `aliases` to tool namespaces; codemode's `describeNamespace()` and the `namespace` option of `searchTools()` match them, and MCP namespaces use the server name
- Added per-key OpenRouter model lists: with an OpenRouter key, Pi lists only the chat models that key may use, with the key's context size, max output, and prices, including guardrails and regional endpoints set as the base URL in `models.json`. The list is saved and used offline ([#10353](https://github.com/earendil-works/pi/issues/10353), [#10672](https://github.com/earendil-works/pi/pull/10672) by [@davidbrai](https://github.com/davidbrai))
- Added `PI_CLIPBOARD_OSC52=1` to send copied text to the terminal with OSC 52 after the local clipboard write, so copies reach a remote client's clipboard when Pi cannot detect the remote session, such as multiplexer attaches from another machine or remote IDE daemons ([#10826](https://github.com/earendil-works/pi/issues/10826), [#10835](https://github.com/earendil-works/pi/issues/10835), [#10114](https://github.com/earendil-works/pi/issues/10114))
- Added elapsed time while a codemode script runs and its total time once finished to the codemode tool row, like bash rows ([#10708](https://github.com/earendil-works/pi/issues/10708))

### Changed

- Changed the `showHardwareCursor` setting to use only the terminal cursor instead of also drawing Pi's reverse-video cursor
- Changed codemode tool declarations to show input constraints such as integer, minimum/maximum, length, pattern, and default as `@` tags on property comments, so scripts see them without the tool repeating them in descriptions ([#10707](https://github.com/earendil-works/pi/issues/10707))
- Changed codemode declarations of MCP tools to spell out the result type (`content`, `structuredContent`, `isError`) instead of referring to `CallToolResult<T>`, which `describeTool()`, `searchTools()`, and `ALL_TOOLS` showed without defining it; the codemode description no longer includes the shared MCP types
- Changed `serializeConversation()` (compaction, branch summaries, bug reports) to omit thinking blocks; replayed thinking is often not in the live context, so including it could make a summarization request larger than the context it summarizes and fail

### Fixed

- Fixed codemode ignoring a `// @options:` line that is not the first line of the script, which ran the script without the requested `timeout_ms`; the call now fails with an error before the script runs ([#10631](https://github.com/earendil-works/pi/issues/10631))
- Fixed Mistral streams being aborted mid-generation (e.g. during long thinking) after the request timeout; the timeout now applies only to waiting for response headers ([#10609](https://github.com/earendil-works/pi/issues/10609))
- Fixed a symlinked `AGENTS.md` in a git worktree nested inside its main repo causing no project context file to load ([#10681](https://github.com/earendil-works/pi/issues/10681))
- Fixed the code mode tool description claiming every failed tool call rejects; a tool that declares an output schema resolves with its value on failure too (e.g. `bash` with a nonzero exit)
- Fixed runs started by `pi.sendMessage(..., { triggerTurn: true })` removing system prompt sections added in `before_agent_start` after their first tool call, which changed the prompt mid-run and broke the provider prompt cache twice per run ([#10267](https://github.com/earendil-works/pi/issues/10267), [#10739](https://github.com/earendil-works/pi/pull/10739) by [@davidbrai](https://github.com/davidbrai))
- Fixed codemode blocking the process for seconds to minutes after scripts with many `text()` calls; joining the output items was quadratic ([#10678](https://github.com/earendil-works/pi/issues/10678))
- Fixed print mode (`-p`) exiting 0 without a warning when the final response was cut off at the model's output token limit; it now prints the partial text, writes a warning to stderr, and exits 1 ([#10799](https://github.com/earendil-works/pi/issues/10799))
- Fixed `pi mcp login --help` and the CLI docs describing `--timeout` as only the wait for the browser; it limits the whole sign-in ([#10636](https://github.com/earendil-works/pi/issues/10636))
- Fixed `~` not being expanded in `!pattern`, `+path`, and `-path` entries of the `extensions`, `skills`, `prompts`, and `themes` settings, so entries like `!~/skills/pdf` matched nothing ([#10765](https://github.com/earendil-works/pi/issues/10765))
- Fixed MCP servers with resources registering no tools until every resource was listed; Pi no longer lists resources when connecting, so `/mcp` and `pi mcp list` show that a server offers resources instead of counting them ([#10526](https://github.com/earendil-works/pi/issues/10526))
- Fixed MCP tool calls failing when the server returns structured content that is not an object (an array, `null`, or a primitive, as MCP 2026-07-28 allows); codemode declarations of MCP tools without an output schema now type `structuredContent` as `unknown` instead of an object ([#10416](https://github.com/earendil-works/pi/issues/10416))
- Fixed reading or writing `auth.json` on Windows failing with `EPERM` when the previous lock folder was still being deleted; Pi now retries briefly before reporting the error ([#10801](https://github.com/earendil-works/pi/issues/10801))
- Fixed OpenRouter router models such as `openrouter/auto` showing a cost of -$1,000,000 per 1M tokens; OpenRouter's negative placeholder prices are now 0 ([#10672](https://github.com/earendil-works/pi/pull/10672) by [@davidbrai](https://github.com/davidbrai))
- Fixed Anthropic requests failing when the provider rejects the strict tool set for grammar size, tool count, or union limits; Pi now retries once with preferred tools non-strict ([#10409](https://github.com/earendil-works/pi/issues/10409))
- Fixed "The upstream provider returned an error" not being retried as a transient provider error ([#10842](https://github.com/earendil-works/pi/issues/10842))
- Fixed focused fullscreen overlays blocking mouse-wheel scrolling of the transcript ([#10769](https://github.com/earendil-works/pi/issues/10769))
- Fixed fragmented terminal color replies leaking hex values into the prompt and opening the external editor (related reports: [#10256](https://github.com/earendil-works/pi/issues/10256), [#10657](https://github.com/earendil-works/pi/issues/10657))
- Fixed inline images not rendering in Herdr since 1.1.0 ([#10774](https://github.com/earendil-works/pi/pull/10774) by [@ogulcancelik](https://github.com/ogulcancelik))
- Fixed key bindings that name a shifted symbol, such as `+` or `ctrl++`, not matching under the Kitty keyboard protocol or modifyOtherKeys ([#9880](https://github.com/earendil-works/pi/pull/9880) by [@christianklotz](https://github.com/christianklotz))
- Fixed the compaction status indicator embedded in a custom editor using the default muted colors instead of the editor border or thinking-level color, as the working indicator does ([#10809](https://github.com/earendil-works/pi/issues/10809), [#10810](https://github.com/earendil-works/pi/pull/10810) by [@Jay-Madden](https://github.com/Jay-Madden))
- Fixed MCP tool calls that were cancelled or timed out while waiting for an OAuth refresh still being sent to the server once the refresh finished ([#10598](https://github.com/earendil-works/pi/issues/10598))
- Fixed MCP OAuth sign-in accepting an authorization response with an `iss` parameter that could not be checked because no authorization server metadata was discovered; sign-in now fails with an issuer mismatch. Reported by [@AizenvoltPrime](https://github.com/AizenvoltPrime)
- Fixed codemode failing with a broken bridge error when Pi runs under `node --watch` on Node 24 or 26 ([#10725](https://github.com/earendil-works/pi/issues/10725))

### Removed

- Removed the unreleased experimental server, client, and plugin stack (`src/experimental`, `src/cli/experimental`) and its source-only `./client` and `./experimental/plugin` exports; none of it was part of the published package. The `@earendil-works/pi-client`, `@earendil-works/pi-protocol`, and `@earendil-works/pi-server` packages it used are removed and no longer released
- Removed the dependency on `@earendil-works/chord`

## [1.1.0] - 2026-10-07

### New Features

- **Program status reporting**: terminals and agent dashboards that support OSC 7501 see whether Pi is working, blocked on a dialog or login, done, or failed. See [Program status](docs/terminal-setup.md#program-status).
- **Claude Haiku 5.5**: `anthropic/claude-haiku-5-5`, with adaptive thinking up to `xhigh`/`max` effort.
- **Adjust default tools with `+name`/`-name`**: `--tools` entries like `pi -t +codemode,-write` change the default selection instead of replacing it. See [Tools](docs/cli.md#tools).
- **GPT-6 Luna and image classification**: OpenAI's GPT-6 Luna is available as a classifier model through the Decisions API, and codemode's `models.classify()` accepts images for classifiers that support them. See [Use classifier models](docs/models.md#use-classifier-models).
- **Native llama.cpp decision models**: Julia-1, Laya, Kev, lev, and OpenJev served by llama.cpp 0.6.0 or later run natively as classifiers through `/v1/systemone`. See [Classification](docs/llama-cpp.md#classification).

### Added

- Added `+name` and `-name` entries to `--tools`, which change the default tool selection instead of replacing it, for example `pi -t +codemode`
- Added `durationMs` to the tool render context and to `tool_execution_end` extension events: the recorded execution time of a final tool result ([#10549](https://github.com/earendil-works/pi/issues/10549))
- Added `outputPad` to the tool render context ([#10557](https://github.com/earendil-works/pi/pull/10557) by [@rwachtler](https://github.com/rwachtler))
- Added OpenAI's GPT-6 Luna as a classifier model through the Decisions API, available with `OPENAI_API_KEY` (see [Use classifier models](docs/models.md#use-classifier-models))
- Added `images` to codemode's `models.classify()` context, so classifiers that accept images, such as GPT-6 Luna, can judge them
- Added program status reporting with OSC 7501: terminals and agent dashboards that support it see whether Pi is working, blocked on a dialog or login, done, or failed. `PI_PROGRAM_STATUS=1|0` overrides detection (see [Terminal setup](docs/terminal-setup.md#program-status)) ([#10607](https://github.com/earendil-works/pi/issues/10607))
- Added `aborted` to `agent_settled` session, extension, and JSON events, so integrations can tell a cancelled run from a finished one ([#10607](https://github.com/earendil-works/pi/issues/10607))
- Added Claude Haiku 5.5 (`anthropic/claude-haiku-5-5`), with adaptive thinking up to `xhigh`/`max` effort and prompt caching on Bedrock
- Added native llama.cpp decision models: Julia-1, Laya, Kev, lev, and OpenJev served by llama.cpp 0.6.0 or later are listed only as classifiers through `/v1/systemone` instead of as chat models (see [Classification](docs/llama-cpp.md#classification)) ([#10382](https://github.com/earendil-works/pi/pull/10382))

### Changed

- Changed `outputPad` to also apply to `!` command output, tool output, and summary blocks ([#9946](https://github.com/earendil-works/pi/issues/9946), [#10557](https://github.com/earendil-works/pi/pull/10557) by [@rwachtler](https://github.com/rwachtler))
- Changed `pi mcp login --timeout` to limit the whole sign-in, including requests to the authorization server, instead of only the wait for the browser ([#10565](https://github.com/earendil-works/pi/issues/10565))

### Fixed

- Fixed bash and PowerShell results losing `Took` after reloading a session, and the live `Took` including wall-clock steps; both now show the recorded execution time ([#10549](https://github.com/earendil-works/pi/issues/10549))
- Fixed managed installs keeping every old release; `pi update` now keeps only the new release and the one it updated from ([#10392](https://github.com/earendil-works/pi/issues/10392), [#10511](https://github.com/earendil-works/pi/pull/10511) by [@davidbrai](https://github.com/davidbrai))
- Fixed standalone binaries loading `.env`, `.env.local`, and `.env.development` from the launch directory into Pi's environment ([#10473](https://github.com/earendil-works/pi/issues/10473))
- Fixed `!!` command headers losing their dim color once output arrives ([#10557](https://github.com/earendil-works/pi/pull/10557) by [@rwachtler](https://github.com/rwachtler))
- Fixed the codemode description not marking `searchTools()`, `describeTool()`, and `describeNamespace()` as async, which led models to serialize the unawaited promise as `{}` ([#10555](https://github.com/earendil-works/pi/issues/10555))
- Fixed codemode output items running together, so models could not tell where one `text()` or `console.log()` output ended and the next began. With several text items, each now starts with a `==> text N/M <==` line, and `console` calls follow the other output in one `<console_output>` block with one line per call
- Fixed `/mcp` waiting for all servers to connect before opening; the manager now updates live and remains usable while enabling, reconnecting, or disabling servers ([#10562](https://github.com/earendil-works/pi/issues/10562))
- Fixed images being dropped as "could not be resized" when running under `node --watch` on Node 24.19+ and 26.x, where Node posts its own messages on the image resize worker channel ([#10527](https://github.com/earendil-works/pi/issues/10527))
- Fixed clipboard paste doing nothing in Termux, and failed copies there omitting the Termux:API install hint ([#10391](https://github.com/earendil-works/pi/issues/10391))
- Fixed `!` and RPC `bash` output keeping fragments of color codes, such as a stray `m`, when a code was split across output chunks ([#10504](https://github.com/earendil-works/pi/issues/10504))
- Fixed MCP OAuth sign-ins that could not be cancelled while waiting on the authorization server and kept running after the session ended. The sign-in screen now cancels with Esc at every step, session shutdown aborts a running sign-in, and each request to the authorization server times out after 15 seconds ([#10565](https://github.com/earendil-works/pi/issues/10565))
- Fixed shutdown waiting up to 15 seconds to refresh an MCP OAuth token that was about to expire, only to close the server's session ([#10565](https://github.com/earendil-works/pi/issues/10565))
- Fixed the fullscreen text selection surviving session switches and other transcript rebuilds, which highlighted unrelated text in the new transcript ([#9311](https://github.com/earendil-works/pi/issues/9311), [#10567](https://github.com/earendil-works/pi/pull/10567) by [@christianklotz](https://github.com/christianklotz))
- Fixed OpenAI models on Bedrock ignoring the thinking level and always running at Bedrock's default reasoning effort ([#9331](https://github.com/earendil-works/pi/issues/9331), [#10142](https://github.com/earendil-works/pi/pull/10142) by [@jsanter27](https://github.com/jsanter27))
- Fixed model `headers` in `models.json` not overriding the `originator` and `User-Agent` headers of Codex requests ([#10429](https://github.com/earendil-works/pi/pull/10429) by [@lucasmeijer](https://github.com/lucasmeijer))
- Fixed `server_busy` and `servers are currently busy` provider errors ending the turn instead of being retried ([#10543](https://github.com/earendil-works/pi/issues/10543))
- Fixed Mistral responses that end with `finish_reason: "error"` not being retried ([#10487](https://github.com/earendil-works/pi/issues/10487))
- Reduced context-limit request failures by estimating input at 3.5 characters per token instead of 4 when calculating output limits ([#10497](https://github.com/earendil-works/pi/issues/10497))
- Fixed Radius models disabled by an organization owner still being listed
- Fixed Anthropic browser login failing with "localhost refused to connect" when port 53692 is reserved or in use, for example by Hyper-V/WSL port exclusions on Windows: login now falls back to a free loopback port ([#10571](https://github.com/earendil-works/pi/issues/10571))
- Fixed session costs undercounting long prompts on models with prompt-length pricing tiers, such as Claude Haiku 5.5, Gemini 3.1 Pro, and GPT-5.4, through OpenCode, OpenCode Go, OpenRouter, Vercel AI Gateway, Google, MiniMax, and other providers
- Fixed Markdown links not being clickable in Herdr ([#10573](https://github.com/earendil-works/pi/issues/10573))

## [1.0.4] - 2026-10-05

### New Features

- **Tool patterns and `--no-mcp`**: `--tools` and `--exclude-tools` accept `*` patterns, for example `--tools read,codemode,'mcp__radius__*'` keeps only one MCP server's tools. `--tools` now keeps MCP tools unless an entry starts with `mcp__`, and `--no-mcp` turns off MCP for one run. See [Tools](docs/cli.md#tools) and [MCP tools](docs/cli.md#mcp-tools).
- **Codemode persists images**: `tools.read()` on an image file now gives back an image block that `image()` can show. See [Call tools](docs/codemode.md#call-tools).

### Added

- Added `*` patterns to `--tools` and `--exclude-tools`, for example `--tools read,codemode,'mcp__radius__*'`
- Added `--no-mcp` to disable the built-in MCP support for one run

### Fixed

- Fixed syntax highlighting losing colors after the first line of multiline strings and comments in fenced code blocks ([#10143](https://github.com/earendil-works/pi/issues/10143))
- Fixed codemode scripts not receiving images from `read`: `tools.read()` now resolves to an image block for image files, which `image()` shows ([#10251](https://github.com/earendil-works/pi/issues/10251))
- Fixed MCP OAuth sign-in failing with `invalid_redirect_uri` on servers with OpenID Connect client registration, such as `mcp.modem.dev`: pi now registers as a native client ([#10493](https://github.com/earendil-works/pi/issues/10493))
- Fixed `--tools` removing MCP tools, which left `pi --tools codemode` without any MCP servers. `--tools` now keeps MCP tools unless an entry starts with `mcp__`
- Fixed MCP session shutdown returning while a server was still connecting, leaving its transport open until the server answered or timed out ([#10249](https://github.com/earendil-works/pi/issues/10249))
- Fixed system prompt rules and the skills hint naming tools hidden by `prepareLoadout`. Hidden tools are left out of the rules, the skills hint names no tool when the file reader is hidden, and `codemode` shows each tool's prompt guidelines with its declaration; `ToolLoadout` gains `getPromptGuidelines()` ([#10343](https://github.com/earendil-works/pi/issues/10343))
- Fixed Bedrock requests that fail with `The pending stream has been canceled` after a stalled HTTP/2 connection not being retried automatically ([#10379](https://github.com/earendil-works/pi/issues/10379))
- Fixed codemode scripts that patch built-ins (for example `Array.prototype.toJSON = ...`) crashing pi and leaving the tool call unsettled. Built-ins are now frozen before the script runs, so such patches have no effect ([#10444](https://github.com/earendil-works/pi/issues/10444))

## [1.0.3] - 2026-10-05

### New Features

- **Azure Foundry Chat Completions** — The `azure` provider (renamed from `azure-openai-responses`) now also serves Foundry Chat Completions deployments, starting with `azure/deepseek-v4-pro`. See [Azure OpenAI](docs/providers.md#azure-openai).
- **Codemode images saved to files** — `image()` also writes each image to a temp file and names the path in the result, so later turns can copy or move generated images. See [Generate images](docs/codemode.md#generate-images).

### Breaking Changes

- Renamed the Azure provider from `azure-openai-responses` to `azure`. Rename the provider key in `auth.json` (or run `/login` again), in `models.json`, and in `settings.json` (`defaultProvider`, `enabledModels` patterns, and `modelThinkingLevels` keys). Sessions that used the old provider fall back to another model when resumed, and their prompt cache is not reused. The `AZURE_OPENAI_*` environment variables are unchanged ([#9714](https://github.com/earendil-works/pi/pull/9714) by [@jsanter27](https://github.com/jsanter27))

### Added

- Added Azure Foundry Chat Completions deployments, starting with `azure/deepseek-v4-pro` ([#9645](https://github.com/earendil-works/pi/issues/9645), [#9714](https://github.com/earendil-works/pi/pull/9714) by [@jsanter27](https://github.com/jsanter27))

### Changed

- Codemode `image()` now also saves each image to a temp file and names the path in the result, so later turns can copy or move generated images ([#10310](https://github.com/earendil-works/pi/issues/10310))
- Output files (full text of truncated tool output, binary MCP resources, codemode images) are now readable only by the user
- `Home`/`End` now always move the editor cursor to the line start/end; fullscreen transcript top/bottom moved to `Ctrl+Home`/`Ctrl+End`, which no longer move the editor cursor ([#10314](https://github.com/earendil-works/pi/issues/10314))

### Fixed

- Fixed subscription logins such as Sign in with ChatGPT failing with `refresh_token_invalidated` after a request was cancelled during an OAuth token refresh
- Fixed codemode failing for the rest of a session after a pnpm global update removed the running install, and added a restart hint when errors occur after pi was updated or removed on disk ([#10439](https://github.com/earendil-works/pi/issues/10439))
- Fixed interactive sessions reporting a `read EIO` or `setRawMode EIO` crash (and asking to run /bug) when the terminal went away, e.g. after closing the window or resuming a suspended pi in a closed terminal

## [1.0.2] - 2026-10-04

### New Features

- **Sampling by thinking level** — `samplingParamsByThinkingLevel` in `models.json` sets sampling parameters such as `temperature` and `top_p` for each thinking level on OpenAI-compatible APIs. See [Configure sampling by thinking level](docs/models.md#configure-sampling-by-thinking-level).

### Added

- Added `samplingParamsByThinkingLevel` to `models.json` for per-thinking-level sampling parameter overrides on OpenAI-compatible APIs. See [Configure sampling by thinking level](docs/models.md#configure-sampling-by-thinking-level) ([#9776](https://github.com/earendil-works/pi/pull/9776) by [@mrexodia](https://github.com/mrexodia))

## [1.0.1] - 2026-10-03

### New Features

- **Nix flake** — `nix run github:earendil-works/pi/stable` runs the latest release, and `nix profile add github:earendil-works/pi/stable` installs it. See [Install pi](docs/quickstart.md#1-install-pi).
- **Project overrides for MCP servers** — `.pi/mcp.json` and `/mcp` can enable, disable, or change the exposure of a user-level server for one project. See [Configure servers](docs/mcp.md#configure-servers).
- **MCP Client ID Metadata Documents** — `oauth.clientRegistration: "cimd"` lets authorization servers allow pi by its document URL instead of dynamic registration. See [Authenticate with OAuth](docs/mcp.md#authenticate-with-oauth).
- **Tool renderers for any tool** — `pi.registerToolRenderer()` draws calls to tools that are not registered yet, such as MCP tools in resumed sessions. See [Tool rendering](docs/extensions.md#tool-rendering).
- **Cloudflare Clef classifiers** — `@cf/cloudflare/clef` and `@cf/cloudflare/clef-flash` are usable from codemode scripts and extensions. See [Use classifier models](docs/models.md#use-classifier-models).

### Added

- Added a copy key (`app.message.copy`, default `ctrl+x`) to OAuth sign-in screens in `/login`, `/mcp`, and `/mcp login`, which copies the sign-in URL when the browser cannot be opened or the wrapped link cannot be selected.
- Added `oauth.clientRegistration: "cimd"` for MCP servers, which identifies pi with its Client ID Metadata Document on pi.dev instead of dynamic client registration, so authorization servers can allow pi by URL ([#10302](https://github.com/earendil-works/pi/issues/10302))
- Added project overrides for user-level MCP servers: a `.pi/mcp.json` entry without `command` or `url` sets only `enabled`, `exposure`, and `toolExposure` of the user-level server, and `/mcp` can enable or disable a server for the current project ([#10277](https://github.com/earendil-works/pi/issues/10277))
- Added Cloudflare's Clef and Clef Flash classifier models to `cloudflare-workers-ai`, usable from codemode scripts and extensions ([#10316](https://github.com/earendil-works/pi/pull/10316) by [@ndisidore](https://github.com/ndisidore), [#10322](https://github.com/earendil-works/pi/pull/10322) by [@RealAlexandreAI](https://github.com/RealAlexandreAI))
- Added `pi.registerToolRenderer()`, which chooses how calls to a tool are drawn, including tools that are not registered ([#10285](https://github.com/earendil-works/pi/issues/10285))
- Added a Nix flake for macOS and Linux: `nix run github:earendil-works/pi/stable` runs the latest release, and `nix profile add github:earendil-works/pi/stable` installs it. See [Install pi](docs/quickstart.md#1-install-pi) ([#9137](https://github.com/earendil-works/pi/pull/9137))

### Changed

- `pi update` on global npm installations now recommends migrating to the managed installation from the pi.dev installer, which pins all dependencies.
- Anthropic tools added or redefined mid-conversation are now defined inline in the conversation, so redefining a tool under the same name keeps the prompt cache instead of resending the full tool list.

### Fixed

- Fixed installations resolving vulnerable `brace-expansion` 5.0.9 by pinning `brace-expansion` 5.0.12 as a direct dependency (GHSA-q2hr-2g5m-vwhr, GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p) ([#10288](https://github.com/earendil-works/pi/issues/10288))
- Fixed a trailing comma in `--models` adding an extra model to the model cycle ([#10334](https://github.com/earendil-works/pi/issues/10334))
- Fixed a `codemode` script that prints in a loop crashing pi by running out of memory: a script fails once its output passes 16 Mi characters or 100000 items ([#10283](https://github.com/earendil-works/pi/issues/10283))
- Fixed JPEG, GIF, and WebP images rendered by extensions through `Image` not appearing in Kitty, Ghostty, WezTerm, and Warp ([#10292](https://github.com/earendil-works/pi/issues/10292))
- Fixed MCP tool calls in resumed sessions and HTML exports rendering fully expanded until their server connected, or for good if it never did ([#10285](https://github.com/earendil-works/pi/issues/10285))
- Fixed fullscreen Kitty images collapsing to a one-row strip after scrolling in WezTerm ([#10319](https://github.com/earendil-works/pi/issues/10319))
- Fixed "Selected model is at capacity" provider errors ending the turn instead of being retried ([#10278](https://github.com/earendil-works/pi/issues/10278))
- Fixed Cloudflare AI Gateway Claude models failing with a 404 by using dashed model IDs (`claude-opus-5-5` instead of `claude-opus-5.5`)
- Fixed Sign in with ChatGPT continuing when its callback port is taken by another login, which made the browser show "OAuth state mismatch"; it now fails with a port-in-use error ([#10265](https://github.com/earendil-works/pi/issues/10265))
- Fixed Amazon Bedrock OpenAI models costing requests above 272k input tokens at the short-context rate; Bedrock models now include the pricing tiers listed on models.dev ([#10326](https://github.com/earendil-works/pi/issues/10326))
- Fixed Amazon Bedrock Claude requests failing with "Invalid `signature` in `thinking` block" after the system prompt or tools changed ([#10324](https://github.com/earendil-works/pi/issues/10324))
- Fixed Together DeepSeek V4 Pro losing its thinking level controls after Together renamed it to `deepseek-ai/DeepSeek-V4-Pro-0813` ([#10336](https://github.com/earendil-works/pi/pull/10336) by [@cv](https://github.com/cv))
- Fixed the default NVIDIA model pointing at `nvidia/nemotron-3-super-120b-a12b`, which NVIDIA no longer serves; the default is now `nvidia/nemotron-3-ultra-550b-a55b`

### Removed

- Removed `npm-shrinkwrap.json` from the published package. npm installations no longer pin transitive dependencies, and library consumers can now override them. Use the pi.dev installer for pinned installations ([#5653](https://github.com/earendil-works/pi/issues/5653))

## [1.0.0] - 2026-10-01

### New Features

- **Fullscreen by default** — The TUI now runs fullscreen. Set `tuiMode` to `"regular"` to keep the terminal's normal scrollback. See [Terminal and display](docs/settings.md#terminal-and-display).
- **Leaner codemode** — About 40% fewer prompt tokens, and errors that tell the model how to recover. See [Codemode](docs/codemode.md).
- **Image generation in codemode** — Scripts call `models.generateImages()` with the session's credentials. See [Generate images](docs/codemode.md#generate-images) and [Use image models](docs/models.md#use-image-models).
- **Radius in `/login`** — Sign in with Radius and set up its MCP server in one step. See [Radius](docs/providers.md#radius).
- **Anthropic copy code login** — Sign in when the browser runs on another machine. See [Authenticate interactively](docs/providers.md#authenticate-interactively).
- **MCP OAuth hardening** — `oauth.authServerMetadataUrl`, RFC 9207 `iss` checks, credentials per server, and step-up sign-in that keeps granted scopes. See [Authenticate with OAuth](docs/mcp.md#authenticate-with-oauth).
- **Header-only quiet startup** — `quietStartup: "header"` keeps the version and key hints and hides the rest. See [Terminal and display](docs/settings.md#terminal-and-display).

### Added

- Added an `oauth.authServerMetadataUrl` setting for MCP servers that advertise a wrong OAuth authorization server or none. Pi uses the configured metadata document instead of discovery ([#10172](https://github.com/earendil-works/pi/issues/10172)).
- Added `quietStartup: "header"`, which keeps the startup header with version and key hints but hides the model scope line and loaded-resource listing.
- Added `models.generateImages()` to codemode scripts. It runs image models such as OpenRouter's with the session's credentials and returns base64 image blocks that `image()` attaches to the result; usage counts toward the session cost like `models.classify()`. Extensions can call `ctx.modelRegistry.generateImages()`. See [Use image models](docs/models.md#use-image-models).
- Added a copy code login method to Anthropic `/login` for headless setups where the browser runs on another machine ([#10194](https://github.com/earendil-works/pi/pull/10194) by [@lucasmeijer](https://github.com/lucasmeijer)).

### Changed

- Changed the default TUI mode to fullscreen. Set `tuiMode` to `"regular"` or pass `--tui-mode regular` to keep the terminal's normal scrollback.
- `/login` now offers "Sign in with Radius" at the top level, as the last option, with its status. After a Radius sign-in, `/login` offers to configure the Radius MCP server in the global `mcp.json` with `"auth": { "provider": "radius" }` and reloads. Cancelling a login returns to the menu it was started from.
- The provider docs page is renamed to [Providers](docs/providers.md), its "Cloud Providers" section is now "Provider Specific Config", and it documents Radius first.
- MCP OAuth credentials are now stored per server name and URL, so MCP servers with the same URL can sign in with different accounts. Credentials stored by URL alone move to the first server that uses them ([#10252](https://github.com/earendil-works/pi/issues/10252)).
- Codemode costs far fewer prompt tokens: with the default tools and codemode active, a GPT-5.6 request shrinks from about 5,300 to 3,300 tokens. The `codemode` description lists the script globals in one line each and points to the new [Codemode](docs/codemode.md) reference for the `models` API, which the model reads when it needs it. Declared tools say in one line how scripts call them and what the call resolves to, instead of repeating their full declaration, and the system prompt's codemode guidance and MCP server section are shorter.
- Codemode errors now say how to recover: reading a tool or `models` member that does not exist names the close matches (`tools.Bash` suggests `tools.bash`), `models.classify()` and `models.generateImages()` reject malformed arguments with the expected shape, an unknown model points to `models.getAvailableOfType()`, an oversized `store()` value explains what the store is for, and a script that generates images without showing them gets a note. Scripts that probed for a tool with `typeof tools.name` must use `"name" in tools`.
- `/login` and `/logout` now label providers without credentials as "not configured" instead of "unconfigured".
- OAuth browser pages now show the color Pi logo.

### Fixed

- Fixed MCP OAuth sign-in accepting an authorization response whose `iss` parameter names another authorization server; the code is now rejected before it is exchanged (RFC 9207).
- Fixed MCP OAuth sign-in failing with `Invalid scope` when the token response contains `"scope": ""`, and similar failures for other empty or `null` optional OAuth fields ([#10266](https://github.com/earendil-works/pi/issues/10266)).
- Fixed the sign-in URL printed by `/mcp login` not being clickable when it wraps ([#10186](https://github.com/earendil-works/pi/issues/10186)).
- Fixed `--provider` without `--model` being silently ignored and running the default model from another provider; it now fails with an error ([#10236](https://github.com/earendil-works/pi/issues/10236)).
- Fixed MCP servers that ask for more scope (`insufficient_scope`) requesting sign-in over and over. The new sign-in requested only the missing scopes, so the new token lost access the previous one had; it now keeps the granted scopes.
- Fixed user messages in the transcript keeping two full-width copies of every rendered line; they keep one, with identical output.
- Fixed `/login` and `/logout` labeling every OAuth sign-in, including Radius, as a subscription; only subscription-backed providers say "subscription", other OAuth sign-ins say "account".
- Fixed the startup header logo rendering with gaps in Apple Terminal; it now shows a colored "Pi" with the version instead.
- Fixed deferred MCP tools that `tool_search` loaded being dropped on resume and `/reload` even when their server reconnected before the next prompt, because the session restored its tools before the MCP servers reconnected.
- Fixed the system theme making pastel palettes such as Catppuccin Frappe much more vivid; palette colors now keep their chroma ([#10255](https://github.com/earendil-works/pi/issues/10255), [#10293](https://github.com/earendil-works/pi/pull/10293) by [@dgtlntv](https://github.com/dgtlntv)).
- Fixed slash command autocompletion not triggering when the input starts with whitespace ([#10218](https://github.com/earendil-works/pi/pull/10218) by [@haoqixu](https://github.com/haoqixu)).
- Fixed color bleeding past mouse selections and search highlights in fullscreen mode when a styled token ends at the highlight boundary ([#10169](https://github.com/earendil-works/pi/issues/10169)).
- Fixed memory retained per rendered message in the transcript; a long assistant message keeps about a fifth of the heap it kept before.

