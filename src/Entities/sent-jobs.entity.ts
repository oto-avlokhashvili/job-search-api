import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from './user.entity';
import { JobEntity } from './job.entity';

@Entity()
export class SentJob {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    userId: number;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    user: User;

    @Column()
    jobId: number;

    @Column()
    vacancy: string;

    @Column()
    location: string;

    @Column()
    company: string;

    @Column()
    match: number;

    @Column()
    salaryRange: string;
}
