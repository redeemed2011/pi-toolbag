Feature: Read a remote usage sample
  The grok-cli source reads SuperGrok weekly percent. It does not refresh tokens.
  An expired access token may use a fresh quota cache. Otherwise the check fails open.

  Scenario: a live grok token reads creditUsagePercent
    Given a grok vault with a live token
    When I read the grok usage gate
    Then the usage value is 92.2
    And the billing request used the grok auth header
    And the usage result does not contain "secret-token"

  Scenario: an expired token uses a fresh weekly cache
    Given a grok vault with an expired token and fresh cache 91
    When I read the grok usage gate
    Then the usage value is 91
    And the billing endpoint was not called

  Scenario: an expired token with a stale cache fails open
    Given a grok vault with an expired token and a stale cache
    When I read the grok usage gate
    Then the usage read failed with "token-expired"
    And the billing endpoint was not called

  Scenario: an https token field is read by path
    Given an http usage endpoint returning 1000 tokens
    When I read the http usage gate
    Then the usage value is 1000
