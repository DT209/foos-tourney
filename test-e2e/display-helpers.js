// Selectors and helpers shared by display.e2e.js and display-scroll.e2e.js.
// getApp returns the test's current app (each file keeps its own).

module.exports = getApp => {
  const BOARD = '[data-testid="display-board"]';
  const PHONE = { width: 390, height: 844 };
  const TV = { width: 1920, height: 1080 };

  const tables = () =>
    getApp().page.$$eval('[data-testid="display-table"]', els =>
      els.map(e => ({ table: e.dataset.table, live: e.dataset.live === 'true', text: e.textContent }))
    );
  const boxOf = (page, sel) => page.$eval(sel, e => e.getBoundingClientRect().toJSON());

  return { BOARD, PHONE, TV, tables, boxOf };
};
