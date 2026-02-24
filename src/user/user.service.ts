import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { create } from 'domain';
import { remove } from 'node_modules/cheerio/dist/commonjs/api/manipulation';
import { JobEntity } from 'src/Entities/job.entity';
import { IsNull, Not, Repository } from 'typeorm';
import { User } from 'src/Entities/user.entity';

@Injectable()
export class UserService {
  constructor(@InjectRepository(User) private userRepo: Repository<User>) { }

  async create(createUserDto: CreateUserDto) {
    const user = await this.userRepo.create(createUserDto)
    return await this.userRepo.save(user);
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
      select: ['id', 'firstName', 'lastName', 'email', 'createdAt', 'subscription', 'searchQuery', 'telegramChatId']
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
