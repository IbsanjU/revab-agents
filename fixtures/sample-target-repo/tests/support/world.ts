import { setWorldConstructor, setDefaultTimeout, Before, After, World, type IWorldOptions } from "@cucumber/cucumber";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";

setDefaultTimeout(60_000);

/**
 * Custom Cucumber world exposing a Playwright page.
 * Base URL comes from BASE_URL env var (defaults to https://playwright.dev for the smoke example).
 */
export class QeWorld extends World {
  browser!: Browser;
  context!: BrowserContext;
  page!: Page;
  readonly baseUrl: string = process.env.BASE_URL ?? "https://playwright.dev";

  constructor(options: IWorldOptions) {
    super(options);
  }

  async open(): Promise<void> {
    this.browser = await chromium.launch({ headless: process.env.HEADED !== "1" });
    this.context = await this.browser.newContext();
    this.page = await this.context.newPage();
  }

  async close(): Promise<void> {
    await this.context?.close();
    await this.browser?.close();
  }
}

setWorldConstructor(QeWorld);

Before(async function (this: QeWorld) {
  await this.open();
});

After(async function (this: QeWorld, { result, pickle }) {
  if (result?.status === "FAILED" && this.page) {
    const screenshot = await this.page.screenshot({ fullPage: true }).catch(() => undefined);
    if (screenshot) {
      this.attach(screenshot, { mediaType: "image/png", fileName: `${pickle.name}.png` });
    }
  }
  await this.close();
});
