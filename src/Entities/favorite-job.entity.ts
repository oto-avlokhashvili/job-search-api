import { CreateDateColumn, Column, Entity, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { User } from './user.entity';
import { JobEntity } from './job.entity';

/** A vacancy the user saved. Deleting the job (outdated cleanup) or the user removes it too. */
@Entity()
@Unique(['userId', 'jobId'])
export class FavoriteJob {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    userId: number;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    user: User;

    @Column()
    jobId: number;

    @ManyToOne(() => JobEntity, { onDelete: 'CASCADE' })
    job: JobEntity;

    @CreateDateColumn()
    createdAt: Date;
}
