import { BeforeInsert, Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";
import * as bcrypt from 'bcrypt';
import { Subscription } from "src/enums/subscriptions.enum";

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

    @Column({ default: false })
    isEmailVerified: boolean;

    @Column({ type: 'varchar', nullable: true })
    emailVerificationToken?: string | null;
    
    @BeforeInsert()
    async hashOassword(){
        this.password = await bcrypt.hash(this.password, 10);
    }
}
