import { Injectable, NotFoundException, Inject, forwardRef, OnModuleInit, ConflictException } from '@nestjs/common';
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
import { HrType } from 'src/enums/hr-type.enum';

/** Emails are compared trimmed and lowercased: "Name@Gmail.com" and "name@gmail.com" are one account. */
export const normalizeEmail = (email: string | null | undefined) => (email ?? '').trim().toLowerCase();

// Fields safe to return to clients (never the password hash or verification code).
const PUBLIC_USER_FIELDS: (keyof User)[] = ['id', 'firstName', 'lastName', 'email', 'role', 'companyName', 'hrType', 'hrApproved', 'createdAt', 'subscription', 'telegramChatId', 'isEmailVerified', 'receiveMessages'];

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

  async create(createUserDto: CreateUserDto, isEmailVerified = false, extra: Pick<Partial<User>, 'role' | 'companyName' | 'hrType'> = {}) {
    // Copy fields explicitly: the request body must never set role, hrApproved, subscription, etc.
    const { firstName, lastName, password, receiveMessages } = createUserDto;
    const email = normalizeEmail(createUserDto.email);
    // Without this check a double-submitted form or a returning user got a second, empty account
    if (await this.findByEmail(email)) {
      throw new ConflictException('ამ ელ-ფოსტით ანგარიში უკვე არსებობს. შედით ანგარიშში.');
    }
    const user = this.userRepo.create({ firstName, lastName, email, password, receiveMessages, ...extra });
    user.isEmailVerified = isEmailVerified;

    if (!isEmailVerified) {
      // Generate 6-digit verification code
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      user.emailVerificationToken = code;
    }

    let savedUser: User;
    try {
      savedUser = await this.userRepo.save(user);
    } catch (e: any) {
      // A double-submitted form can pass the check above twice; the unique index stops the second
      if (e?.code === '23505') throw new ConflictException('ამ ელ-ფოსტით ანგარიში უკვე არსებობს. შედით ანგარიშში.');
      throw e;
    }

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
    const hrType = dto.hrType ?? HrType.COMPANY;
    const user = await this.create(dto, false, {
      role: UserRole.HR,
      hrType,
      companyName: dto.companyName?.trim() || null,
    });
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
    const user = await this.findByEmail(email);
    if (!user || user.emailVerificationToken !== code) {
      return false;
    }
    user.isEmailVerified = true;
    user.emailVerificationToken = null;
    await this.userRepo.save(user);
    return true;
  }

  async resendVerification(email: string): Promise<{ success: boolean; message: string }> {
    const user = await this.findByEmail(email);
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

  /**
   * Case-insensitive, and always the oldest account: duplicates from before registration
   * checked for them exist, and an unordered lookup returned either one, so the same person
   * sometimes landed in an empty account. The oldest is the one that holds their data.
   */
  async findByEmail(email: string) {
    return await this.userRepo
      .createQueryBuilder('user')
      .where('LOWER(TRIM(user.email)) = :email', { email: normalizeEmail(email) })
      .orderBy('user.id', 'ASC')
      .getOne();
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

  /** Unlinks Telegram; returns the chat id that was linked (null when nothing was). */
  async disconnectTelegram(userId: number): Promise<string | null> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User with ID ${userId} not found`);

    const chatId = user.telegramChatId || null;
    await this.userRepo.update(userId, { telegramChatId: '', telegramToken: '' });
    return chatId;
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
