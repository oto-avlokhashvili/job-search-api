import { BeforeInsert, Column, CreateDateColumn, Entity, OneToOne, PrimaryGeneratedColumn } from "typeorm";
import * as bcrypt from 'bcrypt';
import { Subscription } from "src/enums/subscriptions.enum";
import { UserRole } from "src/enums/user-role.enum";
import { Subscription as SubscriptionDetails } from "./subscription.entity";

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
