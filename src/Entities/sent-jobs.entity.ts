import { Column, Entity, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { User } from './user.entity';
import { JobEntity } from './job.entity';

@Entity()
@Unique(['userId', 'jobId'])
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

    @Column({ type: 'varchar', nullable: true })
    location: string | null;

    @Column()
    company: string;

    @Column()
    match: number;

    @Column({ type: 'varchar', nullable: true })
    salaryRange: string | null;
}
