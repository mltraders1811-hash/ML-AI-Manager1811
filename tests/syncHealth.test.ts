import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "../src/lib/prisma";
import { getSyncHealth } from "../src/lib/syncHealth";

const COMPANY_ID = process.env.DEFAULT_COMPANY_ID!;

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 3_600_000);
}

describe("syncHealth", () => {
  beforeEach(async () => {
    await prisma.company.upsert({
      where: { id: COMPANY_ID },
      update: {},
      create: { id: COMPANY_ID, name: "Test Co" },
    });
    await prisma.syncRun.deleteMany({ where: { companyId: COMPANY_ID } });
  });

  afterAll(async () => {
    await prisma.syncRun.deleteMany({ where: { companyId: COMPANY_ID } });
    await prisma.$disconnect();
  });

  it("warns when no sync has ever run", async () => {
    const health = await getSyncHealth(COMPANY_ID);
    expect(health.status).toBe("never");
    expect(health.warning).toBeTruthy();
  });

  it("stays quiet after a recent success", async () => {
    await prisma.syncRun.create({
      data: { companyId: COMPANY_ID, startedAt: hoursAgo(2), finishedAt: hoursAgo(2), status: "SUCCESS" },
    });
    const health = await getSyncHealth(COMPANY_ID);
    expect(health.status).toBe("ok");
    expect(health.warning).toBeNull();
  });

  it("tolerates one missed daily run without crying wolf", async () => {
    // The job runs every 24h; a single skipped day shouldn't alarm anyone.
    await prisma.syncRun.create({
      data: { companyId: COMPANY_ID, startedAt: hoursAgo(30), finishedAt: hoursAgo(30), status: "SUCCESS" },
    });
    const health = await getSyncHealth(COMPANY_ID);
    expect(health.status).toBe("ok");
  });

  it("flags data as stale once two runs in a row are missed", async () => {
    await prisma.syncRun.create({
      data: { companyId: COMPANY_ID, startedAt: hoursAgo(50), finishedAt: hoursAgo(50), status: "SUCCESS" },
    });
    const health = await getSyncHealth(COMPANY_ID);
    expect(health.status).toBe("stale");
    expect(health.warning).toContain("No successful sync in 2 days.");
  });

  it("reports a failure even when an older run succeeded", async () => {
    // The figures on screen come from the old success, not from today.
    await prisma.syncRun.create({
      data: { companyId: COMPANY_ID, startedAt: hoursAgo(26), finishedAt: hoursAgo(26), status: "SUCCESS", sourceFileName: "old.vyb" },
    });
    await prisma.syncRun.create({
      data: {
        companyId: COMPANY_ID,
        startedAt: hoursAgo(1),
        finishedAt: hoursAgo(1),
        status: "FAILED",
        errorMessage: "No .vyb backup found in the configured Google Drive folder",
      },
    });
    const health = await getSyncHealth(COMPANY_ID);
    expect(health.status).toBe("failed");
    expect(health.warning).toContain("These figures are from 1 day ago and may be out of date.");
    expect(health.errorMessage).toContain("No .vyb backup found");
    expect(health.sourceFileName).toBe("old.vyb");
  });

  it("says there is nothing to show when every run has failed", async () => {
    await prisma.syncRun.create({
      data: { companyId: COMPANY_ID, startedAt: hoursAgo(1), finishedAt: hoursAgo(1), status: "FAILED", errorMessage: "boom" },
    });
    const health = await getSyncHealth(COMPANY_ID);
    expect(health.status).toBe("failed");
    expect(health.warning).toContain("no sync has ever succeeded");
  });

  it("ignores a still-running sync when judging the last outcome", async () => {
    await prisma.syncRun.create({
      data: { companyId: COMPANY_ID, startedAt: hoursAgo(3), finishedAt: hoursAgo(3), status: "SUCCESS" },
    });
    await prisma.syncRun.create({ data: { companyId: COMPANY_ID, startedAt: new Date() } }); // in flight
    const health = await getSyncHealth(COMPANY_ID);
    expect(health.status).toBe("ok");
    expect(health.warning).toBeNull();
  });
});
