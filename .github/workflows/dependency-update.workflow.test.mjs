// Regression tests for the step ORDER inside
// .github/workflows/dependency-update.yml.
//
// Context: this workflow previously had "Format with updated dependencies"
// (which reads steps.diff.outputs.changed) declared BEFORE the "Check for
// changes" step (id: diff) that actually produces that output. Per the
// GitHub Actions steps context, a step's outputs only become visible to
// later steps once it has run -- so the if condition always evaluated to
// falsy and the format step silently, permanently no-op'd. This file
// guards against that class of bug reappearing (here or in any step that
// references steps.<id>.outputs.*), without needing a live Actions run.
//
// Run with: node --test .github/workflows/dependency-update.workflow.test.mjs
// (repo-hoisted js-yaml is used for parsing; no new dependency required.)

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import yaml from "js-yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW_PATH = path.join(__dirname, "dependency-update.yml");

function loadSteps(yamlText, jobName = "update-and-smoke-test") {
  const doc = yaml.load(yamlText);
  const job = doc.jobs?.[jobName];
  assert.ok(job, `expected job "${jobName}" to exist in workflow`);
  assert.ok(
    Array.isArray(job.steps),
    `expected job "${jobName}" to have a steps array`,
  );
  return job.steps;
}

function findStepOrderViolations(steps) {
  const idToIndex = new Map();
  steps.forEach((step, index) => {
    if (step.id) idToIndex.set(step.id, index);
  });

  const violations = [];
  const stepsRefPattern = /steps\.([A-Za-z0-9_-]+)\.outputs/g;

  steps.forEach((step, index) => {
    const condition = step.if;
    if (typeof condition !== "string") return;

    for (const match of condition.matchAll(stepsRefPattern)) {
      const referencedId = match[1];
      const referencedIndex = idToIndex.get(referencedId);
      const stepLabel = step.name ?? `step[${index}]`;

      if (referencedIndex === undefined) {
        violations.push(
          `"${stepLabel}" condition references steps.${referencedId}.outputs, ` +
            `but no step in this job declares id: ${referencedId}`,
        );
      } else if (referencedIndex >= index) {
        violations.push(
          `"${stepLabel}" (index ${index}) reads steps.${referencedId}.outputs, ` +
            `but the step with id "${referencedId}" is at index ${referencedIndex} ` +
            `(must be strictly earlier)`,
        );
      }
    }
  });

  return violations;
}

