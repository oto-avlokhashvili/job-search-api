import { ApiProperty } from "@nestjs/swagger";

export class AnalyzeJobDto {
  id: number;
  vacancy: string;
  location: string | null;
  company: string;
  link: string;
  publishDate: string;
  deadline: string;
  page: number;
  archived: boolean;
}


export class ChatDto {
  @ApiProperty({ example: 'hello' })
  prompt: string;
}

export class AiChatDto {
  @ApiProperty({ type: 'string' })
  prompt: string;

  @ApiProperty({ type: 'string', required: false })
  useStoredCv?: string;
}