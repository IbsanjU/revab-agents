import { Given, When, Then } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import type { QeWorld } from "../support/world.js";
import { HomePage } from "../pages/home.page.js";

Given("I open the home page", async function (this: QeWorld) {
  await new HomePage(this.page).goto(this.baseUrl);
});

When("I navigate to {string}", async function (this: QeWorld, path: string) {
  await this.page.goto(new URL(path, this.baseUrl).toString());
});

Then("the page title contains {string}", async function (this: QeWorld, expected: string) {
  await expect(this.page).toHaveTitle(new RegExp(expected, "i"));
});

Then("I see a heading containing {string}", async function (this: QeWorld, expected: string) {
  await expect(this.page.getByRole("heading", { name: new RegExp(expected, "i") }).first()).toBeVisible();
});
