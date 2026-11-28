import { describe, it, expect } from "vitest";
import { computeDiff } from "../../src/core/utils/diff.js";

describe("computeDiff", () => {
  it("should return null when objects are identical", () => {
    const obj = { name: "Alice", email: "alice@test.com" };
    expect(computeDiff(obj, { ...obj })).toBeNull();
  });

  it("should detect simple string field change", () => {
    const old = { name: "Alice", email: "alice@test.com" };
    const updated = { name: "Bob", email: "alice@test.com" };
    const diff = computeDiff(old, updated);
    expect(diff).toEqual({
      oldValues: { name: "Alice" },
      newValues: { name: "Bob" },
    });
  });

  it("should detect numeric field change", () => {
    const old = { age: 25 };
    const updated = { age: 30 };
    const diff = computeDiff(old, updated);
    expect(diff).toEqual({
      oldValues: { age: 25 },
      newValues: { age: 30 },
    });
  });

  it("should detect addition of new field", () => {
    const old = { name: "Alice" };
    const updated = { name: "Alice", role: "admin" };
    const diff = computeDiff(old, updated);
    expect(diff).toEqual({
      oldValues: { role: undefined },
      newValues: { role: "admin" },
    });
  });

  it("should detect removal of field", () => {
    const old = { name: "Alice", role: "admin" };
    const updated = { name: "Alice" };
    const diff = computeDiff(old, updated);
    expect(diff).toEqual({
      oldValues: { role: "admin" },
      newValues: { role: undefined },
    });
  });

  it("should handle nested object changes", () => {
    const old = { settings: { theme: "dark" } };
    const updated = { settings: { theme: "light" } };
    const diff = computeDiff(old, updated);
    expect(diff).toEqual({
      oldValues: { settings: { theme: "dark" } },
      newValues: { settings: { theme: "light" } },
    });
  });

  it("should handle array changes", () => {
    const old = { tags: ["a", "b"] };
    const updated = { tags: ["a", "c"] };
    const diff = computeDiff(old, updated);
    expect(diff).toEqual({
      oldValues: { tags: ["a", "b"] },
      newValues: { tags: ["a", "c"] },
    });
  });

  it("should respect only option", () => {
    const old = { name: "Alice", email: "old@test.com", role: "user" };
    const updated = { name: "Bob", email: "new@test.com", role: "admin" };
    const diff = computeDiff(old, updated, { only: ["name", "email"] });
    expect(diff).toEqual({
      oldValues: { name: "Alice", email: "old@test.com" },
      newValues: { name: "Bob", email: "new@test.com" },
    });
  });

  it("should respect except option", () => {
    const old = { name: "Alice", password: "old" };
    const updated = { name: "Bob", password: "new" };
    const diff = computeDiff(old, updated, { except: ["password"] });
    expect(diff).toEqual({
      oldValues: { name: "Alice" },
      newValues: { name: "Bob" },
    });
  });

  it("should respect globalExcept option", () => {
    const old = { name: "Alice", token: "abc" };
    const updated = { name: "Bob", token: "xyz" };
    const diff = computeDiff(old, updated, { globalExcept: ["token"] });
    expect(diff).toEqual({
      oldValues: { name: "Alice" },
      newValues: { name: "Bob" },
    });
  });

  it("should exclude id, createdAt, updatedAt by default", () => {
    const old = { id: "1", name: "Alice", createdAt: new Date(1000), updatedAt: new Date(1000) };
    const updated = {
      id: "1",
      name: "Bob",
      createdAt: new Date(2000),
      updatedAt: new Date(2000),
    };
    const diff = computeDiff(old, updated);
    expect(diff).toEqual({
      oldValues: { name: "Alice" },
      newValues: { name: "Bob" },
    });
  });

  it("should also exclude snake_case created_at, updated_at", () => {
    const old = { name: "Alice", created_at: new Date(1000), updated_at: new Date(1000) };
    const updated = { name: "Bob", created_at: new Date(2000), updated_at: new Date(2000) };
    const diff = computeDiff(old, updated);
    expect(diff).toEqual({
      oldValues: { name: "Alice" },
      newValues: { name: "Bob" },
    });
  });

  it("should return null when only fields have not changed", () => {
    const old = { name: "Alice", role: "user" };
    const updated = { name: "Alice", role: "admin" };
    const diff = computeDiff(old, updated, { only: ["name"] });
    expect(diff).toBeNull();
  });

  it("should handle null and undefined correctly", () => {
    const old = { name: null };
    const updated = { name: "Alice" };
    const diff = computeDiff(old, updated);
    expect(diff).toEqual({
      oldValues: { name: null },
      newValues: { name: "Alice" },
    });
  });

  it("should return null for identical nested objects", () => {
    const old = { settings: { theme: "dark", lang: "en" } };
    const updated = { settings: { theme: "dark", lang: "en" } };
    expect(computeDiff(old, updated)).toBeNull();
  });

  it("should handle boolean changes", () => {
    const old = { active: true };
    const updated = { active: false };
    const diff = computeDiff(old, updated);
    expect(diff).toEqual({
      oldValues: { active: true },
      newValues: { active: false },
    });
  });

  it("should combine except and globalExcept", () => {
    const old = { name: "Alice", password: "old", token: "abc", email: "old@test.com" };
    const updated = { name: "Bob", password: "new", token: "xyz", email: "new@test.com" };
    const diff = computeDiff(old, updated, {
      except: ["password"],
      globalExcept: ["token"],
    });
    expect(diff).toEqual({
      oldValues: { name: "Alice", email: "old@test.com" },
      newValues: { name: "Bob", email: "new@test.com" },
    });
  });
});
