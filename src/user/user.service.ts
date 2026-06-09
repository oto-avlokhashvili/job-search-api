import { Injectable, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { User } from 'src/Entities/user.entity';
import { EmailService } from '../email/email.service';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @Inject(forwardRef(() => EmailService))
    private readonly emailService: EmailService,
  ) { }

  async create(createUserDto: CreateUserDto, isEmailVerified = false) {
    const user = await this.userRepo.create(createUserDto);
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
    const users = await this.userRepo.find()
    return users;
  }

  async findOne(id: number) {
    return await this.userRepo.findOne({
      where: {
        id,
      },
      select: ['id', 'firstName', 'lastName', 'email', 'createdAt', 'subscription','telegramChatId', 'isEmailVerified']
    })
  }

  async update(id: number, updateUserDto: UpdateUserDto) {
  const user = await this.userRepo.findOne({ where: { id } });

  if (!user) {
    throw new NotFoundException(`User with ID ${id} not found`);
  }

  const updated = Object.assign(user, updateUserDto);
  await this.userRepo.save(updated);

  return updated;
}

  remove() {
    return this.userRepo.clear();
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
