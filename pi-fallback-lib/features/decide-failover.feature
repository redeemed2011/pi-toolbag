Feature: Decide next unused chain member
  Walk JSON order. Never retry an attempted key. Budget is an input; the kernel does not decrement it.

  Background:
    Given the live grok chain config with budget 1

  Scenario: grok-cli quota failovers to xai
    Given the current model is "grok-cli/grok-4.6"
    And remaining budget is 1
    And attempted keys are none
    And an error with text "usage balance exhausted" and stop reason "error"
    When I decide failover
    Then the decision is failover to "xai/grok-4.6" because "quota"

  Scenario: observer xai failovers to unused grok-cli
    Given the current model is "xai/grok-4.6"
    And remaining budget is 1
    And attempted keys are none
    And an error with text "429 rate limit" and stop reason "error"
    When I decide failover
    Then the decision is failover to "grok-cli/grok-4.6" because "transient"

  Scenario: observer xai 403 credits failovers to grok-cli
    Given the current model is "xai/grok-4.6"
    And remaining budget is 1
    And attempted keys are none
    And an error with text "OpenAI API error (403): 403 Your team has either used all available credits or reached its monthly spending limit" and stop reason "error"
    When I decide failover
    Then the decision is failover to "grok-cli/grok-4.6" because "quota"

  Scenario: already-attempted skip
    Given the current model is "xai/grok-4.6"
    And remaining budget is 1
    And attempted keys are "grok-cli/grok-4.6"
    And an error with text "429 rate limit" and stop reason "error"
    When I decide failover
    Then the decision is none because "no-unused-member"

  Scenario: model not in any chain
    Given the current model is "openrouter/z-ai/glm-5.3"
    And remaining budget is 1
    And attempted keys are none
    And an error with text "timeout" and stop reason "error"
    When I decide failover
    Then the decision is none because "not-in-chain"

  Scenario: model id containing a slash is an exact key
    Given a slash-id chain config
    And the current model is "openrouter/z-ai/glm-5.3"
    And remaining budget is 1
    And attempted keys are none
    And an error with text "timeout" and stop reason "error"
    When I decide failover
    Then the decision is failover to "xai/grok-4.6" because "transient"

  Scenario: budget exhausted
    Given the current model is "grok-cli/grok-4.6"
    And remaining budget is 0
    And attempted keys are none
    And an error with text "timeout" and stop reason "error"
    When I decide failover
    Then the decision is none because "budget-exhausted"

  Scenario: auth is not failover-worthy
    Given the current model is "grok-cli/grok-4.6"
    And remaining budget is 1
    And attempted keys are none
    And an error with text "unauthorized" and stop reason "error"
    When I decide failover
    Then the decision is none because "not-failover-worthy"

  Scenario: overflow is not failover-worthy
    Given the current model is "grok-cli/grok-4.6"
    And remaining budget is 1
    And attempted keys are none
    And an error with text "context window" and stop reason "error"
    When I decide failover
    Then the decision is none because "not-failover-worthy"

  Scenario: disabled config
    Given a disabled fallback config
    And the current model is "grok-cli/grok-4.6"
    And remaining budget is 1
    And attempted keys are none
    And an error with text "timeout" and stop reason "error"
    When I decide failover
    Then the decision is none because "disabled"

  Scenario: two hops honor budget 2
    Given a three-model chain with budget 2
    And the current model is "a/one"
    And remaining budget is 2
    And attempted keys are none
    And an error with text "timeout" and stop reason "error"
    When I decide failover
    Then the decision is failover to "b/two" because "transient"
    Given remaining budget is 1
    And the current model is "b/two"
    And attempted keys are "a/one"
    When I decide failover
    Then the decision is failover to "c/three" because "transient"
    Given remaining budget is 0
    And the current model is "c/three"
    And attempted keys are "a/one, b/two"
    When I decide failover
    Then the decision is none because "budget-exhausted"
