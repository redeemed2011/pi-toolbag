Feature: Return to the preferred model
  The continue retry stays on the fallback.
  A later prompt returns only when percent is at least 20 points under the cap.
  A return is setModel only and resets the failover budget.
  A 402 does not return while the cap still holds.

  Background:
    Given a fake host on "grok-cli/grok-4.6" with thinking "low"
    And the registry includes "grok-cli/grok-4.6" and "xai/grok-4.6"
    And the live grok chain config with budget 1

  Scenario: 70 percent returns after a usage hop
    Given a grok percent gate at 90 on provider "grok-cli"
    And usage reads 92
    And attach with retryAfterTools false
    And a session start
    When the user prompt starts
    Then the current model is "xai/grok-4.6"
    Given usage reads 70
    When the user prompt starts
    Then the current model is "grok-cli/grok-4.6"
    And continue was not sent
    And the remaining failover budget is 1
    And preferred is still "grok-cli/grok-4.6"
    And a usage-return event went to "grok-cli/grok-4.6"
    And setModel call count is 2

  Scenario: 70.4 percent rounds and returns
    Given a grok percent gate at 90 on provider "grok-cli"
    And usage reads 92
    And attach with retryAfterTools false
    And a session start
    When the user prompt starts
    Given usage reads 70.4
    When the user prompt starts
    Then the current model is "grok-cli/grok-4.6"
    And a usage-return event went to "grok-cli/grok-4.6"

  Scenario: 71 percent stays on the fallback
    Given a grok percent gate at 90 on provider "grok-cli"
    And usage reads 92
    And attach with retryAfterTools false
    And a session start
    When the user prompt starts
    Given usage reads 71
    When the user prompt starts
    Then the current model is "xai/grok-4.6"
    And continue was not sent
    And setModel call count is 1

  Scenario: a failed return probe stays
    Given a grok percent gate at 90 on provider "grok-cli"
    And usage reads 92
    And attach with retryAfterTools false
    And a session start
    When the user prompt starts
    Given usage is unavailable because "fetch-failed"
    When the user prompt starts
    Then the current model is "xai/grok-4.6"
    And a usage-skip event has reason "unavailable"
    And setModel call count is 1

  Scenario: the continue retry is not switched back
    Given attach with retryAfterTools false
    And a session start
    And the last assistant error is "usage balance exhausted"
    When the agent settles
    Then continue was sent once
    And the current model is "xai/grok-4.6"
    When the user prompt starts
    Then the current model is "xai/grok-4.6"
    And continue count is 1
    When the user prompt starts
    Then the current model is "grok-cli/grok-4.6"
    And continue count is 1
    And the remaining failover budget is 1
    And a usage-return event went to "grok-cli/grok-4.6"

  Scenario: a 402 does not return while the cap still holds
    Given a grok percent gate at 90 on provider "grok-cli"
    And usage reads 85
    And attach with retryAfterTools false
    And a session start
    When the user prompt starts
    Then setModel was not called
    Given the last assistant error is "usage balance exhausted"
    When the agent settles
    Then continue was sent once
    And the current model is "xai/grok-4.6"
    And the remaining failover budget is 0
    When the user prompt starts
    Then the current model is "xai/grok-4.6"
    And continue count is 1
    When the user prompt starts
    Then the current model is "xai/grok-4.6"
    And the remaining failover budget is 0
    And continue count is 1

  Scenario: a 402 returns once usage is 20 points under
    Given a grok percent gate at 90 on provider "grok-cli"
    And usage reads 85
    And attach with retryAfterTools false
    And a session start
    When the user prompt starts
    Given the last assistant error is "usage balance exhausted"
    When the agent settles
    When the user prompt starts
    Given usage reads 70
    When the user prompt starts
    Then the current model is "grok-cli/grok-4.6"
    And continue count is 1
    And the remaining failover budget is 1
    And a usage-return event went to "grok-cli/grok-4.6"

  Scenario: a prompt that starts inside continue is not switched back
    Given sendUserMessage starts the next prompt
    And attach with retryAfterTools false
    And a session start
    And the last assistant error is "usage balance exhausted"
    When the agent settles
    Then the current model is "xai/grok-4.6"
    And continue was sent once
    When the user prompt starts
    Then the current model is "grok-cli/grok-4.6"
    And continue count is 1
    And a usage-return event went to "grok-cli/grok-4.6"

  Scenario: compact does not restore while usage is not 20 points under
    Given a grok percent gate at 90 on provider "grok-cli"
    And usage reads 85
    And attach with retryAfterTools false
    And a session start
    When the user prompt starts
    Given the last assistant error is "usage balance exhausted"
    When the agent settles
    When a chapter-break compact happens with reason "manual"
    Then the current model is "xai/grok-4.6"
    And continue count is 1
    And setModel call count is 1
    And a usage-skip event has reason "usage-held"

  Scenario: compact restores once usage is 20 points under
    Given a grok percent gate at 90 on provider "grok-cli"
    And usage reads 85
    And attach with retryAfterTools false
    And a session start
    When the user prompt starts
    Given the last assistant error is "usage balance exhausted"
    When the agent settles
    Given usage reads 70
    When a chapter-break compact happens with reason "manual"
    Then the current model is "grok-cli/grok-4.6"
    And continue count is 1

  Scenario: a failed return probe stays through compact
    Given a grok percent gate at 90 on provider "grok-cli"
    And usage reads 92
    And attach with retryAfterTools false
    And a session start
    When the user prompt starts
    Given usage is unavailable because "fetch-failed"
    When the user prompt starts
    When a chapter-break compact happens with reason "manual"
    Then the current model is "xai/grok-4.6"
    And setModel call count is 1
    And a usage-skip event has reason "unavailable"
