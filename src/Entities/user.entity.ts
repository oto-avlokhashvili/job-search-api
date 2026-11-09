import { BeforeInsert, Column, CreateDateColumn, Entity, Index, OneToOne, PrimaryGeneratedColumn } from "typeorm";
import * as bcrypt from 'bcrypt';
import { Subscription } from "src/enums/subscriptions.enum";
import { UserRole } from "src/enums/user-role.enum";
import { HrType } from "src/enums/hr-type.enum";
import { Subscription as SubscriptionDetails } from "./subscription.entity";

// One account per email. Emails are stored trimmed and lowercased (UserService.create), so a plain
// unique index covers "Name@x.com" vs "name@x.com" too. Created by hand first, under the same name.
@Index('UQ_user_email', ['email'], { unique: true })
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
        type: 'enum',
        enum: UserRole,
        default: UserRole.USER
    })
    role: UserRole;

    // HR only: the company the recruiter signed up for (an outsource HR's agency, if they named one).
    @Column({ type: 'varchar', length: 150, nullable: true })
    companyName?: string | null;

    // HR only: company HR or outsource recruiter. Null on HR accounts made before this existed (= company).
    @Column({ type: 'enum', enum: HrType, nullable: true, default: null })
    hrType?: HrType | null;

    // HR only: set by an admin; RolesGuard blocks HR routes until true.
    @Column({ default: false })
    hrApproved: boolean;

    @Column({
        type: 'varchar',
        nullable: true,
    })
    subscription?: string | null;

    @OneToOne(() => SubscriptionDetails, (sub) => sub.user, { cascade: true, eager: true })
    subscriptionDetails?: SubscriptionDetails;

    @CreateDateColumn()
    createdAt:Date;

    @Column()
    password:string;


    @Column({ nullable: true })
    telegramChatId: string;

    @Column({ nullable: true })
    telegramToken?: string;

    @Column({ default: false })
    isEmailVerified: boolean;

    @Column({ default: false })
    receiveMessages: boolean;

    @Column({ type: 'varchar', nullable: true })
    emailVerificationToken?: string | null;
    
    @BeforeInsert()
    async hashOassword(){
        this.password = await bcrypt.hash(this.password, 10);
    }
}
