import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Request,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { EmergencyAccessService } from "./emergency-access.service";
import { UpsertSettingsDto } from "./dto/upsert-settings.dto";
import { UpsertContactDto } from "./dto/upsert-contact.dto";
import { UpdateMessageDto } from "./dto/update-message.dto";
import { StepUpGuard } from "../auth/step-up/step-up.guard";
import { RequireStepUp } from "../auth/step-up/require-step-up.decorator";

@ApiTags("Emergency Access")
@Controller("emergency-access")
@UseGuards(AuthGuard("jwt"), StepUpGuard)
export class EmergencyAccessController {
  constructor(private readonly service: EmergencyAccessService) {}

  /**
   * Not gated either: the page has to render before it can prompt for step-up,
   * and this returns configuration the caller already owns. The decrypted message
   * is the sensitive read, and that has its own gate.
   */
  @Get()
  @ApiOperation({ summary: "Get the caller's emergency-access configuration" })
  async get(@Request() req: { user: { id: string } }) {
    return this.service.getView(req.user.id);
  }

  @Get("message")
  @RequireStepUp("emergency-access")
  @ApiOperation({
    summary:
      "Read the decrypted emergency-access message (requires step-up auth)",
  })
  async getMessage(@Request() req: { user: { id: string } }) {
    return this.service.getMessage(req.user.id);
  }

  @Put("message")
  @RequireStepUp("emergency-access")
  @ApiOperation({
    summary:
      "Replace the encrypted emergency-access message (requires step-up auth)",
  })
  async putMessage(
    @Request() req: { user: { id: string } },
    @Body() dto: UpdateMessageDto,
  ) {
    return this.service.updateMessage(req.user.id, dto.message);
  }

  /**
   * Step-up gated, like the message below it and unlike before.
   *
   * Who receives emergency access, and after how long, is the whole security
   * content of this feature -- the message is the least sensitive thing in it,
   * and the message was the only part that asked for a second factor. An attacker
   * holding a stolen session could add their own address as a contact and set the
   * waiting period to its two-day minimum, silently: nothing emails the owner
   * when a contact is added. Rotating the password does not help, because
   * changePassword revokes sessions, tokens and trusted devices but does not
   * touch emergency contacts. Two days of owner inactivity later, the claim flow
   * hands the attacker the account with 2FA cleared.
   */
  @Put("settings")
  @RequireStepUp("emergency-access")
  @ApiOperation({ summary: "Create or update the emergency-access settings" })
  async putSettings(
    @Request() req: { user: { id: string } },
    @Body() dto: UpsertSettingsDto,
  ) {
    return this.service.upsertSettings(req.user.id, dto);
  }

  @Post("contacts")
  @RequireStepUp("emergency-access")
  @ApiOperation({ summary: "Add an emergency contact" })
  async addContact(
    @Request() req: { user: { id: string } },
    @Body() dto: UpsertContactDto,
  ) {
    return this.service.addContact(req.user.id, dto);
  }

  @Patch("contacts/:id")
  @RequireStepUp("emergency-access")
  @ApiOperation({ summary: "Update an emergency contact" })
  async updateContact(
    @Request() req: { user: { id: string } },
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: UpsertContactDto,
  ) {
    return this.service.updateContact(req.user.id, id, dto);
  }

  @Delete("contacts/:id")
  @RequireStepUp("emergency-access")
  @ApiOperation({ summary: "Remove an emergency contact" })
  async removeContact(
    @Request() req: { user: { id: string } },
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    await this.service.removeContact(req.user.id, id);
    return { ok: true };
  }

  /**
   * Deliberately NOT step-up gated, unlike everything above.
   *
   * This only ever takes access away: it clears the granted state and voids
   * outstanding claim links. An owner who has just realized a grant is in flight
   * needs the fastest possible path to killing it, and a second factor between
   * them and that button is a hazard, not a control. The asymmetry is the point --
   * granting is gated, revoking is not.
   */
  @Post("reset")
  @ApiOperation({
    summary: "Clear granted state and void outstanding magic links",
  })
  async reset(@Request() req: { user: { id: string } }) {
    return this.service.resetGrantedState(req.user.id);
  }
}
