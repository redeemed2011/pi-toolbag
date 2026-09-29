Feature: Usage gate switches before the request
  A crossed percent or token threshold hops to the next chain model.
  It does not send continue and does not spend the error-failover budget.
  A failed probe stays on the current model.

  Background:
    Given a fake host on "grok-cli/grok-4.6" with thinking "low"
    And the registry includes "grok-cli/grok-4.6" and "xai/grok-4.6"
    And the live grok chain config with budget 1
    And a grok percent gate at 90 on provider "grok-cli"

  Scenario: 92 percent switches without continue or budget spend
    Given usage reads 92
    And attach with retryAfterTools false
    And a session start
    When the user prompt starts
    Then setModel was called with "xai/grok-4.6"
    And continue was not sent
    And preferred is still "grok-cli/grok-4.6"
    And the remaining failover budget is 1
    And a usage-switch event went to "xai/grok-4.6"
    And thinking was reapplied as "low"

  Scenario: 89.4 percent stays
    Given usage reads 89.4
    And attach with retryAfterTools false
    And a session start
    When the user prompt starts
    Then setModel was not called
    And continue was not sent

  Scenario: 89.6 percent rounds like /usage and switches
    Given usage reads 89.6
    And attach with retryAfterTools false
    And a session start
    When the user prompt starts
    Then setModel was called with "xai/grok-4.6"
    And a usage-switch event went to "xai/grok-4.6"

  Scenario: a failed probe does not switch
    Given usage is unavailable because "fetch-failed"
    And attach with retryAfterTools false
    And a session start
    When the user prompt starts
    Then setModel was not called
    And a usage-skip event has reason "unavailable"

  Scenario: a gated model outside the chain does not invent a hop
    Given a fake host on "grok-cli/grok-build" with thinking "low"
    And the registry includes "grok-cli/grok-build" and "xai/grok-4.6"
    And the live grok chain config with budget 1
    And a grok percent gate at 90 on provider "grok-cli"
    And usage reads 95
    And attach with retryAfterTools false
    And a session start
    When the user prompt starts
    Then setModel was not called
    And a usage-skip event has reason "not-in-chain"

  Scenario: a usage-held model is not an error failover target
    Given usage reads 95
    And attach with retryAfterTools false
    And a session start
    When the user prompt starts
    Then setModel was called with "xai/grok-4.6"
    Given the last assistant error is "timeout"
    When the agent settles
    Then continue was not sent
    And a skip event has reason "no-unused-member" and class "transient"
    And the remaining failover budget is 1

  Scenario: compact does not restore a usage-held preferred model
    Given usage reads 95
    And attach with retryAfterTools false
    And a session start
    When the user prompt starts
    And a chapter-break compact happens with reason "manual"
    Then the current model is "xai/grok-4.6"
    And setModel call count is 1
    And a usage-skip event has reason "usage-held"
