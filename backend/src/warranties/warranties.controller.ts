import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { AuthGuard } from "@nestjs/passport";

import { CreateWarrantyDto } from "./dto/create-warranty.dto";
import { ListWarrantiesDto } from "./dto/list-warranties.dto";
import { UpdateWarrantyDto } from "./dto/update-warranty.dto";
import {
  WarrantyListResult,
  WarrantySummary,
  WarrantyView,
} from "./dto/warranty-response.dto";
import { WarrantiesService } from "./warranties.service";

/**
 * A user's warranties (docs/future-plans/warranty-tracker.md section 6.5).
 *
 * Deliberately NOT `@AllowDelegate` yet: the delegate READ section
 * `warranties` does not exist until task B5, which adds
 * `@AllowDelegate()` with `@DelegateRequiresSection('warranties')` to the
 * read routes only, together with the narrowing of `linkedTransaction` to the
 * delegate's readable accounts (WTY-007). Until then every route is
 * owner-only by the global `AccountDelegateGuard`'s default, so a read that a
 * delegate could reach cannot leak a linked purchase from an account they
 * were never granted. The write routes stay owner-only after B5 as well.
 *
 * `userId` comes from the JWT on every route and is never read from the request.
 */
@ApiTags("Warranties")
@ApiBearerAuth()
@UseGuards(AuthGuard("jwt"))
@Controller("warranties")
export class WarrantiesController {
  constructor(private readonly warrantiesService: WarrantiesService) {}

  @Get()
  @ApiOperation({ summary: "List the caller's warranties" })
  @ApiResponse({ status: 200, description: "One page of warranties" })
  findAll(
    @Request() req,
    @Query() query: ListWarrantiesDto,
  ): Promise<WarrantyListResult> {
    return this.warrantiesService.findAll(req.user.id, query);
  }

  // Declared before `:id`, which would otherwise take "summary" as an id.
  @Get("summary")
  @ApiOperation({ summary: "Unarchived warranties counted per status" })
  @ApiResponse({ status: 200, description: "Counts per status" })
  summary(@Request() req): Promise<WarrantySummary> {
    return this.warrantiesService.summary(req.user.id);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one warranty" })
  @ApiResponse({ status: 200, description: "The warranty" })
  @ApiResponse({ status: 404, description: "Warranty not found" })
  findOne(
    @Request() req,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<WarrantyView> {
    return this.warrantiesService.findOne(req.user.id, id);
  }

  @Post()
  @ApiOperation({ summary: "Create a warranty" })
  @ApiResponse({ status: 201, description: "The created warranty" })
  @ApiResponse({ status: 400, description: "Invalid expiry, price or term" })
  @ApiResponse({
    status: 404,
    description: "Linked transaction, payee or currency not found",
  })
  create(
    @Request() req,
    @Body() dto: CreateWarrantyDto,
  ): Promise<WarrantyView> {
    return this.warrantiesService.create(req.user.id, dto);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a warranty" })
  @ApiResponse({ status: 200, description: "The updated warranty" })
  @ApiResponse({ status: 400, description: "Invalid expiry, price or term" })
  @ApiResponse({
    status: 404,
    description: "Warranty, linked transaction, payee or currency not found",
  })
  update(
    @Request() req,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateWarrantyDto,
  ): Promise<WarrantyView> {
    return this.warrantiesService.update(req.user.id, id, dto);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a warranty, its claims and its documents" })
  @ApiResponse({ status: 204, description: "Deleted" })
  @ApiResponse({ status: 404, description: "Warranty not found" })
  async remove(
    @Request() req,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.warrantiesService.remove(req.user.id, id);
  }

  @Post(":id/archive")
  @HttpCode(200)
  @ApiOperation({ summary: "Archive a warranty, keeping its history" })
  @ApiResponse({ status: 200, description: "The archived warranty" })
  @ApiResponse({ status: 404, description: "Warranty not found" })
  archive(
    @Request() req,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<WarrantyView> {
    return this.warrantiesService.archive(req.user.id, id);
  }

  @Post(":id/unarchive")
  @HttpCode(200)
  @ApiOperation({ summary: "Return an archived warranty to the list" })
  @ApiResponse({ status: 200, description: "The unarchived warranty" })
  @ApiResponse({ status: 404, description: "Warranty not found" })
  unarchive(
    @Request() req,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<WarrantyView> {
    return this.warrantiesService.unarchive(req.user.id, id);
  }
}
