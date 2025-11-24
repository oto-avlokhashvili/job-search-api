import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class JobEntity {
  @PrimaryGeneratedColumn()
  id: number;
  @Column()
  vacancy:string;
  @Column()
  company:string;
  @Column()
  link:string;
  @Column()
  publishDate:string;
  @Column()
  deadline:string;
  @Column()
  page:number;
}
