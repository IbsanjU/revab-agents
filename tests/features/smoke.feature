@smoke @example
Feature: Framework smoke check
  Verifies the Playwright + Cucumber + Allure wiring works end to end.
  Uses BASE_URL env var (defaults to https://playwright.dev).

  Scenario: Home page loads
    Given I open the home page
    Then the page title contains "Playwright"

  Scenario Outline: Section pages load
    When I navigate to "<path>"
    Then I see a heading containing "<heading>"

    Examples:
      | path       | heading      |
      | /docs/intro | Installation |
