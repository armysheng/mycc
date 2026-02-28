import { describe, expect, it } from "vitest";
import {
  escapeShellArg,
  sanitizeLinuxUsername,
  validateLinuxUsername,
  validatePathPrefix,
} from "./validation.js";

describe("validation utils", () => {
  describe("validateLinuxUsername", () => {
    it("accepts valid usernames", () => {
      expect(validateLinuxUsername("mycc")).toBe(true);
      expect(validateLinuxUsername("mycc_user")).toBe(true);
      expect(validateLinuxUsername("u1")).toBe(true);
      expect(validateLinuxUsername("_svc")).toBe(true);
    });

    it("rejects invalid usernames", () => {
      expect(validateLinuxUsername("Mycc")).toBe(false);
      expect(validateLinuxUsername("1user")).toBe(false);
      expect(validateLinuxUsername("user.name")).toBe(false);
      expect(validateLinuxUsername("user name")).toBe(false);
      expect(validateLinuxUsername("")).toBe(false);
      expect(validateLinuxUsername("a".repeat(33))).toBe(false);
    });
  });

  describe("sanitizeLinuxUsername", () => {
    it("returns username when valid", () => {
      expect(sanitizeLinuxUsername("mycc_user-1")).toBe("mycc_user-1");
    });

    it("throws when invalid", () => {
      expect(() => sanitizeLinuxUsername("BadUser")).toThrow(
        "Invalid Linux username format: BadUser",
      );
    });
  });

  describe("escapeShellArg", () => {
    it("quotes plain args", () => {
      expect(escapeShellArg("abc")).toBe("'abc'");
    });

    it("escapes single quotes safely", () => {
      expect(escapeShellArg("a'b")).toBe("'a'\\''b'");
    });
  });

  describe("validatePathPrefix", () => {
    it("accepts paths under allowed prefix", () => {
      expect(validatePathPrefix("/home/mycc/work", "/home/")).toBe(true);
      expect(validatePathPrefix("/home//mycc///work", "/home/")).toBe(true);
    });

    it("rejects paths outside allowed prefix", () => {
      expect(validatePathPrefix("/tmp/mycc/work", "/home/")).toBe(false);
    });
  });
});
