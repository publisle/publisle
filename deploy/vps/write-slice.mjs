import { writeFileSync } from "node:fs";
import { sliceUnit, thisHostBudget } from "./budget.mjs";

const [slicePath, budgetPath] = process.argv.slice(2);
if (!slicePath || !budgetPath) {
  console.error("usage: node write-slice.mjs <slice-unit> <budget-json>");
  process.exit(1);
}
const budget = thisHostBudget();
writeFileSync(slicePath, sliceUnit(budget));
writeFileSync(budgetPath, `${JSON.stringify(budget, null, 2)}\n`);
console.log(JSON.stringify(budget));
