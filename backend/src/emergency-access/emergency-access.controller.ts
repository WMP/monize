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

  @Put("settings")
  @ApiOperation({ summary: "Create or update the emergency-access settings" })
  async putSettings(
    @Request() req: { user: { id: string } },
    @Body() dto: UpsertSettingsDto,
  ) {
    return this.service.upsertSettings(req.user.id, dto);
  }

  @Post("contacts")
  @ApiOperation({ summary: "Add an emergency contact" })
  async addContact(
    @Request() req: { user: { id: string } },
    @Body() dto: UpsertContactDto,
  ) {
    return this.service.addContact(req.user.id, dto);
  }

  @Patch("contacts/:id")
  @ApiOperation({ summary: "Update an emergency contact" })
  async updateContact(
    @Request() req: { user: { id: string } },
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: UpsertContactDto,
  ) {
    return this.service.updateContact(req.user.id, id, dto);
  }

  @Delete("contacts/:id")
  @ApiOperation({ summary: "Remove an emergency contact" })
  async removeContact(
    @Request() req: { user: { id: string } },
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    await this.service.removeContact(req.user.id, id);
    return { ok: true };
  }

  @Post("reset")
  @ApiOperation({
    summary: "Clear granted state and void outstanding magic links",
  })
  async reset(@Request() req: { user: { id: string } }) {
    return this.service.resetGrantedState(req.user.id);
  }
}
