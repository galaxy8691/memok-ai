import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cronPatternFromDailyAt,
  expandUserPath,
  isMemokSetupCliRun,
} from "../src/plugin/memokTypes.js";

describe("memokTypes", () => {
  describe("expandUserPath", () => {
    it("expands leading tilde slash to home directory", () => {
      expect(expandUserPath("~/foo/bar")).toBe(join(homedir(), "foo/bar"));
    });

    it("returns trimmed path unchanged when not tilde form", () => {
      expect(expandUserPath("  /abs/path  ")).toBe("/abs/path");
    });
  });

  describe("cronPatternFromDailyAt", () => {
    it("parses valid HH:mm to 5-field cron (minute hour * * *)", () => {
      expect(cronPatternFromDailyAt("03:00")).toBe("0 3 * * *");
      expect(cronPatternFromDailyAt("23:59")).toBe("59 23 * * *");
    });

    it("returns undefined for empty input without warn", () => {
      const warn = vi.fn();
      expect(cronPatternFromDailyAt("", { warn })).toBeUndefined();
      expect(warn).not.toHaveBeenCalled();
    });

    it("returns undefined for invalid pattern and warns", () => {
      const warn = vi.fn();
      expect(cronPatternFromDailyAt("no-colon", { warn })).toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it("returns undefined for out-of-range time and warns", () => {
      const warn = vi.fn();
      expect(cronPatternFromDailyAt("24:00", { warn })).toBeUndefined();
      expect(warn).toHaveBeenCalled();
      expect(cronPatternFromDailyAt(null)).toBeUndefined();
    });
  });

  describe("isMemokSetupCliRun", () => {
    const originalArgv = process.argv;

    afterEach(() => {
      process.argv = originalArgv;
    });

    it("is true when argv contains memok then setup", () => {
      process.argv = ["node", "openclaw", "memok", "setup"];
      expect(isMemokSetupCliRun()).toBe(true);
    });

    it("is false when setup is missing or memok absent", () => {
      process.argv = ["node", "openclaw", "memok", "help"];
      expect(isMemokSetupCliRun()).toBe(false);
      process.argv = ["node", "cli"];
      expect(isMemokSetupCliRun()).toBe(false);
    });
  });
});
