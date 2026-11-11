import { test, expect, type Page } from "@playwright/test";

async function fillNickname(page: Page, name: string) {
  await page.goto("/");
  await page.getByTestId("nickname-input").fill(name);
  await expect(page.getByTestId("host-button")).toBeEnabled();
}

test("host create → guest join → start → knock → rescue → end → summary", async ({
  browser,
}) => {
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  // forceKnock hook reads runtime localStorage flag (no env)
  await hostCtx.addInitScript(() => localStorage.setItem("outbreak_devsim", "1"));
  await guestCtx.addInitScript(() => localStorage.setItem("outbreak_devsim", "1"));
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  await fillNickname(host, "HostAlice");
  await host.getByTestId("host-button").click();
  await host.waitForURL(/\/room\/[A-Z2-9]{6}/, { timeout: 30_000 });
  const roomCode = new URL(host.url()).pathname.split("/").pop()!;
  expect(roomCode).toMatch(/^[A-Z2-9]{6}$/);

  await fillNickname(guest, "GuestBob");
  await guest.getByTestId("room-code-input").fill(roomCode);
  await guest.getByTestId("join-button").click();
  await guest.waitForURL(new RegExp(`/room/${roomCode}$`), { timeout: 30_000 });

  await expect(host.getByTestId("roster").locator("li")).toHaveCount(2, { timeout: 20_000 });
  await expect(guest.getByTestId("roster").locator("li")).toHaveCount(2, { timeout: 20_000 });
  await expect(host.getByTestId("start-match")).toBeVisible();

  await host.getByTestId("start-match").click();
  await host.waitForURL(/\/play/, { timeout: 30_000 });

  // guest lobby flips WAITING→ACTIVE via poll/broadcast, then shows Enter Match
  const enter = guest.getByRole("button", { name: "Enter Match" });
  await expect(enter).toBeVisible({ timeout: 30_000 });
  await enter.click();
  await guest.waitForURL(/\/play/, { timeout: 30_000 });

  await expect(host.getByTestId("match-timer")).toBeVisible({ timeout: 20_000 });
  await expect(guest.getByTestId("match-timer")).toBeVisible({ timeout: 20_000 });
  // worker ready (graph fetch burns up to 10s budget when Overpass unreachable)
  await expect(host.locator("footer")).toContainText(/zombies[: ]+[1-9]\d*/i, {
    timeout: 30_000,
  });

  // host force-knocks self via dev hook (DevSim build)
  await host.evaluate(() => {
    const w = window as unknown as {
      __outbreak?: { forceKnock: (id?: string) => void };
    };
    w.__outbreak?.forceKnock();
  });
  await expect(host.getByTestId("knocked-overlay")).toBeVisible({ timeout: 10_000 });

  // guest holds rescue 3s+
  const rescue = guest.getByTestId("rescue-hold");
  await expect(rescue).toBeVisible({ timeout: 10_000 });
  await rescue.dispatchEvent("pointerdown");
  await guest.waitForTimeout(3500);
  await rescue.dispatchEvent("pointerup");

  await expect(host.getByTestId("knocked-overlay")).toBeHidden({ timeout: 10_000 });

  await host.getByTestId("end-match").click();
  await host.getByTestId("confirm-end").click();
  await expect(host.getByTestId("match-summary")).toBeVisible({ timeout: 15_000 });
  await expect(host.getByTestId("summary-stats")).toBeVisible();

  await hostCtx.close();
  await guestCtx.close();
});
