import { describe, expect, it } from "vitest";
import {
  ConnectionError,
  isConnectionError,
  isConnectionErrorMessage,
} from "@services/connection-error";

describe("ConnectionError", () => {
  it("is recognized by isConnectionError", () => {
    expect(isConnectionError(new ConnectionError("boom"))).toBe(true);
    expect(isConnectionError(new Error("boom"))).toBe(false);
    expect(isConnectionError("boom")).toBe(false);
    expect(isConnectionError(undefined)).toBe(false);
  });

  it("keeps its name and message", () => {
    const error = new ConnectionError("custom message");
    expect(error.name).toBe("ConnectionError");
    expect(error.message).toBe("custom message");
  });
});

describe("isConnectionErrorMessage", () => {
  it("matches sidecar, browser, and websocket connection failures", () => {
    expect(
      isConnectionErrorMessage(
        "<urlopen error [SSL: UNEXPECTED_EOF_WHILE_READING] EOF occurred in violation of protocol (_ssl.c:1032)>"
      )
    ).toBe(true);
    expect(isConnectionErrorMessage("Failed to fetch")).toBe(true);
    expect(isConnectionErrorMessage("WebSocket connection error")).toBe(true);
    expect(isConnectionErrorMessage("connection reset by peer")).toBe(true);
  });

  it("does not match unrelated errors", () => {
    expect(isConnectionErrorMessage("File missing or invalid size")).toBe(
      false
    );
    expect(isConnectionErrorMessage("")).toBe(false);
  });
});
