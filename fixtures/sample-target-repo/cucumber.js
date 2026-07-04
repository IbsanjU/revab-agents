export default {
  import: ["tests/support/**/*.ts", "tests/steps/**/*.ts"],
  paths: ["tests/features/**/*.feature"],
  format: ["progress", "allure-cucumberjs/reporter"],
  formatOptions: {
    resultsDir: "reports/allure-results",
  },
  publishQuiet: true,
};
