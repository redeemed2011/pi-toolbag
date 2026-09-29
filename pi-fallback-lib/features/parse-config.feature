Feature: Parse auto-fallback.json
  Fail-closed. Extra live keys are ignored. Do not invent a chain.

  Scenario: live-shaped JSON is accepted and extras ignored
    Given the live-shaped fallback JSON
    When I parse the config
    Then parse succeeds
    And enabled is true
    And max failovers is 1
    And the chain named "grok" has models "grok-cli/grok-4.6, xai/grok-4.6"

  Scenario: missing file
    Given a missing config path
    When I load the config file
    Then parse fails with "missing"

  Scenario: invalid JSON
    Given a config file containing "not-json{"
    When I load the config file
    Then parse fails with "invalid-json"

  Scenario: not an object
    Given the raw config value is the JSON array "[]"
    When I parse the config
    Then parse fails with "not-object"

  Scenario: enabled with empty chains
    Given the raw config value is the JSON object "{\"enabled\":true,\"chains\":[]}"
    When I parse the config
    Then parse fails with "no-chains"

  Scenario: chain with one model
    Given the raw config value is the JSON object "{\"chains\":[{\"models\":[\"grok-cli/grok-4.6\"]}]}"
    When I parse the config
    Then parse fails with "invalid-chain"

  Scenario: invalid model key
    Given the raw config value is the JSON object "{\"chains\":[{\"models\":[\"noslash\",\"xai/grok-4.6\"]}]}"
    When I parse the config
    Then parse fails with "invalid-model-key"

  Scenario: duplicate key in one chain
    Given the raw config value is the JSON object "{\"chains\":[{\"models\":[\"grok-cli/grok-4.6\",\"grok-cli/grok-4.6\",\"xai/grok-4.6\"]}]}"
    When I parse the config
    Then parse fails with "duplicate-key"

  Scenario: duplicate key across two chains
    Given the raw config value is the JSON object "{\"chains\":[{\"name\":\"a\",\"models\":[\"grok-cli/grok-4.6\",\"xai/grok-4.6\"]},{\"name\":\"b\",\"models\":[\"openrouter/z-ai/glm-5.3\",\"xai/grok-4.6\"]}]}"
    When I parse the config
    Then parse fails with "duplicate-key"

  Scenario: invalid budget
    Given the raw config value is the JSON object "{\"chains\":[{\"models\":[\"grok-cli/grok-4.6\",\"xai/grok-4.6\"]}],\"maxFailoversPerRequest\":21}"
    When I parse the config
    Then parse fails with "invalid-budget"

  Scenario: enabled false
    Given the raw config value is the JSON object "{\"enabled\":false}"
    When I parse the config
    Then parse succeeds
    And enabled is false

  Scenario: budget zero is valid
    Given the raw config value is the JSON object "{\"chains\":[{\"models\":[\"grok-cli/grok-4.6\",\"xai/grok-4.6\"]}],\"maxFailoversPerRequest\":0}"
    When I parse the config
    Then parse succeeds
    And max failovers is 0

  Scenario: enabled omitted defaults true
    Given the raw config value is the JSON object "{\"chains\":[{\"models\":[\"grok-cli/grok-4.6\",\"xai/grok-4.6\"]}]}"
    When I parse the config
    Then parse succeeds
    And enabled is true

  Scenario: model id may contain a slash
    Given the raw config value is the JSON object "{\"chains\":[{\"models\":[\"openrouter/z-ai/glm-5.3\",\"xai/grok-4.6\"]}]}"
    When I parse the config
    Then parse succeeds
    And the chain named "chain-0" has models "openrouter/z-ai/glm-5.3, xai/grok-4.6"


  Scenario: grok percent gate is accepted
    Given the raw config value is the JSON object "{\"chains\":[{\"models\":[\"grok-cli/grok-4.6\",\"xai/grok-4.6\"]}],\"usageGates\":[{\"provider\":\"grok-cli\",\"metric\":\"percent\",\"threshold\":90,\"source\":\"grok-cli\"}]}"
    When I parse the config
    Then parse succeeds
    And a usage gate matches provider "grok-cli" at 90 percent from "grok-cli"

  Scenario: omitted usage gates stay omitted
    Given the raw config value is the JSON object "{\"chains\":[{\"models\":[\"grok-cli/grok-4.6\",\"xai/grok-4.6\"]}]}"
    When I parse the config
    Then parse succeeds
    And no usage gates were parsed

  Scenario: grok source cannot report tokens
    Given the raw config value is the JSON object "{\"chains\":[{\"models\":[\"grok-cli/grok-4.6\",\"xai/grok-4.6\"]}],\"usageGates\":[{\"provider\":\"grok-cli\",\"metric\":\"tokens\",\"threshold\":1,\"source\":\"grok-cli\"}]}"
    When I parse the config
    Then parse fails with "invalid-usage-gate"

  Scenario: percent threshold above 100 is rejected
    Given the raw config value is the JSON object "{\"chains\":[{\"models\":[\"grok-cli/grok-4.6\",\"xai/grok-4.6\"]}],\"usageGates\":[{\"provider\":\"grok-cli\",\"metric\":\"percent\",\"threshold\":101,\"source\":\"grok-cli\"}]}"
    When I parse the config
    Then parse fails with "invalid-usage-gate"

  Scenario: http usage source must be https
    Given the raw config value is the JSON object "{\"chains\":[{\"models\":[\"grok-cli/grok-4.6\",\"xai/grok-4.6\"]}],\"usageGates\":[{\"models\":[\"xai/grok-4.6\"],\"metric\":\"tokens\",\"threshold\":10,\"source\":{\"url\":\"http://example.test/usage\",\"path\":\"used\",\"auth\":\"none\"}}]}"
    When I parse the config
    Then parse fails with "invalid-usage-gate"
