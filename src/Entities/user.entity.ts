import { BeforeInsert, Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { JobEntity } from "./job.entity";
import * as bcrypt from 'bcrypt'
import { Subscription } from "src/enums/subscriptions.enum";
import { SentJob } from "./sent-jobs.entity";
@Entity()
export class User {
    @PrimaryGeneratedColumn()
    id: number;
    
    @Column()
    firstName:string;

    @Column()
    lastName:string;

    @Column()
    email:string;
    
    @Column({
        type:'enum',
        enum: Subscription,
        default:Subscription.BASIC
    })
    subscription: Subscription

    @CreateDateColumn()
    createdAt:Date;

    @Column()
    password:string;

    @Column({ nullable: true })
    telegramChatId: string;

    @Column({ nullable: true })
    telegramToken?: string;
    
    @OneToMany(() => SentJob, sentJob => sentJob.job)
    sentJobs: SentJob[];

    @BeforeInsert()
    async hashOassword(){
        this.password = await bcrypt.hash(this.password, 10);
    }
}
