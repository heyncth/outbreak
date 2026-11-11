/* debug: home map + lobby start button + play status */
const { chromium } = require("@playwright/test");

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    permissions: ["geolocation"],
    geolocation: { latitude: 16.054407, longitude: 108.202167 },
    serviceWorkers: "block",
  });
  await ctx.addInitScript(() => localStorage.setItem("outbreak_devsim", "1"));
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("PAGEERROR:", e.message.slice(0, 300)));
  p.on("console", (m) => {
    if (m.type() === "error") console.log("CONSOLE:", m.text().slice(0, 300));
  });

  // home
  await p.goto("http://localhost:3000/");
  await p.waitForTimeout(4000);
  console.log("HOME map canvas count:", await p.locator(".maplibregl-canvas").count());
  console.log("HOME gps chip:", await p.getByTestId("gps-chip").textContent());

  // host flow
  await p.getByTestId("nickname-input").fill("DebugHost");
  await p.getByTestId("host-button").click();
  await p.waitForURL(/\/room\/[A-Z2-9]{6}/, { timeout: 30000 });
  const roomCode = new URL(p.url()).pathname.split("/").pop();
  console.log("ROOM:", roomCode);
  await p.getByTestId("roster").locator("li").first().waitFor({ timeout: 20000 });
  await p.waitForTimeout(3000);

  const btn = p.getByTestId("start-match");
  console.log("start visible:", await btn.isVisible().catch(() => false));
  console.log("start enabled:", await btn.isEnabled().catch(() => false));
  console.log("start text:", (await btn.textContent().catch(() => null)) ?? "");
  console.log("lobby header:", (await p.locator("header").first().textContent()) ?? "");
  console.log("body snippet:", ((await p.locator("body").textContent()) ?? "").slice(0, 300));

  // start match
  if (await btn.isEnabled().catch(() => false)) {
    await btn.click();
    await p.waitForURL(/\/play/, { timeout: 30000 });
    await p.waitForTimeout(8000);
    console.log("PLAY status footer:", await p.locator("footer").first().textContent());
    console.log("PLAY map canvas:", await p.locator(".maplibregl-canvas").count());
    console.log("PLAY summary?", await p.getByTestId("match-summary").count());
  }

  await browser.close();
})().catch((e) => {
  console.error("FATAL", e.message);
  process.exit(1);
});
