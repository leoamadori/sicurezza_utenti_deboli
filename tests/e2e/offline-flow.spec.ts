import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const DOMAINS_6 = [
  "dooring",
  "lateral_distance",
  "hazard_perception",
  "adas",
  "planning_rush",
  "self_control",
] as const;

const DOMAINS_5 = [
  "dooring",
  "lateral_distance",
  "hazard_perception",
  "planning_rush",
  "self_control",
] as const;

async function waitForServiceWorkerControl(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(async () => {
    if ("serviceWorker" in navigator) {
      await navigator.serviceWorker.ready;
    }
  });
  await page.reload();
  const hasController = await page.evaluate(
    () => Boolean(navigator.serviceWorker && navigator.serviceWorker.controller),
  );
  expect(hasController).toBe(true);
}

function readPngDimensions(buffer: Buffer): { width: number; height: number } {
  // Verify PNG signature (89 50 4E 47 0D 0A 1A 0A)
  expect(buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(
    true,
  );
  // IHDR width at bytes 16..19, height at bytes 20..23 (big-endian uint32)
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { width, height };
}

test.describe("VRU PWA — Mobile 390x844 Offline E2E Flows", () => {
  test("CUJ 1, CUJ 2 (ADAS N/A), CUJ 5 (blind lock + reload + goBack + modal override), PNG IHDR, and CUJ 4 (Coordinator JSON dedup + CSV)", async ({
    page,
    context,
  }) => {
    // 1. Precache SW and switch fully offline
    await waitForServiceWorkerControl(page);
    await context.setOffline(true);

    // Verify cold reload works completely offline
    await page.reload();
    await expect(page.getByRole("heading", { name: "Valutazione Istruttore" })).toBeVisible();

    // --- SESSION 1 (CUJ 1 + CUJ 5): 6 domains, IDONEO, blind lock checks ---
    for (const d of DOMAINS_6) {
      await page.getByTestId(`instructor-${d}-4`).click();
    }
    await page.getByTestId("rf-RF01-no").click();
    await page.getByTestId("rf-RF02-no").click();
    await page.getByTestId("rf-RF03-no").click();

    await page.getByTestId("btn-enter-handover").click();
    await expect(page.getByText("Valutazione istruttore nascosta")).toBeVisible();

    // Instructor cancels handover before handing phone, then re-enters
    await page.getByTestId("btn-cancel-handover").click();
    await expect(page.getByRole("heading", { name: "Valutazione Istruttore" })).toBeVisible();
    await page.getByTestId("btn-enter-handover").click();
    await page.getByTestId("btn-start-student").click();

    // Verify CUJ 5: Instructor scores & Red Flags are NOT in DOM during STUDENT_SELF_EVAL
    await expect(page.getByRole("heading", { name: "Autovalutazione Allievo" })).toBeVisible();
    await expect(page.locator('[data-testid^="instructor-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="rf-"]')).toHaveCount(0);
    await expect(page.getByText("RF-01")).toHaveCount(0);

    // Partial answer + cold reload offline -> restores STUDENT_SELF_EVAL & blocks goBack()
    await page.getByTestId("student-dooring-5").click();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Autovalutazione Allievo" })).toBeVisible();
    await expect(page.getByTestId("student-dooring-5")).toHaveAttribute("aria-pressed", "true");

    await page.goBack();
    await expect(page.getByRole("heading", { name: "Autovalutazione Allievo" })).toBeVisible();

    // Test 2-step in-app modal override back to instructor, then return to student
    await page.getByTestId("btn-override-instructor").click();
    await page.getByRole("button", { name: "Continua (Passo 1 di 2)" }).click();
    await page.getByRole("button", { name: "Torna alla vista istruttore (Passo 2 di 2)" }).click();
    await expect(page.getByRole("heading", { name: "Valutazione Istruttore" })).toBeVisible();

    // Resume student self-eval (partial dooring=5 preserved)
    await page.getByTestId("btn-enter-handover").click();
    await page.getByTestId("btn-start-student").click();
    await expect(page.getByTestId("student-dooring-5")).toHaveAttribute("aria-pressed", "true");

    for (const d of DOMAINS_6.filter((x) => x !== "dooring")) {
      await page.getByTestId(`student-${d}-4`).click();
    }
    await page.getByTestId("btn-complete-student").click();

    // Handback screen before reveal
    await expect(page.getByText("restituisci il telefono all'istruttore")).toBeVisible();
    await page.getByTestId("btn-reveal-debrief").click();

    await expect(page.getByTestId("outcome-badge")).toHaveText("IDONEO");

    // Set optional RAM-only student label and verify PNG download dimensions (1080 x <=1920)
    await page.locator("#student-label-input").fill("Giulia M.");
    await page.locator("#student-label-input").blur();

    await expect(page.getByTestId("btn-save-png")).toBeEnabled();
    const pngDownloadPromise = page.waitForEvent("download");
    await page.getByTestId("btn-save-png").click();
    const pngDownload = await pngDownloadPromise;
    expect(pngDownload.suggestedFilename()).toMatch(/^valutazione-vru-\d{4}-\d{2}-\d{2}\.png$/);
    const pngPath = await pngDownload.path();
    expect(pngPath).not.toBeNull();
    const pngBuf = readFileSync(pngPath as string);
    const { width, height } = readPngDimensions(pngBuf);
    expect(width).toBe(1080);
    expect(height).toBeLessThanOrEqual(1920);
    expect(height).toBeGreaterThan(600);

    // Verify studentLabel was NEVER stored in localStorage
    const lsDump = await page.evaluate(() => JSON.stringify(window.localStorage));
    expect(lsDump).not.toContain("Giulia M.");

    // Reset session for Session 2
    await page.getByTestId("btn-reset-session").click();
    await expect(page.getByRole("heading", { name: "Valutazione Istruttore" })).toBeVisible();

    // --- SESSION 2 (CUJ 2): ADAS N/A + Red Flag -> IDONEO blocked ---
    await page.locator("#adas-na-toggle").check();
    for (const d of DOMAINS_5) {
      await page.getByTestId(`instructor-${d}-4`).click();
    }
    await page.getByTestId("rf-RF01-yes").click();
    await page.getByTestId("rf-RF02-no").click();
    await page.getByTestId("rf-RF03-no").click();

    await page.getByTestId("btn-enter-handover").click();
    await page.getByTestId("btn-start-student").click();

    // ADAS question must be absent for student
    await expect(page.locator('[data-testid^="student-adas-"]')).toHaveCount(0);
    for (const d of DOMAINS_5) {
      await page.getByTestId(`student-${d}-5`).click();
    }
    await page.getByTestId("btn-complete-student").click();
    await page.getByTestId("btn-reveal-debrief").click();

    // PNG & Reset must be disabled until outcome chosen
    await expect(page.getByTestId("btn-save-png")).toBeDisabled();
    await expect(page.getByTestId("btn-reset-session")).toBeDisabled();
    await page.getByTestId("outcome-select-MODULO_INTEGRATIVO").click();
    await expect(page.getByTestId("outcome-badge")).toHaveText("MODULO INTEGRATIVO");
    await expect(page.getByTestId("btn-save-png")).toBeEnabled();

    // --- CUJ 4: Coordinator View JSON Export, Duplicate Import & CSV Export ---
    await page.getByTestId("nav-coordinator").click();
    await expect(page.getByTestId("local-stats-count")).toHaveText("2");

    const jsonDownloadPromise = page.waitForEvent("download");
    await page.getByTestId("btn-export-stats-json").click();
    const jsonDownload = await jsonDownloadPromise;
    expect(jsonDownload.suggestedFilename()).toMatch(/^statistiche-vru-gruppo-\d{4}-\d{2}\.json$/);
    const jsonPath = await jsonDownload.path();
    expect(jsonPath).not.toBeNull();
    const jsonBytes = readFileSync(jsonPath as string);

    // Upload the SAME file twice to verify deduplication on evaluationId
    await page.getByTestId("coordinator-file-input").setInputFiles([
      {
        name: "export-a.json",
        mimeType: "application/json",
        buffer: jsonBytes,
      },
      {
        name: "export-b-dup.json",
        mimeType: "application/json",
        buffer: jsonBytes,
      },
    ]);

    await expect(page.getByTestId("import-report")).toContainText("Record validi unici: 2");
    await expect(page.getByTestId("import-report")).toContainText("Duplicati rimossi: 2");
    await expect(page.getByTestId("low-sample-warning")).toBeVisible();

    const csvDownloadPromise = page.waitForEvent("download");
    await page.getByTestId("btn-export-csv").click();
    const csvDownload = await csvDownloadPromise;
    expect(csvDownload.suggestedFilename()).toMatch(/^riepilogo-vru-gruppo-\d{4}-\d{2}\.csv$/);
    const csvPath = await csvDownload.path();
    expect(csvPath).not.toBeNull();
    const csvText = readFileSync(csvPath as string, "utf8");
    expect(csvText.startsWith("\uFEFFevaluationId;schemaVersion;")).toBe(true);
    expect(csvText.split("\r\n").filter(Boolean)).toHaveLength(3); // header + 2 unique records
  });
});
