import { describe, it, expect } from "vitest";
import "reflect-metadata";
import { Auditable } from "../src/decorators/auditable.decorator";
import { AUDITABLE_METADATA_KEY } from "../src/audit-log.constants";

describe("@Auditable() decorator", () => {
  it("should store metadata with default auditableType (class name)", () => {
    @Auditable()
    class User {}

    const meta = Reflect.getMetadata(AUDITABLE_METADATA_KEY, User);
    expect(meta).toEqual({
      auditableType: "User",
      only: undefined,
      except: undefined,
      events: undefined,
    });
  });

  it("should store metadata with custom auditableType", () => {
    @Auditable({ auditableType: "AppUser" })
    class User {}

    const meta = Reflect.getMetadata(AUDITABLE_METADATA_KEY, User);
    expect(meta.auditableType).toBe("AppUser");
  });

  it("should store only field list", () => {
    @Auditable({ only: ["name", "email"] })
    class User {}

    const meta = Reflect.getMetadata(AUDITABLE_METADATA_KEY, User);
    expect(meta.only).toEqual(["name", "email"]);
  });

  it("should store except field list", () => {
    @Auditable({ except: ["password", "token"] })
    class User {}

    const meta = Reflect.getMetadata(AUDITABLE_METADATA_KEY, User);
    expect(meta.except).toEqual(["password", "token"]);
  });

  it("should store events filter list", () => {
    @Auditable({ events: ["created", "deleted"] })
    class User {}

    const meta = Reflect.getMetadata(AUDITABLE_METADATA_KEY, User);
    expect(meta.events).toEqual(["created", "deleted"]);
  });

  it("should handle no options (all defaults)", () => {
    @Auditable()
    class Post {}

    const meta = Reflect.getMetadata(AUDITABLE_METADATA_KEY, Post);
    expect(meta.auditableType).toBe("Post");
    expect(meta.only).toBeUndefined();
    expect(meta.except).toBeUndefined();
    expect(meta.events).toBeUndefined();
  });

  it("should return undefined for non-decorated class", () => {
    class Plain {}

    const meta = Reflect.getMetadata(AUDITABLE_METADATA_KEY, Plain);
    expect(meta).toBeUndefined();
  });
});
