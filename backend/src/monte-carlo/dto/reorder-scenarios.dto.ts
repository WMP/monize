import { IsArray, IsUUID } from "class-validator";

export class ReorderScenariosDto {
  @IsArray()
  @IsUUID("4", { each: true })
  scenarioIds: string[];
}
