Feature: Attach failover to a Pi session
  Timing A. setModel plus continue. Interactive skips after tools. Observers may retry after tools.

  Background:
    Given a fake host on "grok-cli/grok-4.6" with thinking "low"
    And the registry includes "grok-cli/grok-4.6" and "xai/grok-4.6"
    And the live grok chain config with budget 1

  Scenario: quota at settle failovers and continues
    Given attach with retryAfterTools false
    And a session start
    And the last assistant error is "usage balance exhausted"
    When the agent settles
    Then setModel was called with "xai/grok-4.6"
    And continue was sent once
    And preferred is still "grok-cli/grok-4.6"
    And thinking was reapplied as "low"
    And the remaining failover budget is 0

  Scenario: interactive does not failover after tools
    Given attach with retryAfterTools false
    And a session start
    And a tool has started
    And the last assistant error is "timeout"
    When the agent settles
    Then setModel was not called
    And continue was not sent

  Scenario: observer failovers after tools
    Given attach with retryAfterTools true
    And a session start
    And a tool has started
    And the last assistant error is "timeout"
    When the agent settles
    Then setModel was called with "xai/grok-4.6"
    And continue was sent once

  Scenario: user model select becomes preferred
    Given attach with retryAfterTools false
    And a session start
    When the user selects model "xai/grok-4.6" with source "set"
    Then preferred is "xai/grok-4.6"
    And the remaining failover budget is 1

  Scenario: failover setModel does not update preferred
    Given attach with retryAfterTools false
    And a session start
    And the last assistant error is "timeout"
    When the agent settles
    Then preferred is still "grok-cli/grok-4.6"
    And setModel was called with "xai/grok-4.6"

  Scenario: chapter-break restores preferred without continue
    Given attach with retryAfterTools false
    And a session start
    And the last assistant error is "timeout"
    And the agent settles
    When a chapter-break compact happens with reason "threshold"
    Then setModel was called with "grok-cli/grok-4.6"
    And continue count is 1
    And preferred is still "grok-cli/grok-4.6"
    And the remaining failover budget is 1

  Scenario: overflow willRetry stays on fallback
    Given attach with retryAfterTools false
    And a session start
    And the last assistant error is "timeout"
    And the agent settles
    When overflow compact willRetry is true
    Then the current model is "xai/grok-4.6"
    And continue count is 1
    And the remaining failover budget is 0

  Scenario: quota after overflow still failovers
    Given attach with retryAfterTools false
    And a session start
    And overflow compact willRetry is true
    And the last assistant error is "usage balance exhausted"
    When the agent settles
    Then setModel was called with "xai/grok-4.6"
    And continue was sent once

  Scenario: setModel false skips candidate and tries next
    Given a three-model registry "grok-cli/grok-4.6, xai/grok-4.6, openrouter/other"
    And a three-model grok chain with budget 1
    And attach with retryAfterTools false
    And a session start
    And setModel for "xai/grok-4.6" returns false
    And the last assistant error is "timeout"
    When the agent settles
    Then setModel was called with "xai/grok-4.6"
    And setModel was called with "openrouter/other"
    And continue was sent once
    And the remaining failover budget is 0

  Scenario: setModel throw skips candidate and tries next
    Given a three-model registry "grok-cli/grok-4.6, xai/grok-4.6, openrouter/other"
    And a three-model grok chain with budget 1
    And attach with retryAfterTools false
    And a session start
    And setModel for "xai/grok-4.6" throws
    And the last assistant error is "timeout"
    When the agent settles
    Then setModel was called with "openrouter/other"
    And continue was sent once
    And the remaining failover budget is 0

  Scenario: in-flight settle does not double continue
    Given attach with retryAfterTools false
    And a session start
    And setModel re-enters agent_settled
    And the last assistant error is "timeout"
    When the agent settles
    Then continue was sent once

  Scenario: continue throw does not decrement budget
    Given attach with retryAfterTools false
    And a session start
    And sendUserMessage throws
    And the last assistant error is "timeout"
    When the agent settles
    Then the remaining failover budget is 1
    And the current model is "xai/grok-4.6"

  Scenario: missing config never setModels
    Given attach with a missing config file
    And a session start
    And the last assistant error is "timeout"
    When the agent settles
    Then setModel was not called

  Scenario: settle without assistant error does not failover
    Given attach with retryAfterTools false
    And a session start
    When the agent settles
    Then setModel was not called
    And toolsThisTurn is false

  Scenario: aborted settle does not failover
    Given attach with retryAfterTools false
    And a session start
    And the last assistant was aborted
    When the agent settles
    Then setModel was not called
    And continue was not sent
    And a skip event has reason "not-failover-worthy" and class "aborted"

  Scenario: overflow without retry restores preferred
    Given attach with retryAfterTools false
    And a session start
    And the last assistant error is "timeout"
    And the agent settles
    When overflow compact willRetry is false
    Then setModel was called with "grok-cli/grok-4.6"
    And continue count is 1
    And preferred is still "grok-cli/grok-4.6"
    And the remaining failover budget is 1

  Scenario: manual compact restores preferred
    Given attach with retryAfterTools false
    And a session start
    And the last assistant error is "timeout"
    And the agent settles
    When a chapter-break compact happens with reason "manual"
    Then setModel was called with "grok-cli/grok-4.6"
    And continue count is 1
    And preferred is still "grok-cli/grok-4.6"

  Scenario: not idle skips failover
    Given attach with retryAfterTools false
    And a session start
    And the host is not idle
    And the last assistant error is "timeout"
    When the agent settles
    Then setModel was not called
    And continue was not sent

  Scenario: observer model not in chain does not failover
    Given a fake host on "openrouter/z-ai/glm-5.3" with thinking "low"
    And the registry includes "openrouter/z-ai/glm-5.3" and "xai/grok-4.6"
    And the live grok chain config with budget 1
    And attach with retryAfterTools true
    And a session start
    And the last assistant error is "timeout"
    When the agent settles
    Then setModel was not called

  Scenario: print mode waits for the continue turn to finish
    Given the host is print mode
    And attach with retryAfterTools false
    And a session start
    And the last assistant error is "usage balance exhausted"
    When the agent settles
    Then setModel was called with "xai/grok-4.6"
    And continue was sent once
    And the host is idle

  Scenario: failover emits an event and does not notify
    Given the host has UI
    And attach with retryAfterTools false
    And a session start
    And the last assistant error is "usage balance exhausted"
    When the agent settles
    Then a failover event was emitted
    And no warning was notified
