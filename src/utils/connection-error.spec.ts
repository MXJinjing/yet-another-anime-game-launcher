import { describe, expect, it } from "vitest";
import {
  ConnectionError,
  isConnectionError,
  isConnectionErrorMessage,
} from "./connection-error";

describe("ConnectionError", () => {
  it("is recognized by isConnectionError", () => {
    expect(isConnectionError(new ConnectionError("boom"))).toBe(true);
    expect(isConnectionError(new Error("boom"))).toBe(false);
    expect(isConnectionError("boom")).toBe(false);
    expect(isConnectionError(undefined)).toBe(false);
  });

  it("keeps its name and message", () => {
    const err = new ConnectionError("custom message");
    expect(err.name).toBe("ConnectionError");
    expect(err.message).toBe("custom message");
  });
});

describe("isConnectionErrorMessage", () => {
  it("matches Python urllib/SSL failures forwarded from the Sophon sidecar", () => {
    expect(
      isConnectionErrorMessage(
        "<urlopen error [SSL: UNEXPECTED_EOF_WHILE_READING] EOF occurred in violation of protocol (_ssl.c:1032)>"
      )
    ).toBe(true);
    expect(
      isConnectionErrorMessage(
        "<urlopen error [Errno 8] nodename nor servname provided, or not known>"
      )
    ).toBe(true);
    expect(
      isConnectionErrorMessage(
        "Cannot download file 'x': Error 28: Operation timed out after 30000 milliseconds"
      )
    ).toBe(true);
  });

  it("matches browser fetch and websocket failures", () => {
    expect(isConnectionErrorMessage("Failed to fetch")).toBe(true);
    expect(isConnectionErrorMessage("WebSocket connection error")).toBe(true);
    expect(isConnectionErrorMessage("Connection refused")).toBe(true);
    expect(isConnectionErrorMessage("connection reset by peer")).toBe(true);
  });

  it("does not match unrelated errors", () => {
    expect(
      isConnectionErrorMessage("File missing or invalid size: data.bin")
    ).toBe(false);
    expect(
      isConnectionErrorMessage("Invalid installed game version: abc")
    ).toBe(false);
    expect(isConnectionErrorMessage("")).toBe(false);
  });
});
