import type { Page, Locator } from "@playwright/test";

/** Example page object — one class per page, locators as fields, actions as methods, no assertions. */
export class HomePage {
  readonly searchButton: Locator;
  readonly searchInput: Locator;

  constructor(private readonly page: Page) {
    this.searchButton = page.getByRole("button", { name: "Search" });
    this.searchInput = page.getByPlaceholder("Search docs");
  }

  async goto(baseUrl: string): Promise<void> {
    await this.page.goto(baseUrl);
  }

  async search(term: string): Promise<void> {
    await this.searchButton.click();
    await this.searchInput.fill(term);
  }
}
