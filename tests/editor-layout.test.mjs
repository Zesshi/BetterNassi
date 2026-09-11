import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const url = process.env.EDITOR_URL || "http://localhost:3000";
const action = (id, kind = "action", note = "") => ({ id, kind, label: id, note });
const fixture = {
  title: "Order validation",
  blocks: [{
    id: "decision", kind: "decision", label: "Is the order valid?", note: "",
    thenBranch: [action("Calculate subtotal"), {
      id: "loop", kind: "loop", label: "For each item", note: "",
      body: [action("Update inventory")],
    }],
    elseBranch: [action("Read input", "io"), action("Log the issue", "io"), action("Notify customer")],
  }],
};

test("diagram geometry, nested drag targets, themes, persistence and export", async () => {
  const browser = await chromium.launch({ channel: process.env.EDITOR_BROWSER || (process.platform === "win32" ? "msedge" : undefined), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url);
    await page.waitForSelector(".root-list");
    await page.evaluate((diagram) => {
      localStorage.setItem("betternassi-diagram", JSON.stringify(diagram));
      localStorage.setItem("betternassi-theme", "light");
    }, fixture);
    await page.reload();
    await page.getByText("Update inventory", { exact: true }).waitFor();
    await mkdir("test-results", { recursive: true });
    await page.locator(".paper-title").getByRole("textbox", { name: "Diagram name" }).fill("Stock validation");
    await page.getByRole("textbox", { name: "Diagram name" }).press("Enter");
    assert.equal(await page.locator(".workspace-toolbar").count(), 0);
    assert.equal(await page.locator(".palette-panel input[aria-label='Canvas zoom']").count(), 1);
    await page.reload();
    await page.waitForFunction(() => document.querySelector("textarea[aria-label='Diagram name']").value === "Stock validation");

    const geometry = await page.evaluate(() => {
      const decision = document.querySelector(".nassi-block.decision");
      const columns = [...decision.querySelectorAll(":scope > .decision-branches > .branch-column")];
      const rect = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height }; };
      return {
        columns: columns.map(rect),
        left: [...columns[0].querySelectorAll(".simple-block-content, .loop-head")].map(rect),
        right: [...columns[1].querySelectorAll(".simple-block-content")].map(rect),
        borders: [...document.querySelectorAll(".nassi-block")].map((el) => getComputedStyle(el).borderTopWidth),
      };
    });
    assert.ok(Math.abs(geometry.columns[0].height - geometry.columns[1].height) < 1);
    geometry.left.forEach((row, i) => {
      assert.ok(Math.abs(row.bottom - geometry.right[i].bottom) <= 1, "branch row bottoms align");
    });
    assert.ok(geometry.borders.every((border) => parseFloat(border) <= 1));
    await page.screenshot({ path: "test-results/editor-light.png", fullPage: true });

    const transfer = await page.evaluateHandle(() => new DataTransfer());
    await page.locator(".palette-item.io").dispatchEvent("dragstart", { dataTransfer: transfer });
    const target = page.getByText("Update inventory", { exact: true });
    const bounds = await target.boundingBox();
    const before = await page.locator(".diagram-paper").boundingBox();
    await target.dispatchEvent("dragover", { dataTransfer: transfer, clientX: bounds.x + 20, clientY: bounds.y + bounds.height - 2 });
    const after = await page.locator(".diagram-paper").boundingBox();
    assert.equal(after.height, before.height, "hover must never expand the diagram");
    assert.ok(await page.locator(".insert-after, .insert-before").count() > 0);
    await target.dispatchEvent("drop", { dataTransfer: transfer, clientX: bounds.x + 20, clientY: bounds.y + bounds.height - 2 });
    assert.equal(await page.locator(".loop-body .io").count(), 1, "drop enters the loop");

    const moved = page.locator(".loop-body .io");
    const move = await page.evaluateHandle(() => new DataTransfer());
    await moved.dispatchEvent("dragstart", { dataTransfer: move });
    const destination = page.getByText("Notify customer", { exact: true });
    const dest = await destination.boundingBox();
    await destination.dispatchEvent("dragover", { dataTransfer: move, clientX: dest.x + 15, clientY: dest.y + dest.height });
    await destination.dispatchEvent("drop", { dataTransfer: move, clientX: dest.x + 15, clientY: dest.y + dest.height });
    assert.equal(await page.locator(".loop-body .io").count(), 0);
    assert.equal(await page.locator(".decision-branches > .branch-column:nth-child(2) .io").count(), 3);

    await page.getByRole("button", { name: "Dark theme", exact: true }).click();
    await page.screenshot({ path: "test-results/editor-dark.png", fullPage: true, animations: "disabled" });
    const downloadPromise = page.waitForEvent("download");
    await page.evaluate(() => {
      window.exportedText = [];
      const original = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (...args) {
        window.exportedText.push(args[0]);
        return original.apply(this, args);
      };
    });
    await page.getByRole("button", { name: "Export PNG", exact: true }).click();
    const download = await downloadPromise;
    await download.saveAs("test-results/diagram.png");
    assert.equal(await download.failure(), null);
    const exportedText = await page.evaluate(() => window.exportedText);
    assert.ok(exportedText.includes("True"), "True is exported as a complete single-line label");
    assert.ok(exportedText.includes("False"), "False is exported as a complete single-line label");
    const png = await readFile("test-results/diagram.png");
    const imageCheck = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = "data:image/png;base64," + base64;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);
      return { width: image.width, expectedWidth: document.querySelector(".diagram-paper").offsetWidth * 2, pixel: [...ctx.getImageData(5, 5, 1, 1).data] };
    }, png.toString("base64"));
    assert.ok(Math.abs(imageCheck.width - imageCheck.expectedWidth) <= 1, "export uses the actual diagram dimensions");
    assert.deepEqual(imageCheck.pixel, [40, 42, 48, 255], "export preserves the dark diagram background");

    await page.setViewportSize({ width: 900, height: 800 });
    await page.getByText("Calculate subtotal", { exact: true }).click();
    await page.locator(".inspector-panel.drawer-open").waitFor({ state: "visible" });
    const workspaceBounds = await page.locator(".workspace-panel").boundingBox();
    const inspectorBounds = await page.locator(".inspector-panel").boundingBox();
    assert.ok(workspaceBounds.x + workspaceBounds.width <= inspectorBounds.x + 1, "docked inspector never overlays the canvas");
    await page.screenshot({ path: "test-results/editor-drawer.png", fullPage: true });
    await page.getByRole("button", { name: "Close inspector", exact: true }).click();
    await page.reload();
    await page.getByText("Update inventory", { exact: true }).waitFor();
    assert.equal(await page.locator(".decision-branches > .branch-column:nth-child(2) .io").count(), 3);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "test-results/editor-mobile.png", fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.getByText("Calculate subtotal", { exact: true }).click();
    const mobileWorkspace = await page.locator(".workspace-panel").boundingBox();
    const mobileInspector = await page.locator(".inspector-panel").boundingBox();
    assert.ok(mobileWorkspace.y + mobileWorkspace.height <= mobileInspector.y + 1, "mobile inspector docks below the canvas");
    await page.getByRole("button", { name: "Close inspector", exact: true }).click();
    await page.setViewportSize({ width: 900, height: 800 });
    await page.getByRole("button", { name: "Light theme", exact: true }).click();
    const nativeBefore = await page.locator(".loop-body > .block-list > .nassi-block").count();
    await page.locator(".palette-item.action").dragTo(page.locator(".loop-head"), { targetPosition: { x: 80, y: 35 } });
    assert.equal(await page.locator(".loop-body > .block-list > .nassi-block").count(), nativeBefore + 1, "native drag enters loop through its header");
    assert.equal(await page.locator(".inspector-panel.drawer-open").count(), 0, "dropping on a small screen does not open the inspector");

    const nestedTransfer = await page.evaluateHandle(() => new DataTransfer());
    await page.locator(".palette-item.decision").dispatchEvent("dragstart", { dataTransfer: nestedTransfer });
    const loopHead = page.locator(".loop-head");
    const loopRect = await loopHead.boundingBox();
    await loopHead.dispatchEvent("drop", { dataTransfer: nestedTransfer, clientX: loopRect.x + 80, clientY: loopRect.y + 35 });
    assert.equal(await page.locator(".loop-body .decision-head").count(), 1);
    const nestedLayout = await page.evaluate(() => [...document.querySelectorAll(".decision-branches")].map((branches) => {
      const [left, right] = branches.children;
      return Math.abs(left.getBoundingClientRect().bottom - right.getBoundingClientRect().bottom);
    }));
    assert.ok(nestedLayout.every((difference) => difference < 1), "nested decisions keep their branch bottoms aligned");

    const scrollTransfer = await page.evaluateHandle(() => new DataTransfer());
    await page.locator(".palette-item.action").dispatchEvent("dragstart", { dataTransfer: scrollTransfer });
    await page.waitForFunction(() => document.querySelector(".canvas-viewport").scrollHeight > document.querySelector(".canvas-viewport").clientHeight);
    const viewport = await page.locator(".canvas-viewport").boundingBox();
    await page.locator(".canvas-viewport").dispatchEvent("dragover", { dataTransfer: scrollTransfer, clientX: viewport.x + 50, clientY: viewport.y + viewport.height - 5 });
    await page.waitForFunction(() => document.querySelector(".canvas-viewport").scrollTop > 0);
    await page.locator(".palette-item.action").dispatchEvent("dragend", { dataTransfer: scrollTransfer });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
