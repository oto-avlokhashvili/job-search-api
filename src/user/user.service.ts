import { Injectable, NotFoundException, Inject, forwardRef, OnModuleInit } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { CreateHrUserDto } from './dto/create-hr-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { User } from 'src/Entities/user.entity';
import { Subscription } from 'src/Entities/subscription.entity';
import { SubscriptionPlan, SubscriptionStatus } from 'src/enums/subscriptions.enum';
import { EmailService } from '../email/email.service';
import { UserRole } from 'src/enums/user-role.enum';

// Fields safe to return to clients (never the password hash or verification code).
const PUBLIC_USER_FIELDS: (keyof User)[] = ['id', 'firstName', 'lastName', 'email', 'role', 'companyName', 'hrApproved', 'createdAt', 'subscription', 'telegramChatId', 'isEmailVerified', 'receiveMessages'];

@Injectable()
export class UserService implements OnModuleInit {
  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Subscription) private subscriptionRepo: Repository<Subscription>,
    @Inject(forwardRef(() => EmailService))
    private readonly emailService: EmailService,
  ) { }

  async onModuleInit() {
    try {
      const usersWithoutSub = await this.userRepo
        .createQueryBuilder('user')
        .leftJoinAndSelect('user.subscriptionDetails', 'subscription')
        .where('subscription.id IS NULL')
        .getMany();

      for (const user of usersWithoutSub) {
        if (
          user.subscription &&
          Object.values(SubscriptionPlan).includes(user.subscription as unknown as SubscriptionPlan)
        ) {
          const sub = this.subscriptionRepo.create({
            userId: user.id,
            plan: user.subscription as unknown as SubscriptionPlan,
            status: SubscriptionStatus.ACTIVE,
          });
          await this.subscriptionRepo.save(sub);
        }
      }
    } catch (err) {
      console.error('[UserService] Subscription backfill failed or table not ready:', err);
    }
  }

  async create(createUserDto: CreateUserDto, isEmailVerified = false, extra: Pick<Partial<User>, 'role' | 'companyName'> = {}) {
    // Copy fields explicitly: the request body must never set role, hrApproved, subscription, etc.
    const { firstName, lastName, email, password, receiveMessages } = createUserDto;
    const user = this.userRepo.create({ firstName, lastName, email, password, receiveMessages, ...extra });
    user.isEmailVerified = isEmailVerified;

    if (!isEmailVerified) {
      // Generate 6-digit verification code
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      user.emailVerificationToken = code;
    }

    const savedUser = await this.userRepo.save(user);

    if (!isEmailVerified) {
      try {
        await this.emailService.sendVerificationEmail(
          savedUser.email,
          savedUser.firstName,
          savedUser.emailVerificationToken!,
        );
      } catch (err) {
        console.error(`[UserService] Failed to send verification email to ${savedUser.email}:`, err);
      }
    }

    return savedUser;
  }

  async createHr(dto: CreateHrUserDto) {
    const user = await this.create(dto, false, { role: UserRole.HR, companyName: dto.companyName.trim() });
    return this.findOne(user.id);
  }

  async findHrUsers(approved?: boolean) {
    return this.userRepo.find({
      where: { role: UserRole.HR, ...(approved === undefined ? {} : { hrApproved: approved }) },
      select: PUBLIC_USER_FIELDS,
      order: { createdAt: 'DESC' },
    });
  }

  async setHrApproval(id: number, approved: boolean) {
    const user = await this.userRepo.findOne({ where: { id, role: UserRole.HR } });
    if (!user) throw new NotFoundException(`HR user with ID ${id} not found`);
    await this.userRepo.update(id, { hrApproved: approved });
    return this.findOne(id);
  }

  async verifyEmail(email: string, code: string): Promise<boolean> {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user || user.emailVerificationToken !== code) {
      return false;
    }
    user.isEmailVerified = true;
    user.emailVerificationToken = null;
    await this.userRepo.save(user);
    return true;
  }

  async resendVerification(email: string): Promise<{ success: boolean; message: string }> {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.isEmailVerified) {
      return { success: true, message: 'Email is already verified' };
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    user.emailVerificationToken = code;
    await this.userRepo.save(user);

    try {
      await this.emailService.sendVerificationEmail(user.email, user.firstName, code);
      return { success: true, message: 'Verification code resent successfully' };
    } catch (err: any) {
      console.error(`[UserService] Failed to resend verification email:`, err);
      return { success: false, message: `Failed to send email: ${err.message}` };
    }
  }

  async findAll() {
    const users = await this.userRepo.find({ select: PUBLIC_USER_FIELDS })
    return users;
  }

  async findOne(id: number) {
    return await this.userRepo.findOne({
      where: {
        id,
      },
      relations: ['subscriptionDetails'],
      select: PUBLIC_USER_FIELDS
    });
  }

  async update(id: number, updateUserDto: UpdateUserDto) {
  const user = await this.userRepo.findOne({ where: { id } });

  if (!user) {
    throw new NotFoundException(`User with ID ${id} not found`);
  }

  // Only profile fields are user-editable; telegramChatId can only be cleared (disconnect).
  const { firstName, lastName, receiveMessages, telegramChatId } = updateUserDto;
  const changes: Partial<User> = {};
  if (firstName !== undefined) changes.firstName = firstName;
  if (lastName !== undefined) changes.lastName = lastName;
  if (receiveMessages !== undefined) changes.receiveMessages = receiveMessages;
  if (telegramChatId === '') changes.telegramChatId = '';

  if (Object.keys(changes).length) await this.userRepo.update(id, changes);
  return this.findOne(id);
}

  async findByEmail(email: string) {
    return await this.userRepo.findOne({
      where: {
        email,
      },
    })
  }
  async linkTelegramToken(token: string, chatId: string) {
    const user = await this.userRepo.findOne({ where: { telegramToken: token } });
    if (!user) return null;

    // Update user with chatId and remove token
    user.telegramChatId = chatId;
    user.telegramToken = '';
    await this.userRepo.save(user);

    return user;
  }

  async saveTelegramToken(userId: number, token: string) {
    const tokenawait = await this.userRepo.update(userId, { telegramToken: token });
    return tokenawait;
  }
  // user.service.ts
async findByTelegramId(telegramChatId: string) {
    try {
        const user = await this.userRepo.findOne({
            where: { telegramChatId }
        });
        return user; // Returns null if not found, instead of throwing
    } catch (error) {
        console.error('Error finding user by telegram ID:', error);
        return null; // Return null on error
    }
}
// In user.service.ts
async findAllWithTelegram() {
    // Adjust this based on your database/ORM setup
    // This should return all users who have a linked telegramId
    return await this.userRepo.find({
        where: {
            telegramChatId: Not(IsNull()) // Or however you check for non-null in your ORM
        }
    });
}

}
