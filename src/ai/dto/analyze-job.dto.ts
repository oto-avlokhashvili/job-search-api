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
