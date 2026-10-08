Feature: Classify settled assistant errors
  Failover-worthy is quota, transient, or safety. Auth, invalid model, overflow, aborted, and unmatched text are not.

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

  Scenario Outline: provider safety stop is safety
    Given an error with raw stop reason "<raw>"
    When I classify the error
    Then the class is "safety"
    And failover worthy is true

    Examples:
      | raw                         |
      | refusal                     |
      | sensitive                   |
      | content_filtered            |
      | guardrail_intervened        |
      | content_filter              |
      | incomplete.content_filter   |
      | SAFETY                      |
      | PROHIBITED_CONTENT          |
      | BLOCKLIST                   |
      | SPII                        |
      | RECITATION                  |
      | IMAGE_SAFETY                |
      | IMAGE_PROHIBITED_CONTENT    |
      | IMAGE_RECITATION            |

  Scenario Outline: non-safety provider stops stay other
    Given an error with text "Provider stopped with: <raw>" and raw stop reason "<raw>"
    When I classify the error
    Then the class is "other"
    And failover worthy is false

    Examples:
      | raw                       |
      | OTHER                     |
      | LANGUAGE                  |
      | MALFORMED_FUNCTION_CALL   |
      | IMAGE_OTHER               |
      | malformed_model_output    |
      | malformed_tool_use        |
      | network_error             |

  Scenario Outline: safety phrase without a raw stop reason
    Given an error with text "<text>" and stop reason "error"
    When I classify the error
    Then the class is "safety"
    And failover worthy is true

    Examples:
      | text                                                                 |
      | Output blocked by content filtering policy                           |
      | 400 Output blocked by content filtering policy                       |
      | The request was rejected due to inappropriate content                |
      | 403 The request was rejected due to inappropriate content            |
      | guardrail_blocked                                                    |

  Scenario: ordinary refusal prose is not safety
    Given an error with text "I can't help with that." and stop reason "stop"
    When I classify the error
    Then the class is "other"
    And failover worthy is false

  Scenario: reasoning extraction refusal is not safety
    Given an error with raw stop reason "refusal" and category "reasoning_extraction"
    When I classify the error
    Then the class is "other"
    And failover worthy is false

  Scenario: another refusal category is still safety
    Given an error with raw stop reason "refusal" and category "cyber"
    When I classify the error
    Then the class is "safety"
    And failover worthy is true

  Scenario: auth wording beats a safety phrase
    Given an error with text "forbidden The request was rejected due to inappropriate content" and stop reason "error"
    When I classify the error
    Then the class is "auth"
    And failover worthy is false

  Scenario: overflow wording beats a safety phrase
    Given an error with text "prompt too long guardrail_blocked" and stop reason "error"
    When I classify the error
    Then the class is "overflow"
    And failover worthy is false

  Scenario: a safety token beats a transient needle
    Given an error with text "timeout" and raw stop reason "refusal"
    When I classify the error
    Then the class is "safety"
    And failover worthy is true

  Scenario: reasoning extraction stays other even when the text looks transient
    Given an error with text "timeout", raw stop reason "refusal" and category "reasoning_extraction"
    When I classify the error
    Then the class is "other"
    And failover worthy is false

  Scenario: an aborted turn is not safety
    Given an aborted error with raw stop reason "refusal"
    When I classify the error
    Then the class is "aborted"
    And failover worthy is false

  Scenario: quota wording beats a safety phrase
    Given an error with text "billing guardrail_blocked" and stop reason "error"
    When I classify the error
    Then the class is "quota"
    And failover worthy is true

  Scenario: a shorter guardrail word is not safety
    Given an error with text "guardrail" and stop reason "error"
    When I classify the error
    Then the class is "other"
    And failover worthy is false

  Scenario: content filtering without the policy sentence is not safety
    Given an error with text "content filtering policy" and stop reason "error"
    When I classify the error
    Then the class is "other"
    And failover worthy is false

  Scenario Outline: near-miss stop tokens are not safety
    Given an error with raw stop reason "<raw>"
    When I classify the error
    Then the class is "other"
    And failover worthy is false

    Examples:
      | raw                              |
      | Refusal                          |
      | safety                           |
      | content_filters                  |
      | incomplete.content_filter.extra  |
      | guardrail_intervened_extra       |