describe("dependency-update.yml step ordering", () => {
  test("workflow file parses as valid YAML", () => {
    const text = readFileSync(WORKFLOW_PATH, "utf8");
    assert.doesNotThrow(() => yaml.load(text));
  });

  test("no step reads steps.<id>.outputs before that step has run (real file)", () => {
    const text = readFileSync(WORKFLOW_PATH, "utf8");
    const steps = loadSteps(text);
    const violations = findStepOrderViolations(steps);
    assert.deepEqual(violations, [], violations.join("\n"));
  });

  test("Check for changes (id: diff) precedes Format with updated dependencies", () => {
    const text = readFileSync(WORKFLOW_PATH, "utf8");
    const steps = loadSteps(text);

    const diffIndex = steps.findIndex((s) => s.id === "diff");
    const formatIndex = steps.findIndex(
      (s) => s.name === "Format with updated dependencies",
    );

    assert.notEqual(diffIndex, -1, "expected a step with id: diff to exist");
    assert.notEqual(
      formatIndex,
      -1,
      "expected a Format with updated dependencies step to exist",
    );
    assert.ok(
      diffIndex < formatIndex,
      `expected diff step (index ${diffIndex}) before format step (index ${formatIndex})`,
    );
  });

  test("id: diff is declared exactly once (no ambiguous output source)", () => {
    const text = readFileSync(WORKFLOW_PATH, "utf8");
    const steps = loadSteps(text);
    const diffSteps = steps.filter((s) => s.id === "diff");
    assert.equal(diffSteps.length, 1);
  });

  test("Check for changes step actually sets a changed output on both branches", () => {
    const text = readFileSync(WORKFLOW_PATH, "utf8");
    const steps = loadSteps(text);
    const diffStep = steps.find((s) => s.id === "diff");
    assert.ok(diffStep, "diff step must exist");
    assert.match(diffStep.run, /changed=true/);
    assert.match(diffStep.run, /changed=false/);
  });

  test("Install updated dependencies runs before Check for changes (diff must see the install)", () => {
    const text = readFileSync(WORKFLOW_PATH, "utf8");
    const steps = loadSteps(text);
    const installIndex = steps.findIndex(
      (s) => s.name === "Install updated dependencies",
    );
    const diffIndex = steps.findIndex((s) => s.id === "diff");
    assert.notEqual(installIndex, -1);
    assert.notEqual(diffIndex, -1);
    assert.ok(installIndex < diffIndex);
  });

  test("every downstream quality gate is gated on and ordered after diff", () => {
    const text = readFileSync(WORKFLOW_PATH, "utf8");
    const steps = loadSteps(text);
    const diffIndex = steps.findIndex((s) => s.id === "diff");

    const expectedGatedNames = [
      "Format with updated dependencies",
      "Build shared (required by other packages)",
      "Typecheck backend",
      "Typecheck frontend",
      "Typecheck CLI",
      "Lint",
      "Format check",
      "Build all packages",
      "Test backend",
      "Test frontend",
      "Security audit (production)",
      "Open pull request",
    ];

    for (const name of expectedGatedNames) {
      const index = steps.findIndex((s) => s.name === name);
      assert.notEqual(index, -1, `expected a step named "${name}" to exist`);
      assert.equal(
        steps[index].if,
        "steps.diff.outputs.changed == 'true'",
        `expected "${name}" to be gated on steps.diff.outputs.changed`,
      );
      assert.ok(
        index > diffIndex,
        `expected "${name}" (index ${index}) to run after diff (index ${diffIndex})`,
      );
    }
  });

  test("regression guard: detector flags the original pre-fix bug when format precedes diff", () => {
    const buggySteps = [
      {
        name: "Format with updated dependencies",
        if: "steps.diff.outputs.changed == 'true'",
        run: "npm run fmt",
      },
      {
        name: "Check for changes",
        id: "diff",
        run: "echo changed=true >> $GITHUB_OUTPUT\necho changed=false >> $GITHUB_OUTPUT",
      },
    ];

    const violations = findStepOrderViolations(buggySteps);
    assert.equal(violations.length, 1);
    assert.match(violations[0], /Format with updated dependencies/);
    assert.match(violations[0], /steps\.diff\.outputs/);
  });

  test("edge case: a step referencing a nonexistent id is flagged, not silently ignored", () => {
    const stepsWithTypo = [
      {
        name: "Uses a typo id",
        if: "steps.dfif.outputs.changed == 'true'",
        run: "echo hi",
      },
      {
        name: "Check for changes",
        id: "diff",
        run: "echo changed=true >> $GITHUB_OUTPUT",
      },
    ];

    const violations = findStepOrderViolations(stepsWithTypo);
    assert.equal(violations.length, 1);
    assert.match(violations[0], /no step in this job declares id: dfif/);
  });

  test("edge case: a step referencing its own id is flagged as a self-reference", () => {
    const selfReferencing = [
      {
        name: "Self-referencing step",
        id: "self",
        if: "steps.self.outputs.changed == 'true'",
        run: "echo hi",
      },
    ];

    const violations = findStepOrderViolations(selfReferencing);
    assert.equal(violations.length, 1);
    assert.match(violations[0], /must be strictly earlier/);
  });

  test("edge case: two steps correctly gated on the same earlier id produce no violations", () => {
    const validSteps = [
      {
        name: "Check for changes",
        id: "diff",
        run: "echo changed=true >> $GITHUB_OUTPUT",
      },
      {
        name: "Gate A",
        if: "steps.diff.outputs.changed == 'true'",
        run: "echo a",
      },
      {
        name: "Gate B",
        if: "steps.diff.outputs.changed == 'true'",
        run: "echo b",
      },
    ];

    assert.deepEqual(findStepOrderViolations(validSteps), []);
  });

  test("edge case: steps with no if condition at all are ignored by the checker", () => {
    const noConditionSteps = [{ name: "Always runs", run: "echo hi" }];
    assert.deepEqual(findStepOrderViolations(noConditionSteps), []);
  });
});
