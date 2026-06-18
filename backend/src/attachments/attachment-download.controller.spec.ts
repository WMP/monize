import { UnauthorizedException } from "@nestjs/common";
import { Response } from "express";
import { AttachmentDownloadController } from "./attachment-download.controller";
import { AttachmentsService } from "./attachments.service";
import { AttachmentSigningService } from "./attachment-signing.service";

describe("AttachmentDownloadController", () => {
  let controller: AttachmentDownloadController;
  let attachments: { getRaw: jest.Mock };
  let signing: { verify: jest.Mock };

  const id = "11111111-1111-1111-1111-111111111111";
  const userId = "22222222-2222-2222-2222-222222222222";

  const makeRes = () => {
    const headers: Record<string, string> = {};
    const res = {
      set: jest.fn((h: Record<string, string>) => {
        Object.assign(headers, h);
        return res;
      }),
      end: jest.fn(),
    };
    return { res: res as unknown as Response, headers, raw: res };
  };

  beforeEach(() => {
    attachments = { getRaw: jest.fn() };
    signing = { verify: jest.fn().mockReturnValue(true) };
    controller = new AttachmentDownloadController(
      attachments as unknown as AttachmentsService,
      signing as unknown as AttachmentSigningService,
    );
  });

  it("rejects a missing or invalid token", async () => {
    signing.verify.mockReturnValue(false);
    const { res } = makeRes();
    await expect(
      controller.download(id, userId, "bad", res),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(attachments.getRaw).not.toHaveBeenCalled();
  });

  it("serves a raster image inline with hardening headers", async () => {
    attachments.getRaw.mockResolvedValue({
      fileName: "shot.png",
      mimeType: "image/png",
      data: Buffer.from("img"),
    });
    const { res, headers } = makeRes();
    await controller.download(id, userId, "tok", res);

    expect(headers["Content-Disposition"]).toBe('inline; filename="shot.png"');
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Content-Security-Policy"]).toBe(
      "default-src 'none'; sandbox",
    );
  });

  it("forces attachment disposition for HTML and SVG (XSS defense)", async () => {
    for (const mimeType of ["text/html", "image/svg+xml"]) {
      attachments.getRaw.mockResolvedValue({
        fileName: "x",
        mimeType,
        data: Buffer.from("<svg/>"),
      });
      const { res, headers } = makeRes();
      await controller.download(id, userId, "tok", res);
      expect(headers["Content-Disposition"]).toBe('attachment; filename="x"');
      expect(headers["X-Content-Type-Options"]).toBe("nosniff");
      expect(headers["Content-Security-Policy"]).toBe(
        "default-src 'none'; sandbox",
      );
    }
  });
});
