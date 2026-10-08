Feature: Extract last assistant error from the session branch
  Production extract never fills status. It copies rawStopReason. Classify from that token and the error text.

  Scenario Outline: extract text-only quota wording
    Given a branch whose last assistant error is "<text>"
    When I extract the last assistant error
    Then the extracted text is "<text>"
    And the extracted status is unset
    And classifying the extracted error yields "quota"

    Examples:
      | text                    |
      | usage balance exhausted |
      | 402                     |
      | HTTP 402                |

  Scenario: empty errorMessage does not invent a status
    Given a branch whose last assistant error is ""
    When I extract the last assistant error
    Then the extracted text is ""
    And the extracted status is unset
    And classifying the extracted error yields "other"

  Scenario: aborted assistant is extracted as aborted
    Given a branch whose last assistant was aborted
    When I extract the last assistant error
    Then the extracted stop reason is "aborted"

  Scenario: last assistant without error is ignored
    Given a branch whose last assistant completed
    When I extract the last assistant error
    Then there is no extracted error

  Scenario: raw stop reason is copied and status stays unset
    Given a branch whose last assistant error is "The model refused to complete the request" with raw stop reason "refusal"
    When I extract the last assistant error
    Then the extracted text is "The model refused to complete the request"
    And the extracted status is unset
    And the extracted raw stop reason is "refusal"
    And classifying the extracted error yields "safety"

  Scenario: a completed assistant is ignored even with a raw stop reason
    Given a branch whose last assistant completed with raw stop reason "refusal"
    When I extract the last assistant error
    Then there is no extracted error
