Feature: Classify settled assistant errors
  Failover-worthy is quota or transient only. Auth, invalid model, overflow, aborted, and unmatched text are not.

  Scenario Outline: classify from text
    Given an error with text "<text>" and stop reason "error"
    When I classify the error
    Then the class is "<class>"
    And failover worthy is <worthy>

    Examples:
      | text                       | class         | worthy |
      | usage balance exhausted    | quota         | true   |
      | HTTP 402                   | quota         | true   |
      | 402                        | quota         | true   |
      | insufficient_quota         | quota         | true   |
      | 429 rate limit             | transient     | true   |
      | timeout                    | transient     | true   |
      | origin_response_timeout    | transient     | true   |
      | error 524                  | transient     | true   |
      | unauthorized               | auth          | false  |
      | invalid api key            | auth          | false  |
      | forbidden                  | auth          | false  |
      | available credits          | quota         | true   |
      | monthly spending limit     | quota         | true   |
      | model not found            | invalid-model | false  |
      | context window             | overflow      | false  |
      | prompt too long            | overflow      | false  |
      | nope                       | other         | false  |

  Scenario: 402 status with empty text is quota in the kernel
    Given an error with empty text and status 402
    When I classify the error
    Then the class is "quota"
    And failover worthy is true

  Scenario: status 400 with unmatched text is other
    Given an error with text "nope" and status 400
    When I classify the error
    Then the class is "other"
    And failover worthy is false

  Scenario: aborted stop reason
    Given an error with text "timeout" and stop reason "aborted"
    When I classify the error
    Then the class is "aborted"
    And failover worthy is false

  Scenario: auth beats timeout in the same body
    Given an error with text "unauthorized timeout" and stop reason "error"
    When I classify the error
    Then the class is "auth"
    And failover worthy is false

  Scenario: empty text and no status is other
    Given an error with empty text and no status
    When I classify the error
    Then the class is "other"
    And failover worthy is false

  Scenario: 403 spending limit from OpenAI-compatible providers is quota
    Given an error with text "OpenAI API error (403): 403 Your team has either used all available credits or reached its monthly spending limit" and stop reason "error"
    When I classify the error
    Then the class is "quota"
    And failover worthy is true

  Scenario: bare HTTP 403 without billing or auth wording is other
    Given an error with text "HTTP 403" and stop reason "error"
    When I classify the error
    Then the class is "other"
    And failover worthy is false

  Scenario: 403 status with empty text is other in the kernel
    Given an error with empty text and status 403
    When I classify the error
    Then the class is "other"
    And failover worthy is false
